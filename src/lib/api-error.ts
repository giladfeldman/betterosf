/**
 * Reading an error response without losing what it said.
 *
 * The defect this exists to prevent shipped in production: `osfErrorResponse`
 * returned a plain-text body, every caller read it with `res.json()`, the parse
 * threw, and the catch replaced a precise message ("Your OSF connection
 * expired. Reconnect OSF and try again.") with a useless one ("Could not load
 * your projects (HTTP 401)"). The server had already worked out exactly what was
 * wrong and the answer never reached anybody.
 *
 * So this reads the body ONCE as text and then tries to parse it, which cannot
 * lose the content whatever the route returned — JSON, plain text, an HTML error
 * page from a proxy, or nothing at all. A message is only ever synthesised when
 * the response genuinely carried none.
 */

export type ApiError = {
  /** What to show. Always non-empty. */
  message: string;
  /** What to do about it, when the server said. */
  action: string | null;
  /** Stable machine code, when the server sent one. */
  code: string | null;
  status: number;
  /** Safe technical context for the details panel. */
  detail: string | null;
  /** Quotable id that matches the server-side log entry, when there is one. */
  requestId: string | null;
  at: string | null;
  /** Which call failed. Filled in by the caller, since only it knows. */
  endpoint: string | null;
};

/** Generic wording by status, used only when the response carried no message. */
function fallbackMessage(status: number): string {
  if (status === 401) return "You are not signed in, or your session expired.";
  if (status === 403) return "You do not have access to this.";
  if (status === 404) return "That was not found.";
  if (status === 429) return "Too many requests — wait a moment and retry.";
  if (status === 504) return "The request took too long and timed out.";
  if (status >= 500) return "Something went wrong on the server.";
  return "The request failed.";
}

export async function readApiError(res: Response, endpoint?: string): Promise<ApiError> {
  const raw = await res.text().catch(() => "");

  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  // A non-JSON body is still a message — unless it is an HTML page, which is a
  // proxy or a gateway talking, not our route, and is noise to a reader.
  const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(raw);
  const textMessage = !parsed && !looksLikeHtml ? str(raw) : null;

  return {
    message: str(parsed?.error) ?? textMessage ?? fallbackMessage(res.status),
    action: str(parsed?.action),
    code: str(parsed?.code),
    status: res.status,
    detail:
      str(parsed?.detail) ??
      (looksLikeHtml ? "The response was an HTML page, so it came from a gateway rather than BetterOSF." : null),
    requestId: str(parsed?.requestId),
    at: str(parsed?.at),
    endpoint: endpoint ?? null,
  };
}

/** The same shape for a request that never reached the server at all. */
export function networkError(endpoint: string, cause: unknown): ApiError {
  return {
    message: "Could not reach BetterOSF.",
    action: "Check your connection and retry. Nothing was changed.",
    code: "network",
    status: 0,
    detail: cause instanceof Error ? `${cause.name}: ${cause.message}` : null,
    requestId: null,
    at: new Date().toISOString(),
    endpoint,
  };
}
