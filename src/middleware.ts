import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { incrementWindow } from "@/lib/limits";

const NAV_LIMIT_PER_MIN = 60;

export async function middleware(req: NextRequest) {
  // Only meter page navigations; skip API + assets
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.match(/\.(svg|ico|png|jpe?g|gif|webp|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  // Skip rate-limit for signed-in users (they consume their own OSF quota).
  const cookies = req.cookies;
  if (
    cookies.has("__Secure-authjs.session-token") ||
    cookies.has("authjs.session-token")
  ) {
    return NextResponse.next();
  }

  // Best-effort IP — Vercel sets x-forwarded-for and x-real-ip.
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const key = `ip:${ip}:nav:1min`;
  const count = await incrementWindow(key, 60);

  if (count > NAV_LIMIT_PER_MIN) {
    return new NextResponse(
      "Too many requests. BetterOSF rate-limits anonymous traffic to 60 page navigations per minute. Sign in or wait.",
      { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain" } }
    );
  }

  return NextResponse.next();
}

export const config = {
  // Match everything except internal assets — fine-grained skips above
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
