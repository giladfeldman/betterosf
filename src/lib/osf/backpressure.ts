import { OsfError } from "./types";

/**
 * Classifies an OSF failure as transient *backpressure* — OSF asked BetterOSF to
 * slow down (HTTP 429 → `rate_limited`) or OSF itself hiccuped persistently
 * (5xx → `upstream`, after the client's in-flight retries already absorbed the
 * one-off blips). Backpressure is NOT a fault on our side.
 *
 * Callers on a critical render path should render a soft HTTP 200 "retry" state
 * (see {@link "@/components/OsfBackpressureNotice"}) instead of rethrowing:
 * an unhandled throw in a server component becomes a Next.js HTTP 500, which is
 * exactly what tripped Vercel's "5xx errors on /[guid] from api.osf.io rate
 * limiting" alert (2026-06-22). OSF rate-limits BetterOSF's shared Vercel egress
 * IP, so a traffic burst across many guids 5xx'd every cache-miss request.
 *
 * `unauthorized` (HTTP 401) is included as its own kind, `needs_reconnect`. It
 * is not backpressure, but it IS recoverable and must fail soft for the same
 * reason: a signed-in user whose OSF token expired previously hit the route
 * error boundary on every project and deep-file page, losing the tree and any
 * way to recover, for what is really a one-click reconnect (user report
 * 2026-08-04). Anonymous requests send no bearer token and never see a 401,
 * which is why anonymous QA never caught it.
 *
 * Returns the kind, or `null` for real errors (`not_found`, `forbidden`, or any
 * non-OsfError) which must keep propagating so existing `notFound()` handling
 * is unchanged.
 */
export type OsfSoftFailureKind = "rate_limited" | "upstream" | "needs_reconnect";

export function osfBackpressureKind(e: unknown): OsfSoftFailureKind | null {
  if (!(e instanceof OsfError)) return null;
  if (e.code === "rate_limited" || e.code === "upstream") return e.code;
  if (e.code === "unauthorized") return "needs_reconnect";
  return null;
}
