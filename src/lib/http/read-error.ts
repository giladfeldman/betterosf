// Read a failed `Response` into a structured, human-readable error — preserving the
// REAL body even when it isn't JSON. The upload UI used to show a generic "Upload
// failed" because client code only read `res.json().error`; but a 429 from our
// middleware is `text/plain` ("Too many requests…") and a crashed function is a
// Vercel HTML 500 page, so `.error` was undefined and the true cause was lost.

export type ReadError = { status: number; code?: string; message: string };

/** Parse `Retry-After` (seconds or HTTP-date) into milliseconds, if present. */
export function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isNaN(seconds)) return Math.max(1_000, seconds * 1000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(1_000, date - Date.now());
  return undefined;
}

/** Structured error from a non-ok Response. Tries JSON `{error|message|detail, code}`,
 *  then falls back to the raw response text, always prefixed with the HTTP status. */
export async function readErrorResponse(res: Response): Promise<ReadError> {
  const status = res.status;
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    /* body unreadable */
  }
  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        const msg = rec.error ?? rec.message ?? rec.detail;
        const code = typeof rec.code === "string" ? rec.code : undefined;
        if (typeof msg === "string" && msg.trim()) {
          return { status, code, message: `HTTP ${status} — ${msg.trim()}` };
        }
      }
    } catch {
      /* not JSON — fall through to raw text */
    }
  }
  const raw = trimmed.replace(/\s+/g, " ").slice(0, 300);
  return { status, message: raw ? `HTTP ${status} — ${raw}` : `HTTP ${status}` };
}

/** Error carrying `status`/`code`/`retryAfterMs` for the upload classifier + retry logic. */
export type HttpError = Error & { status?: number; code?: string; retryAfterMs?: number };

/** Throw an `HttpError` built from a non-ok Response (status, code, real message, Retry-After). */
export async function throwFromResponse(res: Response, fallback = "Request failed"): Promise<never> {
  const { status, code, message } = await readErrorResponse(res);
  const e = new Error(message || fallback) as HttpError;
  e.status = status;
  e.code = code;
  const retry = parseRetryAfter(res);
  if (retry !== undefined) e.retryAfterMs = retry;
  throw e;
}
