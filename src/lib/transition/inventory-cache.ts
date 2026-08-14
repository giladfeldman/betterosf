/**
 * A browser-side cache of the project inventory.
 *
 * Reading 443 projects out of OSF takes five upstream pages and about half a minute, and
 * the answer barely changes from day to day. Paying that on every visit is the difference
 * between a tool you open casually and one you avoid — so the list is cached locally and
 * refreshed only when the researcher asks.
 *
 * Four rules, each of which exists because breaking it would be worse than having no cache:
 *
 * 1. **Keyed by OSF user.** The cache holds the TITLES OF PRIVATE PROJECTS. On a shared or
 *    lab machine, an unkeyed cache would show one researcher another's private work after
 *    a sign-out and sign-in. The key includes the OSF user id, and a cache written for
 *    somebody else is simply not read.
 *
 * 2. **Only a COMPLETE load is cached.** The inventory loads page by page and can fail
 *    partway. Storing what arrived and presenting it later as the whole list is the
 *    false-green this project exists to avoid — the researcher would be deciding what to
 *    migrate from a list quietly missing a hundred projects. A partial load is shown, with
 *    its warning, and never written.
 *
 * 3. **The age is always visible, and never silently refreshed.** No TTL that expires
 *    things behind the user's back, and no background refetch that makes the screen
 *    disagree with the timestamp above it. It says when it was fetched; the user decides.
 *
 * 4. **Every failure is survivable.** `localStorage` throws on quota, is absent in private
 *    modes, and can contain anything a previous version wrote. Nothing here may take the
 *    page down; a cache that cannot be read is simply a cache miss.
 */

/** Bump when the cached shape changes — an old entry is then ignored, never misread. */
const CACHE_VERSION = 1;
const KEY_PREFIX = "betterosf.inventory";

/** Exactly the fields the table renders. Descriptions and tags are deliberately not kept. */
export type CachedProject = {
  guid: string;
  title: string;
  category: string;
  public: boolean;
  dateModified: string;
  osfUrl: string;
  parentId: string | null;
};

export type CachedEnrichment = {
  guid: string;
  hasDoi: boolean | null;
  doi: string | null;
  addonProviders: string[] | null;
  wikiCount: number | null;
  storage: unknown;
};

export type InventoryCache = {
  version: number;
  osfUserId: string;
  /** ISO timestamp of the fetch this came from. Shown to the user verbatim. */
  fetchedAt: string;
  projects: CachedProject[];
  /** OSF's own count at fetch time, for the "is this still everything" question. */
  total: number | null;
  /** Enrichment results, when the check has been run. Keyed by guid. */
  enriched: Record<string, CachedEnrichment>;
  /** ISO timestamp of the last enrichment pass, or null if it has never been run. */
  enrichedAt: string | null;
};

function keyFor(osfUserId: string): string {
  return `${KEY_PREFIX}.v${CACHE_VERSION}.${osfUserId}`;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Access itself throws in some privacy modes.
    return null;
  }
}

export function readInventoryCache(osfUserId: string): InventoryCache | null {
  if (!osfUserId) return null;
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(keyFor(osfUserId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const cache = parsed as InventoryCache;

    // Every one of these is a way a stale or foreign entry could be misread as this
    // user's current list.
    if (cache.version !== CACHE_VERSION) return null;
    if (cache.osfUserId !== osfUserId) return null;
    if (!Array.isArray(cache.projects) || cache.projects.length === 0) return null;
    if (typeof cache.fetchedAt !== "string" || Number.isNaN(Date.parse(cache.fetchedAt))) return null;

    return {
      ...cache,
      enriched: cache.enriched && typeof cache.enriched === "object" ? cache.enriched : {},
      enrichedAt: typeof cache.enrichedAt === "string" ? cache.enrichedAt : null,
      total: typeof cache.total === "number" ? cache.total : null,
    };
  } catch {
    return null;
  }
}

/**
 * Write the cache. Returns whether it was actually stored.
 *
 * The boolean is not decoration: a caller that assumed success would show "cached" against
 * nothing, and the user would wonder why every visit is slow.
 */
export function writeInventoryCache(cache: InventoryCache): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(keyFor(cache.osfUserId), JSON.stringify(cache));
    return true;
  } catch {
    // Quota exceeded, or storage disabled mid-session. A cache miss next time is a
    // slow page, not a broken one.
    return false;
  }
}

export function clearInventoryCache(osfUserId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keyFor(osfUserId));
  } catch {
    /* nothing to do — the next read will simply miss */
  }
}

/**
 * How old the cache is, in words.
 *
 * Deliberately plain and slightly pessimistic at the boundaries: "2 days ago" for anything
 * in its second day, rather than rounding up to "3" and making a fresh list look stale.
 */
export function describeAge(fetchedAt: string, now: Date): string {
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return "at an unknown time";
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Past this, the UI says so louder — a month-old list is a bad basis for a decision. */
export const STALE_AFTER_DAYS = 7;

export function isStale(fetchedAt: string, now: Date): boolean {
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return true;
  return now.getTime() - then > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
