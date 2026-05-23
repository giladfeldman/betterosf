import "server-only";

let kvImpl: typeof import("@vercel/kv") | null = null;
function getKv() {
  if (kvImpl !== null) return kvImpl;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  // Lazy require so dev/test environments without KV don't load it
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  kvImpl = require("@vercel/kv");
  return kvImpl;
}

export function isKvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// In-memory fallback used when KV isn't configured (dev + tests).
// Stores { value, expiresAt } per key. Single-process only.
const memStore = new Map<string, { value: number; expiresAt: number }>();

function memIncr(key: string, ttlSec: number): number {
  const now = Date.now();
  const existing = memStore.get(key);
  if (!existing || existing.expiresAt <= now) {
    memStore.set(key, { value: 1, expiresAt: now + ttlSec * 1000 });
    return 1;
  }
  existing.value += 1;
  memStore.set(key, existing);
  return existing.value;
}

function memGet(key: string): number {
  const now = Date.now();
  const existing = memStore.get(key);
  if (!existing || existing.expiresAt <= now) return 0;
  return existing.value;
}

/**
 * Increment a counter that auto-expires at the end of the UTC day.
 * Returns the new value. Used for per-day API quotas.
 */
export async function incrementDaily(key: string): Promise<number> {
  const now = new Date();
  const endOfDayMs =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
  const ttlSec = Math.max(60, Math.floor(endOfDayMs / 1000));
  const kv = getKv();
  if (!kv) return memIncr(key, ttlSec);
  const val = await kv.kv.incr(key);
  if (val === 1) await kv.kv.expire(key, ttlSec);
  return val;
}

/**
 * Increment a counter that auto-expires after `windowSec`. Used for per-IP rate limits.
 */
export async function incrementWindow(key: string, windowSec: number): Promise<number> {
  const kv = getKv();
  if (!kv) return memIncr(key, windowSec);
  const val = await kv.kv.incr(key);
  if (val === 1) await kv.kv.expire(key, windowSec);
  return val;
}

export async function getCount(key: string): Promise<number> {
  const kv = getKv();
  if (!kv) return memGet(key);
  const val = await kv.kv.get<number>(key);
  return typeof val === "number" ? val : 0;
}

// Test-only — clear in-memory state between tests
export function _resetForTests(): void {
  memStore.clear();
}
