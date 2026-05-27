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
  let token = "";
  try { token = await selectToken(); } catch { /* anonymous */ }
  let upstream = await fetch(target.toString(), {
    headers: token
      ? { Authorization: `Bearer ${token}`, Accept: "application/octet-stream, */*" }
      : { Accept: "application/octet-stream, */*" },
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
      headers: { Accept: "application/octet-stream, */*" },
      redirect: "follow",
      next: { revalidate: 86400, tags: [`download:${guid}`] },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`OSF upstream returned ${upstream.status}`, { status: upstream.status });
  }

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
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("content-length", cl);
  // Force inline display — viewers embed the response in iframe/img/object.
  headers.set("content-disposition", "inline");
  // Edge cache aligned with revalidate above.
  headers.set("cache-control", "public, max-age=86400");
  // Allow same-origin iframes (HtmlViewer).
  headers.set("x-frame-options", "SAMEORIGIN");

  return new Response(upstream.body, { status: 200, headers });
}
