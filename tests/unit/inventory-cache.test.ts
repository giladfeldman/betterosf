/**
 * The browser-side inventory cache.
 *
 * It holds the TITLES OF PRIVATE PROJECTS, and it is the basis on which someone decides
 * what to migrate before OSF goes read-only. Both facts set the bar: it must never be
 * shown to the wrong account, and it must never present a partial list as a whole one.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readInventoryCache,
  writeInventoryCache,
  clearInventoryCache,
  describeAge,
  isStale,
  type InventoryCache,
} from "@/lib/transition/inventory-cache";

const project = (guid: string) => ({
  guid,
  title: `Project ${guid}`,
  category: "project",
  public: false,
  dateModified: "2026-08-01T00:00:00Z",
  osfUrl: `https://osf.io/${guid}/`,
  parentId: null,
});

const cacheFor = (osfUserId: string, overrides: Partial<InventoryCache> = {}): InventoryCache => ({
  version: 1,
  osfUserId,
  fetchedAt: "2026-08-13T12:00:00.000Z",
  projects: [project("aaa11"), project("bbb22")],
  total: 2,
  enriched: {},
  enrichedAt: null,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe("round trip", () => {
  it("stores and returns a cache", () => {
    expect(writeInventoryCache(cacheFor("osf-1"))).toBe(true);
    const read = readInventoryCache("osf-1");
    expect(read?.projects).toHaveLength(2);
    expect(read?.fetchedAt).toBe("2026-08-13T12:00:00.000Z");
  });

  it("clears on request", () => {
    writeInventoryCache(cacheFor("osf-1"));
    clearInventoryCache("osf-1");
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("misses cleanly when nothing was stored", () => {
    expect(readInventoryCache("osf-nobody")).toBeNull();
  });
});

describe("it is never shown to the wrong account", () => {
  it("does not return one user's private project titles to another", () => {
    // The scenario: a shared lab machine, one researcher signs out, the next signs in.
    writeInventoryCache(cacheFor("osf-1"));
    expect(readInventoryCache("osf-2")).toBeNull();
  });

  it("refuses an entry whose stored id does not match its own key", () => {
    // Defence against a hand-edited or migrated entry: the id inside is checked too, not
    // just the key it was filed under.
    localStorage.setItem(
      "betterosf.inventory.v1.osf-1",
      JSON.stringify(cacheFor("someone-else")),
    );
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("returns nothing for an empty user id", () => {
    expect(readInventoryCache("")).toBeNull();
  });
});

describe("it refuses to misread anything", () => {
  it("ignores an entry written by an older version rather than reinterpreting it", () => {
    localStorage.setItem("betterosf.inventory.v1.osf-1", JSON.stringify(cacheFor("osf-1", { version: 0 })));
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem("betterosf.inventory.v1.osf-1", "{not json");
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("ignores an entry with no projects, which would render as 'you have none'", () => {
    localStorage.setItem("betterosf.inventory.v1.osf-1", JSON.stringify(cacheFor("osf-1", { projects: [] })));
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("ignores an unparseable timestamp instead of showing an unknown age", () => {
    localStorage.setItem(
      "betterosf.inventory.v1.osf-1",
      JSON.stringify(cacheFor("osf-1", { fetchedAt: "whenever" })),
    );
    expect(readInventoryCache("osf-1")).toBeNull();
  });

  it("tolerates a missing enrichment map rather than throwing", () => {
    localStorage.setItem(
      "betterosf.inventory.v1.osf-1",
      JSON.stringify({ ...cacheFor("osf-1"), enriched: undefined }),
    );
    expect(readInventoryCache("osf-1")?.enriched).toEqual({});
  });
});

describe("a failed write is reported, not assumed", () => {
  it("returns false when storage refuses, so the UI does not claim it cached", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(writeInventoryCache(cacheFor("osf-1"))).toBe(false);
    } finally {
      localStorage.setItem = original;
    }
  });
});

describe("describeAge", () => {
  const at = "2026-08-13T12:00:00.000Z";
  const after = (ms: number) => new Date(Date.parse(at) + ms);

  it("reads naturally at each scale", () => {
    expect(describeAge(at, after(5_000))).toBe("just now");
    expect(describeAge(at, after(60_000))).toBe("1 minute ago");
    expect(describeAge(at, after(45 * 60_000))).toBe("45 minutes ago");
    expect(describeAge(at, after(2 * 3_600_000))).toBe("2 hours ago");
    expect(describeAge(at, after(50 * 3_600_000))).toBe("2 days ago");
  });

  it("does not round a fresh list up into looking stale", () => {
    // 47 hours is one day and change, not two.
    expect(describeAge(at, after(47 * 3_600_000))).toBe("1 day ago");
  });

  it("says so rather than inventing an age it cannot compute", () => {
    expect(describeAge("nonsense", after(0))).toBe("at an unknown time");
  });
});

describe("isStale", () => {
  const at = "2026-08-13T12:00:00.000Z";
  const after = (days: number) => new Date(Date.parse(at) + days * 86_400_000);

  it("is fresh within a week and stale beyond it", () => {
    expect(isStale(at, after(6))).toBe(false);
    expect(isStale(at, after(8))).toBe(true);
  });

  it("treats an uncomputable age as stale, not as fresh", () => {
    // Failing toward "check it again" is the safe direction when the basis is a decision
    // about someone's data.
    expect(isStale("nonsense", after(0))).toBe(true);
  });
});
