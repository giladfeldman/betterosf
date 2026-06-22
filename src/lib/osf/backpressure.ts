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
 * Returns the backpressure kind, or `null` for real errors (`not_found`,
 * `forbidden`, `unauthorized`, or any non-OsfError) which must keep propagating
 * so existing `notFound()` / auth handling is unchanged.
 */
export function osfBackpressureKind(e: unknown): "rate_limited" | "upstream" | null {
  if (e instanceof OsfError && (e.code === "rate_limited" || e.code === "upstream")) {
    return e.code;
  }
  return null;
}
