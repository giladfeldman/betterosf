import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { getMyProjectsPage } from "@/lib/osf/users";
import { osfErrorResponse, appErrorResponse } from "@/lib/osf/error-response";

export const runtime = "nodejs";
/** One invocation now fetches ONE upstream page, so 60s is generous headroom. */
export const maxDuration = 60;

/**
 * Tier 1 of the inventory: the projects the signed-in user can reach, ONE PAGE
 * AT A TIME.
 *
 * It used to walk every page in a single invocation and return the lot. Measured
 * against a real 443-project account on 2026-08-13: **5 pages, 27 seconds**, at
 * 5–7s per upstream page — during which the browser showed one static line of
 * text and nothing else. A user with 400+ projects read that as a hang, which is
 * a fair reading; it is also indistinguishable from one. And the worst case was
 * genuinely unsafe: the client retries each upstream page once with an 8s
 * timeout, so a slow account could exceed this function's 60s ceiling and die
 * with a 504 after half a minute of silence.
 *
 * Paging it fixes both. The first hundred projects are on screen in ~6s, the
 * progress bar has a real denominator (OSF reports `links.meta.total`), and no
 * single invocation is ever more than one upstream call away from returning.
 *
 * Everything costlier (DOI, add-ons, wikis, size) is still tier 2, fetched in
 * batches by /api/transition/enrich and filled in progressively.
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");

  // The cursor is a URL OSF gave us on the previous page. Pinning it to the OSF
  // API host stops this route being turned into an open proxy that would happily
  // fetch anywhere with the user's OSF token attached.
  if (cursor && !isOsfApiUrl(cursor)) {
    return appErrorResponse({
      status: 400,
      code: "bad_cursor",
      error: "That page link is not an OSF API address.",
      action: "Reload the page to start the list again.",
      logType: "transition",
    });
  }

  try {
    const page = await getMyProjectsPage(cursor ?? undefined);

    return Response.json(
      {
        projects: page.nodes.map((n) => ({
          guid: n.id,
          title: n.title,
          description: n.description,
          category: n.category,
          public: n.public,
          tags: n.tags,
          dateCreated: n.dateCreated,
          dateModified: n.dateModified,
          osfUrl: n.osfUrl,
          parentId: n.parentId,
        })),
        /** Pass back verbatim to fetch the next page; null when this was the last. */
        nextCursor: page.next,
        /**
         * OSF's own count of the whole collection, from `links.meta.total`
         * (verified live 2026-08-13: `{"total":443,"per_page":10}`). `null` when
         * OSF did not say — in which case the UI shows a live count rather than
         * inventing a denominator.
         */
        total: page.total,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e, { endpoint: "/v2/users/me/nodes/" });
    if (mapped) return mapped;
    // Honest, not reassuring: the caller is about to make decisions about their
    // data and must know the list they are looking at is incomplete.
    return appErrorResponse({
      status: 502,
      code: "inventory_failed",
      error: "Could not read your project list from OSF.",
      action: "Nothing was changed. Retry — and if it keeps failing, check status.cos.io.",
      detail: "The failure was not a recognised OSF response, so it may be a BetterOSF bug.",
      cause: e,
      logType: "transition",
      logMessage: "transition inventory failed",
    });
  }
}

function isOsfApiUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "api.osf.io";
  } catch {
    return false;
  }
}
