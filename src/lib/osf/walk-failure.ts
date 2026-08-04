import { OsfError } from "./types";

/**
 * Failure reasons a deep-path walk can render as page content instead of throwing.
 * Kept in sync with the `Reason` union in {@link "@/components/FileMissing"}.
 */
export type WalkFailureReason = "upstream-error" | "needs-reconnect";

/**
 * Classify an error raised while walking a deep file/folder path.
 *
 * Returns a renderable failure reason, or `null` when the error is NOT an
 * expected OSF condition — those must keep propagating so genuine programming
 * errors still surface loudly rather than hiding behind a friendly panel.
 *
 * `unauthorized` (OSF HTTP 401) is deliberately included. A signed-in user whose
 * OSF token expired previously blew past the walk's catch list and hit the route
 * error boundary, which destroyed the whole page — tree, breadcrumb and all —
 * for what is really a recoverable "reconnect OSF" state. Anonymous requests
 * send no bearer token and never see a 401, which is why this only ever bit
 * signed-in users and never showed up in anonymous QA.
 */
/**
 * Decide what an EMPTY provider list means for the file-view route.
 *
 * That route has a long-standing fallback: when a resource reports no providers
 * at all, it synthesises a direct Waterbutler URL so the file can still be
 * fetched. That is correct for a genuinely provider-less resource, but WRONG
 * when the list is empty because OSF rejected our token — the synthesised URL
 * carries the same dead credential and 401s too, so the user would get a broken
 * viewer instead of a "reconnect OSF" prompt.
 *
 * Returns "needs-reconnect" when the emptiness is an auth artifact, "fallback"
 * when the direct-URL path is legitimate, and "wrong-provider" otherwise.
 */
export function classifyEmptyProviders(opts: {
  unauthorized: boolean;
  providerCount: number;
  hasProvider: boolean;
  hasPathSegments: boolean;
}): "needs-reconnect" | "fallback" | "wrong-provider" {
  if (opts.unauthorized) return "needs-reconnect";
  if (opts.providerCount === 0 && opts.hasProvider && opts.hasPathSegments) return "fallback";
  return "wrong-provider";
}

export function classifyWalkFailure(e: unknown): WalkFailureReason | null {
  if (!(e instanceof OsfError)) return null;
  if (e.code === "unauthorized") return "needs-reconnect";
  if (
    e.code === "not_found" ||
    e.code === "forbidden" ||
    e.code === "rate_limited" ||
    e.code === "upstream"
  ) {
    return "upstream-error";
  }
  return null;
}
