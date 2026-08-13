import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { getMyProjects } from "@/lib/osf/users";
import { osfErrorResponse } from "@/lib/osf/error-response";

export const runtime = "nodejs";
/** One invocation walks every page of the user's node list; 300 projects is ~3 upstream calls. */
export const maxDuration = 60;

/**
 * Tier 1 of the inventory: every project the signed-in user can reach.
 *
 * Deliberately cheap and complete. It returns only what OSF hands back in the node list —
 * title, visibility, dates, parentage — so a researcher with hundreds of projects sees the
 * whole table in seconds rather than waiting on a per-project crawl. Everything costlier
 * (DOI, add-ons, wikis, size) is tier 2, fetched in batches by /api/transition/enrich and
 * filled in progressively.
 *
 * Splitting it this way is a cost decision as much as a UX one: api.osf.io sends no CORS
 * headers, so every metadata call has to pass through us. One invocation here beats one
 * per project by two orders of magnitude.
 */
export async function GET(): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  try {
    const nodes = await getMyProjects();

    return Response.json(
      {
        projects: nodes.map((n) => ({
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
        // The count is the user's own total, not a page size — it is what tells them
        // whether the list they are looking at is everything.
        total: nodes.length,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error("[transition/inventory] error:", e);
    // Honest, not reassuring: the caller is about to make decisions about their data and
    // must know the list they are looking at is incomplete.
    return Response.json(
      { error: "Could not read your project list from OSF. Nothing was changed — try again." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
