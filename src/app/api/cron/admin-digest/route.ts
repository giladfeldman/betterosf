/**
 * GET /api/cron/admin-digest
 *
 * Fortnight admin digest (admin email standard §1): vercel.json schedule
 * "0 6 1,15 * *" — the 1st and 15th, 24 wake-ups a year. Issue alerts are sent
 * as they happen by lib/notifications/admin-alert.ts, never by a cron.
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron adds it; GET only).
 */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendFortnightDigest } from "@/lib/notifications/send-admin-digest";

/** Constant-time compare. Returns false on length mismatch (timingSafeEqual
 * throws otherwise); the expected length is public, not content-derived. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handler(request: NextRequest): Promise<NextResponse> {
  // Compare the RAW CRON_SECRET, never a normalized copy — Vercel Cron
  // interpolates the raw variable, so trimming would mutate the credential.
  // .trim() only decides whether a secret is configured (whitespace-only is an
  // operator error, not a credential), and timingSafeEqual avoids the
  // byte-at-a-time leak a plain !== has. (R-0111 / R-0700, 2026-08-05)
  const secret = process.env.CRON_SECRET ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secret.trim() || !timingSafeEqualStr(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await sendFortnightDigest();
  // A failed send is a failed cron run (visible in the platform's cron log), not a 200.
  const failed = result.status === "ses_error" || result.status === "missing_recipient";
  return NextResponse.json({ ok: !failed, result }, { status: failed ? 500 : 200 });
}

export const GET = handler;
