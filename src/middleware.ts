import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { incrementWindow } from "@/lib/limits";
import { canonicalGuidPath } from "@/lib/osf/url-bridge";

const NAV_LIMIT_PER_MIN = 60;
const API_LIMIT_PER_MIN = 240;
const EXPENSIVE_API_LIMIT_PER_MIN = 80;

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

// Content-Security-Policy is built per-request here (not in next.config) so each
// document gets a fresh script nonce. The OSF access token lives briefly in browser
// memory during direct-to-OSF uploads, so a strong CSP is the key exfil defense.
const CSP_BASE_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "frame-src 'self' blob: data:",
  "worker-src 'self' blob:",
  /**
   * Where the browser may send a request at all.
   *
   * This is what confines a leaked or mis-targeted credential: the OSF token can only go
   * to same-origin or OSF, and the Zenodo token only to Zenodo. Widen it by exact host,
   * never by wildcard — `https://*.zenodo.org` would authorise every subdomain anyone
   * ever stands up there.
   *
   * ⚠️ **A destination the app fetches from MUST be listed here.** The Zenodo transfer
   * shipped in v1.9.0 without this line being updated, so every request to zenodo.org was
   * blocked by the browser before it left the page — surfacing as
   * `TypeError: NetworkError when attempting to fetch resource`, which names neither CSP
   * nor the host and looks exactly like a network outage. The OSF half kept working, which
   * made it look like a Zenodo problem. Verified 2026-08-14: Zenodo's own CORS was fine all
   * along; this header was the block.
   *
   * Both Zenodo instances are listed because `ZENODO_ENV` chooses between them at runtime,
   * and multipart part-upload URLs were measured to be on the same host as the API.
   */
  "connect-src 'self' https://*.osf.io https://zenodo.org https://sandbox.zenodo.org",
];

function buildCsp(nonce: string): string {
  // Modern browsers honor `nonce` + `strict-dynamic` and IGNORE the trailing
  // `'unsafe-inline' https:` (kept only as a fallback for browsers without
  // strict-dynamic). `'wasm-unsafe-eval'` is orthogonal to strict-dynamic and keeps
  // the Shiki code-viewer's WebAssembly highlighter working.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' 'unsafe-inline' https:`;
  return [scriptSrc, ...CSP_BASE_DIRECTIVES].join("; ");
}

/**
 * Final navigation passthrough with a per-request nonce CSP. The nonce is placed on
 * the forwarded request's CSP header so Next.js applies it to its own bootstrap
 * scripts, and on the `x-nonce` header so the root layout can hand it to next-themes'
 * inline script. The same CSP is set on the response.
 */
function navPassthrough(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return noIndexHeaders(res);
}

function textResponse(body: string, status: number, retryAfter?: string): NextResponse {
  const res = new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  if (retryAfter) res.headers.set("Retry-After", retryAfter);
  return noIndexHeaders(res);
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
  const host = req.nextUrl.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
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

  // Localhost bypasses per-IP rate limiting so full QA runs stay repeatable
  // without false 429s — placed AFTER canonicalisation (which is pure string
  // logic with no OSF call) so localhost behavior stays identical to prod.
  if (isLocalHost) return navPassthrough(req);

  // The per-IP limits are NOT tiered by sign-in state. The old code granted a 5×
  // multiplier whenever an `authjs.session-token` cookie was merely PRESENT, which
  // an anonymous client could forge to claim the higher tier and burn the shared
  // OSF app-token quota. Verifying the JWT in Edge middleware is brittle, so we
  // apply one flat per-IP budget to everyone — the base limits below are generous
  // for a single human, and OSF's own per-token quota is the real backstop.
  const ip = requestIp(req);
  if (pathname.startsWith("/api/")) {
    const expensive =
      pathname.startsWith("/api/zip/") ||
      pathname.includes("/download") ||
      pathname.includes("/folder");
    const limit = expensive ? EXPENSIVE_API_LIMIT_PER_MIN : API_LIMIT_PER_MIN;
    const key = `ip:${ip}:api:${expensive ? "expensive" : "general"}:1min`;
    const count = await incrementWindow(key, 60);
    if (count > limit) return textResponse("Too many requests. Please wait and try again.", 429, "60");
    return noIndexHeaders(NextResponse.next());
  }

  const secFetchMode = req.headers.get("sec-fetch-mode");
  if (secFetchMode && secFetchMode !== "navigate" && secFetchMode !== "cors") {
    return navPassthrough(req);
  }

  const key = `ip:${ip}:nav:1min`;
  const count = await incrementWindow(key, 60);
  if (count > NAV_LIMIT_PER_MIN) {
    return textResponse(
      "Too many requests. BetterOSF rate-limits traffic to 60 page navigations per minute per IP. Please wait.",
      429,
      "60"
    );
  }

  return navPassthrough(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
