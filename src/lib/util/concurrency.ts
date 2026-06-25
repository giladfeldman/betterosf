/**
 * Run `worker` over `items` with at most `concurrency` in flight at once,
 * preserving input order in the returned array. A drop-in bounded `Promise.all`:
 * it caps fan-out so large OSF projects don't fire hundreds of simultaneous
 * round-trips (which risk rate-limit 429s and Vercel function timeouts) while
 * still overlapping work instead of going fully sequential.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const out: R[] = new Array(items.length);
  let index = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) return;
      out[i] = await worker(items[i] as T, i);
    }
  }
  await Promise.all(Array.from({ length: safeConcurrency }, () => run()));
  return out;
}
