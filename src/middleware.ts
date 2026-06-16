import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { incrementWindow } from "@/lib/limits";
import { canonicalGuidPath } from "@/lib/osf/url-bridge";

const NAV_LIMIT_PER_MIN = 60;
const API_LIMIT_PER_MIN = 240;
const EXPENSIVE_API_LIMIT_PER_MIN = 80;
const SIGNED_IN_LIMIT_MULTIPLIER = 5;

const STATIC_FILE_RE = /\.(svg|ico|png|jpe?g|gif|webp|woff2?|css|js|map|txt|xml)$/i;
const SEARCH_BOT_RE =
  /(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex(?:bot)?|sogou|exabot|facebot|facebookexternalhit|twitterbot|linkedinbot|pinterest|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|applebot|amazonbot)/i;
const AI_BOT_RE =
  /(gptbot|chatgpt-user|google-extended|claudebot|anthropic-ai|ccbot|perplexitybot|omgili|diffbot|dataforseobot|cohere-ai|bytespider)/i;
const CLI_BOT_RE =
  /^(curl|wget|python-requests|python-httpx|go-http-client|java\/|okhttp|axios|node-fetch|undici|libwww-perl|scrapy|httpie)/i;
const SCANNER_PATH_RE =
  /^\/(?:wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|\.env|vendor\/phpunit|cgi-bin|actuator|boaform|HNAP1|solr|\.git)(?:\/|$)/i;

function noIndexHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  return res;
}

function textResponse(body: string, status: number, retryAfter?: string): NextResponse {
  const res = new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  if (retryAfter) res.headers.set("Retry-After", retryAfter);
  return noIndexHeaders(res);
}

function isSignedIn(req: NextRequest): boolean {
  return req.cookies.has("__Secure-authjs.session-token") || req.cookies.has("authjs.session-token");
}

function requestIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next/") || STATIC_FILE_RE.test(pathname)) {
    return NextResponse.next();
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (SCANNER_PATH_RE.test(pathname)) return textResponse("Not found", 404);
  if (SEARCH_BOT_RE.test(ua) || AI_BOT_RE.test(ua)) {
    return textResponse("BetterOSF is for direct human use, not indexing or crawling.", 403);
  }
  if (CLI_BOT_RE.test(ua)) return textResponse("Automated clients are not allowed on BetterOSF.", 403);

  // Canonicalise project URLs to BetterOSF's brief, lowercase form (matching
  // OSF's canonical guid): `/3KMR9` -> `/3kmr9`, `/3kmr9/overview` -> `/3kmr9`.
  // Applies to navigations only; API routes and static assets are handled
  // elsewhere. Runs before the signed-in short-circuit so it applies uniformly.
  if (!pathname.startsWith("/api/")) {
    const canonical = canonicalGuidPath(pathname);
    if (canonical && canonical !== pathname) {
      const url = req.nextUrl.clone();
      url.pathname = canonical;
      return noIndexHeaders(NextResponse.redirect(url, 308));
    }
  }

  const signedIn = isSignedIn(req);

  const ip = requestIp(req);
  if (pathname.startsWith("/api/")) {
    const expensive =
      pathname.startsWith("/api/zip/") ||
      pathname.includes("/download") ||
      pathname.includes("/folder") ||
      pathname.includes("/all");
    const baseLimit = expensive ? EXPENSIVE_API_LIMIT_PER_MIN : API_LIMIT_PER_MIN;
    const limit = signedIn ? baseLimit * SIGNED_IN_LIMIT_MULTIPLIER : baseLimit;
    const key = `ip:${ip}:api:${expensive ? "expensive" : "general"}:${signedIn ? "signedin" : "anon"}:1min`;
    const count = await incrementWindow(key, 60);
    if (count > limit) return textResponse("Too many requests. Please wait and try again.", 429, "60");
    return noIndexHeaders(NextResponse.next());
  }

  const secFetchMode = req.headers.get("sec-fetch-mode");
  if (secFetchMode && secFetchMode !== "navigate" && secFetchMode !== "cors") {
    return noIndexHeaders(NextResponse.next());
  }

  const navLimit = signedIn ? NAV_LIMIT_PER_MIN * SIGNED_IN_LIMIT_MULTIPLIER : NAV_LIMIT_PER_MIN;
  const key = `ip:${ip}:nav:${signedIn ? "signedin" : "anon"}:1min`;
  const count = await incrementWindow(key, 60);
  if (count > navLimit) {
    return textResponse(
      signedIn
        ? "Too many requests. Please wait and try again."
        : "Too many requests. BetterOSF rate-limits anonymous traffic to 60 page navigations per minute. Sign in or wait.",
      429,
      "60"
    );
  }

  return noIndexHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
