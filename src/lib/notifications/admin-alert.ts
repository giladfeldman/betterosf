import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sql, gte, and, eq, count } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { adminAlerts, systemLogs } from "@/lib/db/schema";
import { getSesClient, FROM_ADDRESS, FROM_NAME, EMAIL_MODE } from "@/lib/email/client";
import {
  classify, emailPolicy, environmentLabel, fingerprint, renderIssueAlert, shouldAlert,
  type AdminIssue, type Importance, type Priority,
} from "./admin-email";

/**
 * Event-driven issue alert (admin email standard §1, §5). Called from the logger's
 * error path, so the DB is already awake: one upsert + at most one SES call.
 * Never throws, never awaited by callers.
 *
 * Deliberately BYPASSES sendEmail()'s suppression/idempotency gates and talks to
 * SES directly: the operator must never miss an alert because their address once
 * bounced.
 */
export interface AlertInput {
  level: "error" | "warn" | "fatal";
  event: string;               // system_logs.type
  message: string;
  context?: Record<string, unknown>;
  priority?: Priority;         // override the default classifier
  summary?: string;            // one line; defaults to event + message
  explanation?: string;        // plain 2-3 sentences; defaults to a generated one
  importance?: Importance;
  suggestedStep?: string;
  source?: string;
  userFacing?: boolean;
  /** Deep link for the "Open admin log" button; defaults to /admin/logs?q=<event>. */
  adminLogUrl?: string;
}

