import { SendEmailCommand } from "@aws-sdk/client-ses";
import { getSesClient, FROM_ADDRESS, FROM_NAME, EMAIL_MODE } from "@/lib/email/client";
import { collectFortnightDigest } from "./admin-digest";
import { emailPolicy, environmentLabel, renderDigest } from "./admin-email";

/**
 * Fortnight digest sender (admin email standard §1, §7). Runs on the 1st and
 * 15th. Sends even when quiet: the quiet digest is the proof that alerting is
 * alive. There is no daily digest and no all-clear mail anywhere else.
 *
 * Talks to SES directly (bypasses sendEmail()'s suppression gate) so the
 * operator never silently misses it; honours EMAIL_MODE=console for dev.
 */
export type SendDigestResult =
  | { status: "sent"; subject: string }
  | { status: "console"; subject: string }
  | { status: "not_production" }
  | { status: "missing_recipient" }
  | { status: "ses_error"; error: string };

export async function sendFortnightDigest(): Promise<SendDigestResult> {
  const to = process.env.ADMIN_NOTIFY_EMAIL?.trim();
  if (!to) {
    console.warn("[admin-digest] ADMIN_NOTIFY_EMAIL is not set: fortnight digest NOT sent");
    return { status: "missing_recipient" };
  }
  const environment = environmentLabel();
  const policy = emailPolicy(environment);
  if (!policy.send) return { status: "not_production" };

  const appUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  const digest = await collectFortnightDigest("BetterOSF", environment, appUrl ? `${appUrl}/admin` : undefined);
  const { subject, html, text } = renderDigest(digest, { prefix: policy.prefix });

  if (EMAIL_MODE() === "console") {
    console.log(`[admin-digest] (console) to=${to} subject="${subject}"\n${text}`);
    return { status: "console", subject };
  }
  try {
    await getSesClient().send(new SendEmailCommand({
      Source: `${FROM_NAME()} <${FROM_ADDRESS()}>`,
      Destination: { ToAddresses: to.split(",").map((a) => a.trim()).filter(Boolean) },
      Message: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: text } } },
    }));
    return { status: "sent", subject };
  } catch (e) {
    console.error("[admin-digest] SES send failed:", e);
    return { status: "ses_error", error: e instanceof Error ? e.message : String(e) };
  }
}
