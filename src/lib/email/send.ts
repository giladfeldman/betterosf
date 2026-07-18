import { SendEmailCommand } from "@aws-sdk/client-ses";
import { eq } from "drizzle-orm";
import { getDb, requireDb } from "@/lib/db";
import { emailEvents } from "@/lib/db/schema";
import { getSesClient, FROM_ADDRESS, FROM_NAME, EMAIL_MODE, ALLOWLIST } from "./client";
import { isSuppressed } from "./suppression";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
};

export type SendEmailResult =
  | { sent: true; messageId?: string; mode?: "console" }
  | {
      sent: false;
      reason: "suppressed" | "not_on_allowlist" | "duplicate" | "ses_error" | "no_db";
      error?: string;
    };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.toLowerCase();

  const allow = ALLOWLIST();
  if (allow.length > 0 && !allow.includes(to)) {
    return { sent: false, reason: "not_on_allowlist" };
  }

  if (await isSuppressed(to)) {
    await logEvent({ email: to, type: "suppressed_skip", idempotencyKey: input.idempotencyKey });
    return { sent: false, reason: "suppressed" };
  }

  // Claim the idempotency key as "claim" before SES so concurrent callers
  // collide, but SES failures release the claim so retries can send.
  if (input.idempotencyKey) {
    const db = getDb();
    if (!db) return { sent: false, reason: "no_db" };
    const inserted = await db
      .insert(emailEvents)
      .values({
        email: to,
        type: "claim",
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: emailEvents.id });

    if (inserted.length === 0) {
      return { sent: false, reason: "duplicate" };
    }
  }

  if (EMAIL_MODE() === "console") {
    console.log("[email:console]", { to, subject: input.subject });
    if (input.idempotencyKey) {
      await finalizeClaim(input.idempotencyKey, null);
    }
    return { sent: true, mode: "console" };
  }

  try {
    const configSet = process.env.EMAIL_CONFIG_SET?.trim();
    const result = await getSesClient().send(
      new SendEmailCommand({
        Source: `${FROM_NAME()} <${FROM_ADDRESS()}>`,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: input.html, Charset: "UTF-8" },
            ...(input.text ? { Text: { Data: input.text, Charset: "UTF-8" } } : {}),
          },
        },
        ...(configSet ? { ConfigurationSetName: configSet } : {}),
      }),
    );

    if (input.idempotencyKey) {
      await finalizeClaim(input.idempotencyKey, result.MessageId ?? null);
    } else {
      await logEvent({
        email: to,
        type: "sent",
        messageId: result.MessageId ?? null,
      });
    }
    return { sent: true, messageId: result.MessageId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[email:ses_error]", msg);
    if (input.idempotencyKey) {
      await releaseClaim(input.idempotencyKey);
    }
    return { sent: false, reason: "ses_error", error: msg };
  }
}

async function finalizeClaim(idempotencyKey: string, messageId: string | null) {
  try {
    const db = requireDb();
    await db
      .update(emailEvents)
      .set({ type: "sent", messageId })
      .where(eq(emailEvents.idempotencyKey, idempotencyKey));
  } catch {
    /* non-fatal */
  }
}

async function releaseClaim(idempotencyKey: string) {
  try {
    const db = getDb();
    if (!db) return;
    await db.delete(emailEvents).where(eq(emailEvents.idempotencyKey, idempotencyKey));
  } catch {
    /* non-fatal */
  }
}

async function logEvent(row: {
  email: string;
  type: "sent" | "suppressed_skip";
  messageId?: string | null;
  idempotencyKey?: string;
}) {
  try {
    const db = getDb();
    if (!db) return;
    await db.insert(emailEvents).values({
      email: row.email,
      type: row.type,
      messageId: row.messageId ?? null,
      idempotencyKey: row.idempotencyKey,
    });
  } catch {
    /* non-fatal */
  }
}
