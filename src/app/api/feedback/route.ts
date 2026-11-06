import { auth } from "@/auth";
import { validateFeedback, truncateUserAgent } from "@/lib/feedback/validate";
import { insertBugReport } from "@/lib/db/bug-reports";
import { findUserByOsfId } from "@/lib/db/users";
import { APP_VERSION } from "@/lib/version";
import { logError, logInfo, errorDetails } from "@/lib/logger";
import { incrementWindow } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Per-IP submission cap. Generous for a human, hostile to a script. */
const MAX_PER_HOUR = 10;
/** Ceiling for one address across all signed-in reporters behind it. */
const MAX_PER_IP_SIGNED_IN = 100;

function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = validateFeedback(body as Record<string, unknown>);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // Budgets (d-035eb4). Anonymous: 10/hour per IP. Signed in: 10/hour per OSF user, so a
  // lab behind one university NAT does not share a single budget. The user id comes from a
  // server-verified session (`auth()`), never from a cookie merely being present — that
  // forgeable shortcut is why the middleware keeps ONE flat per-IP limit. A per-IP ceiling
  // still bounds any single address, however many accounts it signs in with.
  const ip = clientIp(req);
  const session = await auth().catch(() => null);
  const osfUserId = session?.osfUserId ?? null;
  const tooMany = () =>
    Response.json(
      { error: "You've sent several reports recently. Please wait a while before sending more." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  if (osfUserId) {
    if ((await incrementWindow(`ip:${ip}:feedback-ceiling:1h`, 3600)) > MAX_PER_IP_SIGNED_IN) return tooMany();
    if ((await incrementWindow(`osf:${osfUserId}:feedback:1h`, 3600)) > MAX_PER_HOUR) return tooMany();
  } else if ((await incrementWindow(`ip:${ip}:feedback:1h`, 3600)) > MAX_PER_HOUR) {
    return tooMany();
  }
  // Resolve the internal user row so the report survives as a real FK when the
  // reporter is signed in. A lookup failure must not lose the report.
  let userId: string | null = null;
  if (osfUserId) {
    const row = await findUserByOsfId(osfUserId).catch(() => null);
    userId = row?.id ?? null;
  }

  let id: string | null;
  try {
    id = await insertBugReport({
      kind: parsed.value.kind,
      message: parsed.value.message,
      contactEmail: parsed.value.contactEmail,
      pageUrl: parsed.value.pageUrl,
      appVersion: APP_VERSION,
      userAgent: truncateUserAgent(req.headers.get("user-agent")),
      userId,
      osfUserId,
    });
  } catch (e) {
    logError("admin", "bug report insert failed", errorDetails(e));
    return Response.json(
      { error: "We couldn't save that report. Please email betterosf@scimeto.app instead." },
      { status: 500 },
    );
  }

  // No database configured — we must NOT claim success. Telling a user their
  // report was received when it went nowhere is worse than an honest failure.
  if (!id) {
    return Response.json(
      { error: "Reports aren't being stored right now. Please email betterosf@scimeto.app instead." },
      { status: 503 },
    );
  }

  logInfo("admin", "bug report received", {
    id,
    kind: parsed.value.kind,
    pageUrl: parsed.value.pageUrl,
    hasContact: Boolean(parsed.value.contactEmail),
  });

  // Notify the admin. The report is already durably stored, so a mail failure
  // must not fail the request — it is logged and surfaced in the admin inbox.
  const notified = await notifyAdmin({
    id,
    kind: parsed.value.kind,
    message: parsed.value.message,
    contactEmail: parsed.value.contactEmail,
    pageUrl: parsed.value.pageUrl,
    osfUserId,
    userAgent: truncateUserAgent(req.headers.get("user-agent")),
  }).catch((e) => {
    logError("admin", "bug report admin email failed", { id, ...errorDetails(e) });
    return false;
  });

  return Response.json({ ok: true, id, emailed: notified }, { status: 201 });
}

async function notifyAdmin(report: {
  id: string;
  kind: string;
  message: string;
  contactEmail: string | null;
  pageUrl: string | null;
  osfUserId: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  // A user report is an issue alert (admin email standard: `source: user report`, P3). The
  // report is already stored; the alert carries the facts, never the reporter's address
  // (that stays on /admin/feedback). Production only: a report filed against a local server
  // is stored and visible there, emailed only with the opt-in, labelled by the shared policy.
  if (!process.env.ADMIN_NOTIFY_EMAIL?.trim()) {
    console.warn("[feedback] ADMIN_NOTIFY_EMAIL is not set: the report is stored but no alert is sent");
    return false;
  }
  const { maybeAlert } = await import("@/lib/notifications/admin-alert");
  const appUrl = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://betterosf.vercel.app").replace(/\/$/, "");
  const kindLabel = report.kind === "idea" ? "idea" : report.kind === "question" ? "question" : "bug report";
  const oneLine = report.message.slice(0, 60).replace(/\s+/g, " ");
  const result = await maybeAlert({
    level: "error",
    event: `user-report:${report.kind}`,
    message: report.message.slice(0, 1000),
    priority: "P3",
    source: "user report",
    summary: `New ${kindLabel}: ${oneLine}`,
    explanation:
      `A BetterOSF user sent a ${kindLabel} from ${report.pageUrl ?? "an unknown page"} ` +
      `(report ${report.id}, app version ${APP_VERSION}, ${report.osfUserId ? "signed in" : "anonymous"}). ` +
      `The full text is below and on the admin feedback page; whether it is a real defect is not yet established.`,
    importance: { usersAffected: "1 (the reporter)", scienceAffected: "unknown", moneyAffected: "no", dataAtRisk: "unknown" },
    suggestedStep: "Open the report on the admin feedback page, then try to reproduce it locally before changing anything.",
    adminLogUrl: `${appUrl}/admin/feedback`,
    context: { route: report.pageUrl ?? undefined, reportId: report.id, userAgent: report.userAgent ?? undefined, appVersion: APP_VERSION },
  });
  return result === "sent" || result === "console";
}
