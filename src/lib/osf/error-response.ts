import { OsfError } from "./types";

/**
 * Map an OSF failure to an honest HTTP response for an API route.
 *
 * Before this existed, routes mapped OSF errors ad hoc and several collapsed
 * every failure into a generic 500 "try again later". That is wrong in two ways
 * a user actually feels:
 *
 *  - It blames the server for a client-credential problem. An expired OSF token
 *    is a 401, and the only fix is reconnecting — "try again later" is advice
 *    that can never succeed, because retrying does not renew a token.
 *  - It erases the difference between "OSF is down" (theirs, transient) and
 *    "BetterOSF has a bug" (ours, needs fixing), which matters both to the user
 *    reading the message and to anyone reading the logs afterwards.
 *
 * Returns null when the error is NOT a recognised OSF condition, so genuine
 * programming errors keep propagating to the caller's 500 branch instead of
 * being disguised as an upstream problem.
 */
export function osfErrorResponse(e: unknown): Response | null {
  if (!(e instanceof OsfError)) return null;

  switch (e.code) {
    case "not_found":
      return new Response("Not found", { status: 404 });

    case "unauthorized":
      return new Response(
        "Your OSF connection expired. Reconnect OSF and try again.",
        { status: 401 },
      );

    case "forbidden":
      return new Response(
        "OSF denied access to this resource. Sign in with an account that has permission.",
        { status: 403 },
      );

    case "rate_limited":
      return new Response(
        "OSF asked BetterOSF to slow down. Wait a moment, then retry.",
        { status: 429, headers: { "Retry-After": "60" } },
      );

    case "upstream":
      // 502, not 500: the failure is OSF's, not ours. Keeping these distinct
      // stops an OSF outage from reading as a BetterOSF bug in monitoring.
      return new Response(
        "OSF did not respond cleanly. This is usually temporary — please retry.",
        { status: 502 },
      );

    default:
      return null;
  }
}
