import { sendEmail, renderEmail } from "@/lib/email";
import { collectAdminDigest } from "./admin-digest";
import { AdminDigestEmail } from "@/lib/email/templates/admin-digest";

export type SendDigestResult =
  | { status: "sent" }
  | { status: "console" }
  | { status: "skipped_empty" }
  | { status: "missing_recipient" }
  | { status: "suppressed" }
  | { status: "duplicate" }
  | { status: "ses_error"; error: string };

export async function sendAdminErrorDigest(opts?: {
  windowHours?: number;
  skipIfEmpty?: boolean;
  appUrl?: string;
}): Promise<SendDigestResult> {
  const windowHours = opts?.windowHours ?? 24;
  const skipIfEmpty = opts?.skipIfEmpty ?? true;

  const to =
    process.env.ADMIN_NOTIFY_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();
  if (!to) return { status: "missing_recipient" };

  const digest = await collectAdminDigest(windowHours);
  if (skipIfEmpty && digest.errorCount === 0 && digest.warnCount === 0) {
    return { status: "skipped_empty" };
  }

  const appName = "BetterOSF";
  const appUrl =
    opts?.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL?.trim() ??
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ??
    "https://betterosf.vercel.app";
  const subject =
    `[${appName}] ${digest.errorCount} error${digest.errorCount === 1 ? "" : "s"}, ` +
    `${digest.warnCount} warning${digest.warnCount === 1 ? "" : "s"} in last ${windowHours}h`;

  const { html, text } = await renderEmail(
    AdminDigestEmail({ appName, appUrl, digest }),
  );

  const dayKey = new Date().toISOString().slice(0, 10);
  const result = await sendEmail({
    to,
    subject,
    html,
    text,
    idempotencyKey: `admin-digest-${dayKey}`,
  });

  if (result.sent) {
    return { status: result.mode === "console" ? "console" : "sent" };
  }
  if (result.reason === "suppressed") return { status: "suppressed" };
  if (result.reason === "duplicate") return { status: "duplicate" };
  return { status: "ses_error", error: result.error ?? result.reason };
}
