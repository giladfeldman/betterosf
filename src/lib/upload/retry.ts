export type RetryOpts = {
  maxAttempts: number;
  shouldRetry?: (error: unknown) => boolean;
  /** ms backoff for attempt n (1-based, the attempt that just failed). */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (attempt: number) => void;
};

const defaultBackoff = (attempt: number) => Math.min(15_000, 1_000 * 2 ** (attempt - 1));
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const { maxAttempts, shouldRetry = () => true, backoffMs = defaultBackoff, sleep = defaultSleep, onAttempt } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt?.(attempt);
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}
