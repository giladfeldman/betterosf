import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/db/schema";
import MessageValidator from "sns-validator";
import { logEventAwaited } from "@/lib/logger";
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

/**
 * SES event types we receive and deliberately do nothing with.
 *
 * Listed EXPLICITLY so that "ignored on purpose" and "we have never seen this shape
 * before" cannot render identically — the second warns, and that difference is the
 * whole point of the list.
 */
const KNOWINGLY_IGNORED_EVENTS = new Set([
  "Delivery",
  "Send",
  "Reject",
  "Open",
  "Click",
  "Rendering Failure",
  "DeliveryDelay",
  "Subscription",
]);

/**
 * The message SES publishes, in EITHER of its two shapes. See `handleSnsEvent` for
 * why there are two.
 */
type SesMessage = {
  /** Identity-level notifications use this name... */
  notificationType?: string;
  /** ...and configuration-set EVENT DESTINATIONS use this one. */
  eventType?: string;
  bounce?: {
    bounceType?: "Permanent" | "Transient" | "Undetermined";
    bouncedRecipients: { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: {
    complainedRecipients: { emailAddress: string }[];
  };
  mail?: { messageId?: string };
};

/**
 * Record an SNS notification we could not act on.
 *
 * KEYS ONLY, NEVER VALUES: the payload carries recipient addresses, and the keys are
 * the better diagnostic anyway — they name the field we failed to understand. Written
 * to BOTH the durable log (visible at /admin/logs) and the platform log, because a
 * trace that only exists when the database is up is not a trace during an outage.
 *
 * AWAITED, not fire-and-forget. This runs in a serverless function that may be frozen
 * the instant it answers, so a floating insert is a trace that sometimes does not
 * exist — which is the same failure mode this whole fix is about.
 */
async function warnUnhandled(message: string, context: Record<string, unknown>): Promise<void> {
  console.warn("[email:sns_unhandled]", message, context);
  await logEventAwaited("warn", "email", message, context);
}

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

  let msg: SesMessage;
  try {
    msg = JSON.parse(payload.Message) as SesMessage;
  } catch {
    // A Message we cannot even parse is the most complete kind of silent discard,
    // so it gets the same treatment as an unrecognised type. Length only — the body
    // may be anything, including recipient addresses.
    await warnUnhandled("SES/SNS message body was not JSON", { bytes: payload.Message.length });
    return { ok: true, inserted: 0 };
  }

  /**
   * SES SPEAKS TWO SHAPES FOR THE SAME EVENT, and this handler understood only one.
   *
   * Identity-level notifications say `notificationType`. Configuration-set EVENT
   * DESTINATIONS say `eventType` — and that is the ONLY mechanism wired up here
   * (`ses-events-betterosf-config` → topic `ses-events-betterosf`; the sending
   * identity `scimeto.app` carries NO identity-level BounceTopic — measured
   * 2026-08-27), so 100% of real bounces arrive as `eventType`.
   *
   * The failure was invisible end to end: signature verified, topic gate passed, JSON
   * parsed, no branch matched, `{ inserted: 0 }`, HTTP 200 — SNS records a SUCCESSFUL
   * delivery. Nothing stored, no address ever suppressed, every dashboard green.
   * Measured on Metaventory 2026-08-26 (fixed there in v0.7.20) as
   * NumberOfNotificationsDelivered=2 / Failed=0 against 0 bounce rows.
   */
  const kind = msg.notificationType ?? msg.eventType;

  const db = getDb();
  let inserted = 0;

  if (kind === "Bounce" && msg.bounce) {
    if (!db) {
      console.warn("[email:sns_no_db]", "bounce received with no database configured");
      return { ok: true, inserted: 0 };
    }
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
  } else if (kind === "Complaint" && msg.complaint) {
    if (!db) {
      console.warn("[email:sns_no_db]", "complaint received with no database configured");
      return { ok: true, inserted: 0 };
    }
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
  } else if (!kind || !KNOWINGLY_IGNORED_EVENTS.has(kind)) {
    // The missing alias above was a one-line bug. That the miss was SILENT is the
    // defect worth fixing: the next unknown shape is by definition the one nobody
    // anticipated. Reached also by a "Bounce" with no `bounce` object — a recognised
    // name in an unrecognised shape is exactly as unactionable.
    await warnUnhandled(`SES/SNS unrecognised notification (${kind ?? "no type field"})`, {
      kind: kind ?? null,
      keys: Object.keys(msg).slice(0, 20),
    });
  }

  return { ok: true, inserted };
}
