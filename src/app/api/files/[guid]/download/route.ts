/**
 * Same-origin proxy for individual OSF file downloads.
 *
 * Why this exists: OSF responds with `Access-Control-Allow-Origin: https://osf.io`,
 * which blocks client-side `fetch(...)` from any other origin. That made the
 * DOCX viewer (and most other client-side viewers) throw NetworkError on
 * production. The same constraint plus `X-Frame-Options: SAMEORIGIN` on
 * `files.osf.io` blocked the HTML viewer's `<iframe src>` from rendering.
 *
 * This route fetches the OSF download URL server-side (no CORS) and streams
 * the response back to the client from our own origin. The selectToken()
 * helper picks the user's OAuth token when signed in, otherwise the
 * app token — same auth model as the rest of the OSF client. Bandwidth and
 * abuse are bounded by OSF's own per-token limits.
 *
 * Security: SSRF guard rejects any downloadUrl that's not on osf.io /
 * files.osf.io / files.de-1.osf.io.
 */
import { isValidGuid } from "@/lib/osf/guid";
import { selectToken } from "@/lib/osf/tokens";
import { auth } from "@/auth";
import { contentDisposition } from "@/lib/http/content-disposition";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_HOSTS = new Set([
  "osf.io",
  "files.osf.io",
  "files.us.osf.io",
  "files.de-1.osf.io",
  "files.ca-1.osf.io",
  "api.osf.io",
]);

const CONTENT_TYPES_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function contentTypeForName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES_BY_EXT[ext] ?? null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  const url = new URL(req.url);
  const downloadUrl = url.searchParams.get("u");
  const filename = url.searchParams.get("name") ?? "";
  const forceDownload = url.searchParams.get("dl") === "1";
  if (!downloadUrl) return new Response("Missing u (download URL)", { status: 400 });

  // SSRF guard — only allow OSF-owned hosts.
  let target: URL;
  try {
    target = new URL(downloadUrl);
  } catch {
    return new Response("Invalid download URL", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.host)) {
    return new Response("Download URL not on the OSF allowlist", { status: 400 });
  }

  // The downloadUrl from OSF returns a 302 to files.osf.io. Follow redirects.
  // Forward client Range header so PDF.js can request byte ranges for
  // incremental rendering. OSF's S3 backend supports Range requests.
  const rangeHeader = req.headers.get("range");

  const buildFetchHeaders = (bearer: string) => {
    const h: Record<string, string> = { Accept: "application/octet-stream, */*" };
    if (bearer) h["Authorization"] = `Bearer ${bearer}`;
    if (rangeHeader) h["Range"] = rangeHeader;
    return h;
  };

  // A signed-in user's OWN token. Their private files need it on every hop, and fetch
  // drops Authorization on the cross-host redirect osf.io/download -> files.osf.io, so
  // OSF then answered with its sign-in HTML page and the viewer showed that page as the
  // file (found by the local signed-in probe, 2026-10-29). Redirects are therefore
  // followed by hand, and only to OSF hosts — the token never leaves the allowlist.
  let userToken: string | null = null;
  try {
    const session = await auth();
    userToken = session?.osfAuthError ? null : session?.accessToken ?? null;
  } catch { /* anonymous */ }

  if (userToken) {
    let hop = target;
    let res: Response | null = null;
    for (let i = 0; i < 5; i++) {
      res = await fetch(hop.toString(), { headers: buildFetchHeaders(userToken), redirect: "manual", cache: "no-store" });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      let next: URL;
      try { next = new URL(location, hop); } catch { return new Response("OSF sent an unreadable redirect", { status: 502 }); }
      if (next.protocol !== "https:" || !ALLOWED_HOSTS.has(next.host)) {
        return new Response("OSF redirected outside the OSF allowlist", { status: 502 });
      }
      hop = next;
      res = null;
    }
    if (!res || !res.ok || !res.body) {
      return new Response(`OSF upstream returned ${res?.status ?? 508}`, { status: res?.status && res.status >= 400 ? res.status : 502 });
    }
    return relay(res, { filename, forceDownload, privateData: true });
  }

  let token = "";
  try { token = await selectToken(); } catch { /* anonymous */ }
  let upstream = await fetch(target.toString(), {
    headers: buildFetchHeaders(token),
    redirect: "follow",
    // Cache files for a day at the edge — OSF storage URLs are content-addressed,
    // so the response is immutable for a given OSF file revision.
    next: { revalidate: 86400, tags: [`download:${guid}`] },
  });

  // Public OSF files can be fetched without a bearer token. If the app-owned
  // token is expired/revoked, retry anonymously so public viewers do not render
  // as blank iframes or failed downloads.
  if (token && (upstream.status === 401 || upstream.status === 403 || upstream.status === 429)) {
    upstream = await fetch(target.toString(), {
      headers: buildFetchHeaders(""),
      redirect: "follow",
      next: { revalidate: 86400, tags: [`download:${guid}`] },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`OSF upstream returned ${upstream.status}`, { status: upstream.status });
  }

  return relay(upstream, { filename, forceDownload, privateData: false });
}

function relay(
  upstream: Response,
  { filename, forceDownload, privateData }: { filename: string; forceDownload: boolean; privateData: boolean },
): Response {
  const isPartial = upstream.status === 206;

  // Strip the OSF-side CORS / framing headers and replace with our own. We
  // want browsers to:
  //   - allow fetch() from any of our pages (it's same-origin now anyway)
  //   - render the file inline in an iframe / object tag
  //   - keep the upstream content-type so viewers know how to render
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  const inferredContentType = contentTypeForName(filename);
  if (ct && ct !== "application/octet-stream") {
    headers.set("content-type", ct);
  } else if (inferredContentType) {
    headers.set("content-type", inferredContentType);
  } else if (ct) {
    headers.set("content-type", ct);
  }

  if (isPartial) {
    // Forward byte-range response headers so PDF.js can render incrementally.
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    headers.set("accept-ranges", "bytes");
    if (privateData) headers.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: 206, headers });
  }

  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("content-length", cl);
  headers.set("accept-ranges", "bytes");
  if (forceDownload) {
    headers.set("content-disposition", contentDisposition(filename || "download"));
  } else {
    headers.set("content-disposition", "inline");
  }
  // Bytes fetched with a user's own token may be private: never let a shared cache keep
  // them. Anonymous responses keep the edge cache aligned with revalidate above.
  headers.set("cache-control", privateData ? "private, no-store" : "public, max-age=86400");
  // Allow same-origin iframes (HtmlViewer).
  headers.set("x-frame-options", "SAMEORIGIN");

  return new Response(upstream.body, { status: 200, headers });
}
