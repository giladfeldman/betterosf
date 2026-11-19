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
 * the response back to the client from our own origin. A signed-in user's
 * own OAuth token is used when present; an anonymous visitor is fetched
 * anonymously, never with the app token (d-ff4462: that account could read
 * private projects, so borrowing it served private files to signed-out visitors).
 *
 * Security: SSRF guard rejects any downloadUrl that's not on osf.io /
 * files.osf.io / files.de-1.osf.io.
 */
import { isValidGuid } from "@/lib/osf/guid";
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

  // Anonymous fetch: exactly what OSF gives a signed-out request, i.e. public files only.
  // Never the app token (d-ff4462). Measured 2026-11-18: for a PRIVATE file the
  // osf.io/download/<id>/ link redirects to accounts.osf.io/login, which answers 200 with
  // a 26 KB HTML sign-in page; followed blindly, that page was served (and edge-cached for
  // a day) as the file. A public file's link redirects to files.<region>.osf.io instead,
  // and the Waterbutler address answers a private file with a clean 403. So the first hop
  // from osf.io is taken by hand, and a redirect anywhere but an OSF file host reads as
  // "not public" (403).
  const anonymousFetch = async (): Promise<Response> => {
    let url = target;
    if (!url.host.startsWith("files.")) {
      const first = await fetch(url.toString(), { headers: buildFetchHeaders(""), redirect: "manual", cache: "no-store" });
      const location = first.status >= 300 && first.status < 400 ? first.headers.get("location") : null;
      if (!location) return first;
      void first.body?.cancel().catch(() => {});
      let next: URL;
      try { next = new URL(location, url); } catch { return new Response("OSF sent an unreadable redirect", { status: 502 }); }
      if (next.protocol !== "https:" || !ALLOWED_HOSTS.has(next.host) || !next.host.startsWith("files.")) {
        return new Response("This file is not public on OSF.", { status: 403 });
      }
      url = next;
    }
    const res = await fetch(url.toString(), {
      headers: buildFetchHeaders(""),
      redirect: "follow",
      // Cache files for a day at the edge — OSF storage URLs are content-addressed,
      // so the response is immutable for a given OSF file revision.
      next: { revalidate: 86400, tags: [`download:${guid}`] },
    });
    // Defence in depth: a redirect that ended on an OSF page (a sign-in page) is not the file.
    const finalHost = res.url ? new URL(res.url).host : "";
    if (res.redirected && (finalHost === "osf.io" || finalHost === "accounts.osf.io")) {
      void res.body?.cancel().catch(() => {});
      return new Response("This file is not public on OSF.", { status: 403 });
    }
    return res;
  };

  let userToken: string | null = null;
  try {
    const session = await auth();
    userToken = session?.osfAuthError ? null : session?.accessToken ?? null;
  } catch { /* anonymous */ }

  // Everyone tries the anonymous, edge-cached fetch first (d-00f6c0): a public file then
  // costs a signed-in viewer no OSF call on a cache hit, and those bytes are public.
  const anonymous = await anonymousFetch();
  if (anonymous.ok && anonymous.body) return relay(anonymous, { filename, forceDownload, privateData: false });
  void anonymous.body?.cancel().catch(() => {});
  if (!userToken) {
    return new Response(`OSF upstream returned ${anonymous.status}`, { status: anonymous.status >= 400 ? anonymous.status : 502 });
  }

  // Not public: the signed-in user's OWN token. Their private files need it on every hop,
  // and fetch drops Authorization on the cross-host redirect osf.io/download ->
  // files.osf.io, so OSF then answered with its sign-in page (local signed-in probe,
  // 2026-10-29). Redirects are therefore followed by hand: the token is sent to OSF hosts
  // ONLY. The last hop is files.osf.io -> a signed object-storage URL on a non-OSF host;
  // that link carries its own signature, rejects a request with Authorization (400), and
  // is fetched without the token.
  let hop = target;
  let res: Response | null = null;
  for (let i = 0; i < 5; i++) {
    const onOsf = ALLOWED_HOSTS.has(hop.host);
    res = await fetch(hop.toString(), { headers: buildFetchHeaders(onOsf ? userToken : ""), redirect: "manual", cache: "no-store" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    void res.body?.cancel().catch(() => {});
    let next: URL;
    try { next = new URL(location, hop); } catch { return new Response("OSF sent an unreadable redirect", { status: 502 }); }
    // Only OSF itself may send us off the allowlist, and never over plain http.
    if (next.protocol !== "https:" || !onOsf) {
      return new Response("Unexpected redirect while fetching from OSF", { status: 502 });
    }
    hop = next;
    res = null;
  }
  if (res && res.ok && res.body) return relay(res, { filename, forceDownload, privateData: true });
  void res?.body?.cancel().catch(() => {});
  return new Response(`OSF upstream returned ${res?.status ?? "no response"}`, { status: res?.status && res.status >= 400 ? res.status : 502 });
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
