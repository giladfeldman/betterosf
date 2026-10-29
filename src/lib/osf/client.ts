import "server-only";
import { selectToken } from "./tokens";
import { OsfError } from "./types";
import { incrementDaily } from "@/lib/limits";
import { auth } from "@/auth";
import { env } from "@/lib/env";

const OSF_API_BASE = "https://api.osf.io/v2";

const ANON_HEADERS: HeadersInit = {
  Accept: "application/vnd.api+json",
};

function bearerHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let appTokenCooldownUntil = 0;

/**
 * Circuit breaker (d-24c4e3): during an OSF outage or throttle, back off instead of hammering.
 *
 *  - **5xx / network storm.** After `failureThreshold` consecutive calls that ended in an
 *    upstream failure (each already retried once), calls fail fast for `cooldownMs` without
 *    touching OSF. When the cooldown ends, calls go through again; one more failure re-opens
 *    the breaker at once, one success closes it.
 *  - **Anonymous 429.** OSF's anonymous bucket is shared by this server's IP. Once it says
 *    429, anonymous calls skip straight to the app-token fallback until its Retry-After
 *    passes, instead of spending one throttled call per request to re-learn it.
 *  - **Both throttled.** With the anonymous bucket and the app token both cooling down, a
 *    call fails fast as `rate_limited` and OSF is not asked at all.
 *
 * 4xx answers prove OSF is up and reset the count. The state is per server instance; a
 * fleet-wide breaker needs a shared store (Vercel KV), which is not provisioned (cost
 * decision, owner-gated). User-token 429s are that user's own quota and do not trip it.
 */
export const OSF_BREAKER = { failureThreshold: 5, cooldownMs: 30_000 } as const;
let consecutiveUpstreamFailures = 0;
let breakerOpenUntil = 0;
let anonCooldownUntil = 0;

function breakerGuard(): void {
  if (Date.now() < breakerOpenUntil) {
    throw new OsfError(503, "upstream", "OSF is failing repeatedly; BetterOSF is backing off for a moment");
  }
}

function recordOutcome(outcome: "ok" | "upstream"): void {
  if (outcome === "ok") {
    consecutiveUpstreamFailures = 0;
    return;
  }
  consecutiveUpstreamFailures += 1;
  if (consecutiveUpstreamFailures >= OSF_BREAKER.failureThreshold) {
    breakerOpenUntil = Date.now() + OSF_BREAKER.cooldownMs;
  }
}

/** A response we got back: 5xx counts against OSF's health, anything else proves it is up. */
function recordStatus(status: number): void {
  recordOutcome(status >= 500 ? "upstream" : "ok");
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return 60_000;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isNaN(seconds)) return Math.max(1_000, seconds * 1000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(1_000, date - Date.now());
  return 60_000;
}

function cacheKey(url: string): string {
  return `GET ${url}`;
}

function readCache<T>(key: string): T | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown, revalidateSeconds: number): void {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, revalidateSeconds) * 1000,
  });
}

function mapError(status: number, body: string): OsfError {
  if (status === 404) return new OsfError(404, "not_found", "OSF resource not found");
  if (status === 403) return new OsfError(403, "forbidden", "Access to this OSF resource is forbidden");
  if (status === 401) return new OsfError(401, "unauthorized", "OSF authentication required");
  if (status === 429) return new OsfError(429, "rate_limited", "OSF rate limit exceeded");
  if (status >= 500) return new OsfError(status, "upstream", `OSF upstream error ${status}`);
  return new OsfError(status, "unknown", `OSF returned ${status}: ${body.slice(0, 200)}`);
}

export async function osfGet<T = unknown>(
  path: string,
  init?: { revalidate?: number; tags?: string[] }
): Promise<T> {
  const url = `${OSF_API_BASE}${path}`;
  return osfGetUrl<T>(url, init);
}

