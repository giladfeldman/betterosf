import { isValidGuid } from "@/lib/osf/guid";
import { getCitation, getStyledCitation, toBibTeX, toRIS } from "@/lib/osf/citation";
import { osfErrorResponse } from "@/lib/osf/error-response";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Citation formats, fetched on demand.
 *
 * These used to be four blocking OSF calls in the `/[guid]` server component —
 * roughly 40% of the OSF requests spent rendering a project overview, for a
 * panel most visitors never scroll to. Under OSF rate-limiting that made the
 * overview far more likely to hit a 429 than it needed to be.
 *
 * Moving them here means the overview paints without them and a visitor only
 * spends the calls if they actually open "Cite this".
 *
 * Every format is independently `.catch`'d to "": OSF legitimately returns an
 * empty body for MLA/Chicago on projects without contributor metadata, and one
 * missing style must not blank the whole panel.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  try {
    const [citation, apa, mla, chicago] = await Promise.all([
      getCitation(guid).catch(() => null),
      getStyledCitation(guid, "apa").catch(() => ""),
      getStyledCitation(guid, "mla").catch(() => ""),
      getStyledCitation(guid, "chicago-author-date").catch(() => ""),
    ]);

    return Response.json(
      {
        apa,
        mla,
        chicago,
        bibtex: citation ? toBibTeX(citation, guid) : "",
        ris: citation ? toRIS(citation, guid) : "",
      },
      // Citations change rarely; cache so re-opening the panel is free.
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[osf/citation/${guid}] error:`, e);
    return new Response("Could not load citations.", { status: 500 });
  }
}
