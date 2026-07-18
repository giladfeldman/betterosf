import { NextRequest, NextResponse } from "next/server";
import { handleSnsEvent, type SnsEnvelope } from "@/lib/email/webhook-handler";

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
      }
    }
    return NextResponse.json({ ok: true, inserted: result.inserted });
  } catch (err) {
    return NextResponse.json(
      {
        error: "sns_validation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