export async function osfGetUrl<T = unknown>(
  url: string,
  init?: { revalidate?: number; tags?: string[] }
): Promise<T> {
  const revalidate = init?.revalidate ?? 300;
  const next = { revalidate, tags: init?.tags };

  // Public/anonymous browsing should not spend the app token's shared
  // authenticated quota unless OSF's much smaller anonymous bucket is already
  // rate-limited. OSF documents 100/hour unauthenticated vs 10,000/day
  // authenticated; caching before either path is the real quota saver.
  let userToken: string | null = null;
  try {
    const session = await auth();
    userToken = session?.osfAuthError ? null : session?.accessToken ?? null;
  } catch {
    userToken = null;
  }

  const key = cacheKey(url);
  if (!userToken) {
    const cached = readCache<T>(key);
    if (cached) return cached;

    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
  }

  async function fetchJson(
    headers: HeadersInit,
    opts: { sharedCache: boolean }
  ): Promise<{ ok: true; value: T } | { ok: false; res: Response; body: string }> {
    // OSF's API intermittently returns transient 502/503/504s and drops
    // connections (network errors), especially during its recovery windows.
    // A page that fans out several OSF calls (e.g. the guid dispatcher:
    // node-probe → guid-resolve → typed fetch) is statistically likely to hit
    // one of these and 500 the whole page. Retry transient failures a couple
    // of times with short backoff so a single upstream hiccup is absorbed.
    // We do NOT retry 429 (handled by the app-token fallback) or any 4xx.
    // 500 is included: OSF intermittently returns transient 500s on idempotent
    // GET reads, and retrying a read is safe.
    const TRANSIENT = new Set([500, 502, 503, 504]);
    // 2 attempts (1 retry). Bounded worst case = MAX_ATTEMPTS * ATTEMPT_TIMEOUT
    // (~16s) stays under page render budgets even when OSF hangs; a single retry
    // still absorbs the common transient blip.
    const MAX_ATTEMPTS = 2;
    // Backoff base. Zero under test so retries stay instant (tests that mock
    // failures/unmatched handlers must not pay real wall-clock backoff).
    const BACKOFF_MS = process.env.VITEST ? 0 : 150;
    const sleep = (ms: number) =>
      ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));
    // Per-attempt timeout so a hung OSF connection fails fast and retries
    // instead of blocking the whole page render. Zero/disabled under test.
    const ATTEMPT_TIMEOUT_MS = process.env.VITEST ? 0 : 8_000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ac = ATTEMPT_TIMEOUT_MS > 0 ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS) : null;
      try {
        const res = await fetch(url, {
          headers,
          ...(ac ? { signal: ac.signal } : {}),
          ...(opts.sharedCache ? { next } : { cache: "no-store" as const }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (TRANSIENT.has(res.status) && attempt < MAX_ATTEMPTS) {
            await sleep(BACKOFF_MS * attempt);
            continue;
          }
          return { ok: false, res, body };
        }
        return { ok: true, value: (await res.json()) as T };
      } catch (e) {
        // Network-level failure (reset/DNS/abort-timeout). Retry, else rethrow.
        lastError = e;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS * attempt);
          continue;
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError; // unreachable; satisfies the type checker
  }

  // Every network attempt goes through here so the breaker sees its outcome.
  async function attempt(
    headers: HeadersInit,
    opts: { sharedCache: boolean },
  ): Promise<{ ok: true; value: T } | { ok: false; res: Response; body: string }> {
    let result;
    try {
      result = await fetchJson(headers, opts);
    } catch (e) {
      recordOutcome("upstream"); // network failure or timeout, after its retry
      throw e;
    }
    recordStatus(result.ok ? 200 : result.res.status);
    return result;
  }

  const work = (async (): Promise<T> => {
    breakerGuard();

    if (userToken) {
      const result = await attempt(bearerHeaders(userToken), { sharedCache: false });
      if (!result.ok) throw mapError(result.res.status, result.body);
      return result.value;
    }

    if (Date.now() >= anonCooldownUntil) {
      const anonymous = await attempt(ANON_HEADERS, { sharedCache: true });
      if (anonymous.ok) {
        writeCache(key, anonymous.value, revalidate);
        return anonymous.value;
      }

      if (anonymous.res.status !== 429) {
        throw mapError(anonymous.res.status, anonymous.body);
      }
      anonCooldownUntil = Date.now() + retryAfterMs(anonymous.res);
    }

    if (Date.now() < appTokenCooldownUntil) {
      throw new OsfError(429, "rate_limited", "OSF rate limit exceeded (anonymous and app token both cooling down)");
    }

    const token = await selectToken().catch(() => env().OSF_APP_TOKEN);
    const appToken = await attempt(bearerHeaders(token), { sharedCache: true });
    const today = new Date().toISOString().slice(0, 10);
    void incrementDaily(`app:osf:calls:${today}`);

    if (appToken.ok) {
      writeCache(key, appToken.value, revalidate);
      return appToken.value;
    }

    if (appToken.res.status === 429) {
      appTokenCooldownUntil = Date.now() + retryAfterMs(appToken.res);
    }
    throw mapError(appToken.res.status, appToken.body);
  })();

  if (!userToken) {
    inFlight.set(key, work);
    work.finally(() => inFlight.delete(key)).catch(() => {});
  }

  return work;
}

export function _resetOsfClientForTests(): void {
  responseCache.clear();
  inFlight.clear();
  appTokenCooldownUntil = 0;
  consecutiveUpstreamFailures = 0;
  breakerOpenUntil = 0;
  anonCooldownUntil = 0;
}

/*
  Historical note: this client used to send the app-owned PAT first for every
  anonymous public request and only retry anonymously on 401/403/429. That made
  all public users share one authenticated 10,000/day OSF bucket and also risked
  exposing app-token-readable private resources. Anonymous-first plus cache-first
  is the safer public browsing posture; signed-in users still use their own OAuth
  token for private content.
*/
