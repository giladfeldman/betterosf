import { isValidGuid } from "@/lib/osf/guid";
import { getCitation, getStyledCitation, toBibTeX, toRIS } from "@/lib/osf/citation";
import { appErrorResponse, osfErrorResponse } from "@/lib/osf/error-response";
import { OsfError } from "@/lib/osf/types";
import { auth } from "@/auth";

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
 * Errors are NOT swallowed (d-318f33, review R-0118). Each format used to be
 * `.catch`'d to "", so an expired token answered 200 with every format empty — the
 * panel then said "No citation metadata available", a failure presented as a fact —
 * and that empty answer was cached `public` for five minutes. OSF's genuine "no
 * metadata" case is a 200 with an empty body, which `getStyledCitation` already turns
 * into "", so nothing legitimate needs a catch.
 *
 * Caching: errors are never cached (`osfErrorResponse` sends `no-store`). A signed-in
 * success may describe a private project, so it is `private`; only an anonymous
 * success — which any visitor could fetch — may be shared.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return new Response("Invalid GUID", { status: 400 });

  let signedIn = false;
  try {
    const session = await auth();
    signedIn = Boolean(session?.accessToken);
  } catch {
    signedIn = false;
  }

  try {
    const settled = await Promise.allSettled([
      getCitation(guid),
      getStyledCitation(guid, "apa"),
      getStyledCitation(guid, "mla"),
      getStyledCitation(guid, "chicago-author-date"),
    ]);
    const failure = mostActionableFailure(settled);
    if (failure !== undefined) throw failure;
    const [citation, apa, mla, chicago] = settled.map((s) => (s as PromiseFulfilledResult<unknown>).value) as [
      Awaited<ReturnType<typeof getCitation>>,
      string,
      string,
      string,
    ];

    return Response.json(
      {
        apa,
        mla,
        chicago,
        bibtex: toBibTeX(citation, guid),
        ris: toRIS(citation, guid),
      },
      {
        headers: {
          "Cache-Control": signedIn
            ? "private, max-age=300"
            : "public, max-age=300, stale-while-revalidate=3600",
          Vary: "Cookie",
        },
      },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e, { endpoint: "citation" });
    if (mapped) return mapped;
    console.error(`[osf/citation/${guid}] error:`, e);
    return appErrorResponse({
      status: 500,
      code: "citation_failed",
      error: "Could not load citations.",
      action: "Retry. If it keeps failing, report it with the request id.",
      cause: e,
      logType: "osf",
    });
  }
}

/**
 * Of several failed calls, the one whose message helps the user most: an expired token
 * outranks everything (retrying cannot fix it), then access, existence, throttling, and
 * an OSF outage. Returns `undefined` when every call succeeded.
 */
const RANK: Record<string, number> = { unauthorized: 0, forbidden: 1, not_found: 2, rate_limited: 3, upstream: 4 };
function mostActionableFailure(settled: PromiseSettledResult<unknown>[]): unknown {
  const reasons = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected").map((s) => s.reason);
  if (reasons.length === 0) return undefined;
  const rank = (r: unknown) => (r instanceof OsfError ? RANK[r.code] ?? 5 : 6);
  return [...reasons].sort((a, b) => rank(a) - rank(b))[0];
}
