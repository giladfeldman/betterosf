import { OsfError } from "./types";
import { logWarn } from "@/lib/logger";

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
 * **The body is JSON.** It used to be `new Response("...text...")`, and every
 * caller in the app reads errors with `res.json()` — so the careful message
 * above was parsed, thrown away, and replaced by the client's fallback. A user
 * whose OSF token had expired was told "Could not load your projects (HTTP
 * 401)" instead of "Your OSF connection expired. Reconnect OSF and try again."
 * The message existed the whole time and never reached anybody. (Reported from
 * production, 2026-08-13.)
 *
 * Every response carries:
 *   - `error`     — what a person should read.
 *   - `code`      — stable, for the client to branch on. Never localised.
 *   - `action`    — what to actually DO, when there is something.
 *   - `requestId` — quotable by the user, and the key to the full server-side
 *                   log entry an admin can look up at /admin/logs.
 *   - `at`        — when, so a support conversation has a timestamp.
 *
 * Returns null when the error is NOT a recognised OSF condition, so genuine
 * programming errors keep propagating to the caller's 500 branch instead of
 * being disguised as an upstream problem.
 */

export type ApiErrorBody = {
  error: string;
  code: string;
  action: string | null;
  /** Safe extra context: which upstream, what status. Never a raw upstream body. */
  detail: string | null;
  requestId: string;
  at: string;
};

/** Short, unambiguous, and easy to read aloud or paste into a bug report. */
export function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

type Mapped = {
  status: number;
  code: string;
  error: string;
  action: string | null;
  headers?: Record<string, string>;
};

function mapOsfError(e: OsfError): Mapped | null {
  switch (e.code) {
    case "not_found":
      if (e.status === 410) {
        return {
          status: 410,
          code: "osf_deleted",
          error: "This was deleted on OSF, so there is nothing left to read.",
          action: "Refresh your project list to drop it. Retrying cannot bring it back.",
        };
      }
      return {
        status: 404,
        code: "not_found",
        error: "OSF has no record with that id.",
        action: "Check the link, or open it on osf.io to confirm it still exists.",
      };

    case "unauthorized":
      return {
        status: 401,
        code: "osf_unauthorized",
        error: "Your OSF connection expired.",
        action: "Sign out and sign in again to reconnect OSF, then retry. Retrying alone cannot renew a token.",
      };

    case "forbidden":
      return {
        status: 403,
        code: "osf_forbidden",
        error: "OSF denied access to this.",
        action: "Sign in with an account that has permission on this project.",
      };

    case "rate_limited":
      return {
        status: 429,
        code: "osf_rate_limited",
        error: "OSF asked BetterOSF to slow down.",
        action: "Wait about a minute, then retry. Nothing was changed.",
        headers: { "Retry-After": "60" },
      };

    case "upstream":
      // 502, not 500: the failure is OSF's, not ours. Keeping these distinct
      // stops an OSF outage from reading as a BetterOSF bug in monitoring.
      return {
        status: 502,
        code: "osf_upstream",
        error: "OSF did not respond properly.",
        action: "This is usually a problem at OSF and usually temporary. Check status.cos.io, then retry.",
      };

    default:
      return null;
  }
}

/**
 * An OSF request that hit our per-attempt timeout (`client.ts` aborts a hung connection
 * after 8 s). That is OSF being slow, not a BetterOSF bug, so it must not be a 500 — and
 * "OSF is slow" is advice a user can act on (wait, retry), where "server error" is not.
 */
export function isOsfTimeout(e: unknown): boolean {
  if (e instanceof OsfError) return false;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

const TIMEOUT: Mapped = {
  status: 504,
  code: "osf_timeout",
  error: "OSF is slow to respond right now.",
  action: "Wait a moment, then retry. Nothing was changed.",
};

export function osfErrorResponse(e: unknown, context: { endpoint?: string } = {}): Response | null {
  if (isOsfTimeout(e)) {
    const requestId = newRequestId();
    logWarn("osf", "OSF timeout", { requestId, endpoint: context.endpoint ?? null });
    const body: ApiErrorBody = {
      error: TIMEOUT.error,
      code: TIMEOUT.code,
      action: TIMEOUT.action,
      detail: `OSF did not answer in time${context.endpoint ? ` for ${context.endpoint}` : ""}.`,
      requestId,
      at: new Date().toISOString(),
    };
    return Response.json(body, { status: TIMEOUT.status, headers: { "Cache-Control": "private, no-store" } });
  }
  if (!(e instanceof OsfError)) return null;
  const mapped = mapOsfError(e);
  if (!mapped) return null;

  const requestId = newRequestId();
  const body: ApiErrorBody = {
    error: mapped.error,
    code: mapped.code,
    action: mapped.action,
    detail: `OSF returned HTTP ${e.status}${context.endpoint ? ` for ${context.endpoint}` : ""}.`,
    requestId,
    at: new Date().toISOString(),
  };

  // Logged with the SAME id the user is shown, so "it said req_ab12cd34" is
  // enough for an admin to find the full entry — including anything too
  // detailed or too sensitive to put in the browser.
  logWarn("osf", `OSF ${e.code} (${e.status})`, {
    requestId,
    osfStatus: e.status,
    osfCode: e.code,
    endpoint: context.endpoint ?? null,
    upstreamBody: typeof e.message === "string" ? e.message.slice(0, 500) : null,
  });

  return Response.json(body, {
    status: mapped.status,
    headers: { "Cache-Control": "private, no-store", ...(mapped.headers ?? {}) },
  });
}

/**
 * Build the same shaped body for a failure that is ours rather than OSF's.
 *
 * Kept here so there is exactly one error shape in the app: a client that can
 * render one of these can render all of them.
 */
export function appErrorResponse(input: {
  status: number;
  code: string;
  error: string;
  action?: string | null;
  detail?: string | null;
  /** Logged, never sent. For the underlying exception. */
  cause?: unknown;
  logType?: "osf" | "transition" | "db" | "other";
  logMessage?: string;
}): Response {
  const requestId = newRequestId();
  const body: ApiErrorBody = {
    error: input.error,
    code: input.code,
    action: input.action ?? null,
    detail: input.detail ?? null,
    requestId,
    at: new Date().toISOString(),
  };

  logWarn(input.logType ?? "other", input.logMessage ?? `${input.code} (${input.status})`, {
    requestId,
    status: input.status,
    code: input.code,
    cause:
      input.cause instanceof Error
        ? `${input.cause.name}: ${input.cause.message}`
        : input.cause === undefined
          ? null
          : String(input.cause).slice(0, 500),
  });

  return Response.json(body, {
    status: input.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
