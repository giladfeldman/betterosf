import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { selectToken } from "@/lib/osf/tokens";
import { isOsfTimeout } from "@/lib/osf/error-response";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Raw markdown for one OSF wiki page.
 *
 * Proxied rather than fetched from the browser because `api.osf.io` sends NO CORS headers
 * at all — verified 2026-08-13 on both a GET and an OPTIONS preflight. Only Waterbutler
 * (`files.osf.io`) is browser-reachable, which is why file bytes go direct and this does
 * not.
 *
 * Wikis are the highest-value thing here: OSF has no wiki export in its own UI, and its
 * help guide tells people to copy the text out by hand. This is the only way to get them
 * out in bulk.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ wikiId: string }> },
): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const { wikiId } = await params;
  // OSF guids are 5 chars, but wiki ids come from the same space — validate the shape
  // rather than interpolating whatever arrived into a URL.
  if (!/^[a-z0-9]{5,10}$/i.test(wikiId)) {
    return Response.json({ error: "Not a valid wiki id." }, { status: 400, headers: noStore });
  }

  // Bounded, and a failure to reach OSF is reported as OSF's (d-08edd3): 504 when it was
  // slow, 502 when the connection failed — never an unhandled 500.
  let upstream: Response;
  try {
    upstream = await fetch(`https://api.osf.io/v2/wikis/${wikiId}/content/`, {
      headers: { Authorization: `Bearer ${await selectToken()}` },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const timedOut = isOsfTimeout(e);
    return Response.json(
      {
        error: timedOut ? "OSF is slow to respond right now." : "Could not reach OSF for this wiki page.",
        code: timedOut ? "osf_timeout" : "osf_unreachable",
      },
      { status: timedOut ? 504 : 502, headers: noStore },
    );
  }

  if (!upstream.ok) {
    return Response.json(
      { error: `OSF returned ${upstream.status} for this wiki page.` },
      { status: upstream.status === 404 ? 404 : 502, headers: noStore },
    );
  }

  const text = await upstream.text();

  // A wiki page can legitimately be empty, and an empty page must not read as a failure —
  // but it also must not silently become a zero-byte file with no explanation. The export
  // records the byte count either way; the caller compares it against OSF's reported size.
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", ...noStore },
  });
}

const noStore = { "Cache-Control": "private, no-store" } as const;
