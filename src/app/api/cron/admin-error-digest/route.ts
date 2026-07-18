import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendAdminErrorDigest } from "@/lib/notifications/send-admin-digest";

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handler(request: NextRequest): Promise<NextResponse> {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await sendAdminErrorDigest({ windowHours: 24, skipIfEmpty: true });
  return NextResponse.json({ ok: true, result });
}

export const GET = handler;
