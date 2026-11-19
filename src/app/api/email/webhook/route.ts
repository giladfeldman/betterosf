import { NextRequest, NextResponse } from "next/server";
import { handleSnsEvent, SnsSignatureError, type SnsEnvelope } from "@/lib/email/webhook-handler";
import { logEventAwaited, errorDetails } from "@/lib/logger";

/**
 * SES bounce/complaint webhook (via SNS).
 *
 * Refusals answer 4xx: unreadable JSON (400), a bad signature or an untrusted topic (403).
 * Every other failure (the database write, the subscription confirm) answers 503, because
 * SNS treats any answer other than 5xx/429 as delivered and never retries: a Neon hiccup
 * answered with 400 lost the bounce and the address was never suppressed (d-d3473f).
 */
export async function POST(req: NextRequest) {
  let body: SnsEnvelope;
  try {
    body = (await req.json()) as SnsEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const result = await handleSnsEvent(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    if (result.subscribeUrl) {
      const confirm = await fetch(result.subscribeUrl).catch(() => null);
      if (!confirm?.ok) {
        console.error("[email/webhook] SubscribeURL confirm failed", confirm?.status);
        // Retryable: SNS re-sends the confirmation on a 5xx.
        return NextResponse.json({ error: "subscribe_confirm_failed" }, { status: 503 });
      }
    }
    return NextResponse.json({ ok: true, inserted: result.inserted });
  } catch (err) {
    if (err instanceof SnsSignatureError) {
      return NextResponse.json({ error: "sns_validation_failed", message: err.message }, { status: 403 });
    }
    console.error("[email/webhook] internal failure", err);
    await logEventAwaited("error", "email", "SES/SNS webhook failed internally; answered 503 so SNS retries", errorDetails(err)).catch(() => {});
    return NextResponse.json({ error: "internal_error" }, { status: 503 });
  }
}
