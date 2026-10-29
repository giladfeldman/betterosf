import { sendEmail, renderEmail } from "@/lib/email";
import { collectAdminDigest } from "./admin-digest";
import { AdminDigestEmail } from "@/lib/email/templates/admin-digest";
import { alertEmailPolicy, deploymentEnvironment } from "@/lib/alert-env";

export type SendDigestResult =
  | { status: "sent" }
  | { status: "console" }
  | { status: "skipped_empty" }
  | { status: "missing_recipient" }
  /** The digest was asked for on a non-production server without the opt-in (d-bf671b). */
  | { status: "not_production" }
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

  // The SENDER's environment: a digest triggered on a laptop is a local test, whatever the
  // events in it, and is emailed only with the opt-in — labelled.
  const sender = alertEmailPolicy();
  if (!sender.send) return { status: "not_production" };

  // Production events only. Non-production events get their own, labelled email, and only
  // with the opt-in — never mixed into the production count.
  const digest = await collectAdminDigest(windowHours);
  if (deploymentEnvironment() === "production" && alertEmailPolicy("local").send) {
    await sendNonProductionDigest(to, windowHours).catch(() => {});
  }
  if (skipIfEmpty && digest.errorCount === 0 && digest.warnCount === 0) {
    return { status: "skipped_empty" };
  }

  const appName = "BetterOSF";
  const appUrl =
    opts?.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL?.trim() ??
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ??
    "https://betterosf.vercel.app";
  const subject = sender.subject(
    `[${appName}] ${digest.errorCount} error${digest.errorCount === 1 ? "" : "s"}, ` +
    `${digest.warnCount} warning${digest.warnCount === 1 ? "" : "s"} in last ${windowHours}h`,
  );

  const { html, text } = await renderEmail(
    AdminDigestEmail({ appName, appUrl, digest, banner: sender.banner }),
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

/** Opt-in only: the local/preview events, in an email that cannot be mistaken for production. */
async function sendNonProductionDigest(to: string, windowHours: number): Promise<void> {
  const digest = await collectAdminDigest(windowHours, { scope: "non-production" });
  if (digest.errorCount === 0 && digest.warnCount === 0) return;
  const policy = alertEmailPolicy("local");
  const subject = policy.subject(
    `[BetterOSF] ${digest.errorCount} error(s), ${digest.warnCount} warning(s) from local/preview servers in last ${windowHours}h`,
  );
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://betterosf.vercel.app";
  const { html, text } = await renderEmail(AdminDigestEmail({ appName: "BetterOSF", appUrl, digest, banner: policy.banner }));
  await sendEmail({
    to,
    subject,
    html,
    text,
    idempotencyKey: `admin-digest-nonprod-${new Date().toISOString().slice(0, 10)}`,
  });
}