const APP = "BetterOSF";
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export async function maybeAlert(input: AlertInput): Promise<"sent" | "muted" | "skipped" | "console" | "error"> {
  try {
    const environment = environmentLabel();
    const policy = emailPolicy(environment);
    // Local dev shares the production database: a non-production event with no opt-in is
    // not recorded in admin_alerts at all, so it can never show up as an open production issue.
    if (!policy.send) return "skipped";
    const db = requireDb();
    const ctx = input.context ?? {};
    const route = str(ctx.route) ?? str(ctx.path);
    const errorClass = str(ctx.errorName) ?? str(ctx.name);
    const fp = fingerprint(APP, input.event, errorClass, input.message, route);

    const hourAgo = new Date(Date.now() - 3_600_000);
    const [upserted] = await db
      .insert(adminAlerts)
      .values({
        fingerprint: fp, priority: "P4", event: input.event,
        summary: (input.summary ?? `${input.event}: ${input.message}`).slice(0, 160),
        sample: { message: input.message, context: ctx },
      })
      .onConflictDoUpdate({
        target: adminAlerts.fingerprint,
        set: {
          count: sql`${adminAlerts.count} + 1`,
          countSinceAlert: sql`${adminAlerts.countSinceAlert} + 1`,
          lastSeen: sql`now()`,
          resolvedAt: null,
          sample: { message: input.message, context: ctx },
        },
      })
      .returning();
    if (!upserted) throw new Error("admin_alerts upsert returned no row");
    const row = upserted;

    // Burst detection (standard §5): error rows of this event in the last hour, read
    // through system_logs' (type, created_at) index. Counted per event, not per
    // fingerprint -- a slight over-count when one event has several messages.
    const [hourRow] = await db.select({ n: count() }).from(systemLogs)
      .where(and(eq(systemLogs.type, input.event), eq(systemLogs.level, "error"), gte(systemLogs.createdAt, hourAgo)));
    const priority = input.priority ?? classify(input.level, { userFacing: input.userFacing, countLastHour: Number(hourRow?.n ?? 0) });
    // Priority change is a compare-and-set, so of several concurrent requests only one
    // wins a P3 -> P2 escalation (and its one re-alert inside the mute window).
    let escalated = false;
    if (priority !== row.priority) {
      const changed = await db.update(adminAlerts).set({ priority })
        .where(and(eq(adminAlerts.fingerprint, fp), eq(adminAlerts.priority, row.priority)))
        .returning({ fp: adminAlerts.fingerprint });
      escalated = changed.length > 0 && row.priority === "P3" && priority === "P2";
    }
    if (!policy.send) return "skipped";

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [dayRow] = await db.select({ n: count() }).from(adminAlerts).where(gte(adminAlerts.lastAlertedAt, dayAgo));
    const alertsToday = Number(dayRow?.n ?? 0);
    if (!escalated && !shouldAlert(priority, row.lastAlertedAt, alertsToday)) return "muted";

    const to = process.env.ADMIN_NOTIFY_EMAIL?.trim();
    if (!to) {
      console.warn("[admin-alert] ADMIN_NOTIFY_EMAIL is not set: issue alert NOT sent (" + input.event + ")");
      return "skipped";
    }
    const appUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
    const issue: AdminIssue = {
      app: APP, priority, fingerprint: fp, environment,
      platform: process.env.VERCEL ? "vercel" : process.env.RAILWAY_ENVIRONMENT_NAME ? "railway" : process.env.RENDER ? "render" : "local",
      summary: (input.summary ?? `${input.event}: ${input.message}`).slice(0, 140),
      explanation: input.explanation ??
        `${APP} logged "${input.message}" (${input.event}) in ${environment}. It has happened ${row.count} time(s) since ${row.firstSeen.toISOString()}. Open the session button to have it reproduced locally and diagnosed.`,
      event: input.event, message: input.message, errorClass, route,
      httpStatus: typeof ctx.status === "number" ? ctx.status : undefined,
      requestId: str(ctx.requestId) ?? str(ctx.request_id),
      firstSeen: row.firstSeen.toISOString(), lastSeen: row.lastSeen.toISOString(),
      count: row.count, countSinceLastAlert: row.lastAlertedAt ? row.countSinceAlert : undefined,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7),
      userRef: str(ctx.userIdHash), stack: str(ctx.stack), source: input.source,
      suggestedStep: input.suggestedStep, importance: input.importance,
      adminLogUrl: input.adminLogUrl ?? (appUrl ? `${appUrl}/admin/logs?q=${encodeURIComponent(input.event)}` : undefined),
    };
    if (alertsToday === 9) {
      issue.explanation += " Alert cap reached: this is the 10th alert email in 24 hours; further issues go to the fortnight digest until the window clears.";
    }
    const alert = renderIssueAlert(issue, { prefix: policy.prefix });

    // Atomic claim (standard §5): a burst of concurrent errors all read "never alerted";
    // only the request whose UPDATE matches still-unmuted sends. An escalation claims unconditionally.
    const muteOver = sql`(${adminAlerts.lastAlertedAt} IS NULL OR ${adminAlerts.lastAlertedAt} <= now() - interval '24 hours')`;
    const claimed = await db.update(adminAlerts)
      .set({ lastAlertedAt: sql`now()`, countSinceAlert: 0 })
      .where(escalated ? eq(adminAlerts.fingerprint, fp) : and(eq(adminAlerts.fingerprint, fp), muteOver))
      .returning({ fp: adminAlerts.fingerprint });
    if (!claimed.length) return "muted";

    if (EMAIL_MODE() === "console") {
      console.log(`[admin-alert] (console) to=${to} subject="${alert.subject}"\n${alert.text}`);
      return "console";
    }
    try {
      await getSesClient().send(new SendEmailCommand({
        Source: `${FROM_NAME()} <${FROM_ADDRESS()}>`,
        Destination: { ToAddresses: to.split(",").map((a) => a.trim()).filter(Boolean) },
        Message: { Subject: { Data: alert.subject }, Body: { Html: { Data: alert.html }, Text: { Data: alert.text } } },
      }));
    } catch (sendErr) {
      // Release the claim so the next occurrence retries instead of being muted for 24 h.
      await db.update(adminAlerts)
        .set({ lastAlertedAt: row.lastAlertedAt, countSinceAlert: row.countSinceAlert })
        .where(eq(adminAlerts.fingerprint, fp));
      throw sendErr;
    }
    return "sent";
  } catch (err) {
    // Never log through the logger here: that would recurse into maybeAlert.
    console.error("[admin-alert] failed", err);
    return "error";
  }
}
