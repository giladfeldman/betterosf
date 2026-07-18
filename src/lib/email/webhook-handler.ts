import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/db/schema";
import MessageValidator from "sns-validator";
import { clearSuppressionCache } from "./suppression";

export type SnsEnvelope = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  Message?: string;
  SubscribeURL?: string;
  TopicArn?: string;
};

export type HandleResult =
  | { ok: true; inserted: number; subscribeUrl?: string }
  | { ok: false; error: "topic_not_allowed" };

function allowedTopicArns(): Set<string> {
  const raw =
    process.env.SNS_TOPIC_ARN?.trim() ||
    process.env.EMAIL_SNS_TOPIC_ARNS?.trim() ||
    "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function assertAllowedTopic(payload: SnsEnvelope): boolean {
  const allow = allowedTopicArns();
  // Fail closed when allowlist is configured in production-like modes.
  if (allow.size === 0) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
      return false;
    }
    return true; // local/dev without SNS_TOPIC_ARN still verifies signature
  }
  const arn = payload.TopicArn?.trim();
  return Boolean(arn && allow.has(arn));
}

async function verifySignature(payload: SnsEnvelope): Promise<void> {
  const validator = new MessageValidator();
  await new Promise<void>((resolve, reject) => {
    validator.validate(payload as unknown as Record<string, unknown>, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function handleSnsEvent(
  payload: SnsEnvelope,
  opts?: { skipVerify?: boolean },
): Promise<HandleResult> {
  if (!opts?.skipVerify) {
    await verifySignature(payload);
  }

  if (!assertAllowedTopic(payload)) {
    return { ok: false, error: "topic_not_allowed" };
  }

  if (payload.Type === "SubscriptionConfirmation") {
    return { ok: true, inserted: 0, subscribeUrl: payload.SubscribeURL };
  }

  if (payload.Type !== "Notification" || !payload.Message) {
    return { ok: true, inserted: 0 };
  }

  const db = getDb();
  if (!db) return { ok: true, inserted: 0 };

  let msg: {
    notificationType: "Bounce" | "Complaint" | "Delivery";
    bounce?: {
      bounceType?: "Permanent" | "Transient" | "Undetermined";
      bouncedRecipients: { emailAddress: string; diagnosticCode?: string }[];
    };
    complaint?: {
      complainedRecipients: { emailAddress: string }[];
    };
    mail?: { messageId?: string };
  };
  try {
    msg = JSON.parse(payload.Message) as typeof msg;
  } catch {
    return { ok: true, inserted: 0 };
  }

  let inserted = 0;

  if (msg.notificationType === "Bounce" && msg.bounce) {
    for (const r of msg.bounce.bouncedRecipients) {
      const email = r.emailAddress.toLowerCase();
      await db.insert(emailEvents).values({
        email,
        type: "bounce",
        bounceType: msg.bounce.bounceType ?? null,
        messageId: msg.mail?.messageId ?? null,
        reason: r.diagnosticCode ?? null,
        payload: msg,
      });
      clearSuppressionCache(email);
      inserted++;
    }
  } else if (msg.notificationType === "Complaint" && msg.complaint) {
    for (const r of msg.complaint.complainedRecipients) {
      const email = r.emailAddress.toLowerCase();
      await db.insert(emailEvents).values({
        email,
        type: "complaint",
        messageId: msg.mail?.messageId ?? null,
        payload: msg,
      });
      clearSuppressionCache(email);
      inserted++;
    }
  }

  return { ok: true, inserted };
}
