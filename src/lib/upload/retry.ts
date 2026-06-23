export type RetryOpts = {
  maxAttempts: number;
  shouldRetry?: (error: unknown) => boolean;
  /** ms backoff for attempt n (1-based, the attempt that just failed). */
  backoffMs?: (attempt: number) => number;
  /** If the error carries a server `Retry-After` (e.g. a 429), honor it instead of
   *  the exponential backoff. Return undefined to fall back to backoffMs. */
  retryAfterMs?: (error: unknown) => number | undefined;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (attempt: number) => void;
  /** Notified with the ms we're about to wait before the next attempt (for live UI). */
  onWait?: (ms: number, error: unknown) => void;
};

const defaultBackoff = (attempt: number) => Math.min(15_000, 1_000 * 2 ** (attempt - 1));
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const { maxAttempts, shouldRetry = () => true, backoffMs = defaultBackoff, retryAfterMs, sleep = defaultSleep, onAttempt, onWait } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt?.(attempt);
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) break;
      // A server-supplied Retry-After (429) wins over the exponential backoff,
      // capped so a hostile/huge value can't stall the whole upload.
      const after = retryAfterMs?.(error);
      const wait = after !== undefined ? Math.min(after, 60_000) : backoffMs(attempt);
      onWait?.(wait, error);
      await sleep(wait);
    }
  }
  throw lastError;
}
