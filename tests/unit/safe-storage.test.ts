import { describe, it, expect, afterEach, vi } from "vitest";
import {
  safeGet, safeSet, safeRemove, safeGetJSON, safeSetJSON, safeKeys,
} from "@/lib/browser/safe-storage";
import { getPref, setPref, removePref } from "@/lib/prefs";
import { readInventoryCache, writeInventoryCache, clearInventoryCache, dropFromInventoryCache } from "@/lib/transition/inventory-cache";

// d-a09501: Safari private mode, a full quota, storage disabled by policy, and SSR all
// make Web Storage throw. Every access goes through safe-storage, which must never throw.
const throwing = (): never => {
  throw new DOMException("blocked", "SecurityError");
};

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

/** Accessing `window.localStorage` itself throws (Chrome/Firefox with storage blocked). */
function stubThrowingGetter(): () => void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: throwing });
  return () => {
    if (desc) Object.defineProperty(globalThis, "localStorage", desc);
  };
}

/** Storage exists but every operation throws (quota exceeded, old Safari private mode). */
function stubThrowingMethods(): void {
  vi.stubGlobal("localStorage", {
    getItem: throwing,
    setItem: throwing,
    removeItem: throwing,
    key: throwing,
    get length(): number {
      return throwing();
    },
    clear: () => {},
  });
}

describe("safe-storage never throws", () => {
  it("round-trips when storage works", () => {
    expect(safeSet("k", "v")).toBe(true);
    expect(safeGet("k")).toBe("v");
    expect(safeSetJSON("j", { a: 1 })).toBe(true);
    expect(safeGetJSON("j")).toEqual({ a: 1 });
    expect(safeKeys()).toEqual(expect.arrayContaining(["k", "j"]));
    expect(safeRemove("k")).toBe(true);
    expect(safeGet("k")).toBeNull();
  });

  it("returns null/false when the storage getter itself throws", () => {
    const restore = stubThrowingGetter();
    try {
      expect(safeGet("k")).toBeNull();
      expect(safeSet("k", "v")).toBe(false);
      expect(safeRemove("k")).toBe(false);
      expect(safeGetJSON("k")).toBeNull();
      expect(safeSetJSON("k", 1)).toBe(false);
      expect(safeKeys()).toEqual([]);
    } finally {
      restore();
    }
  });

  it("returns null/false when every method throws", () => {
    stubThrowingMethods();
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(safeRemove("k")).toBe(false);
    expect(safeKeys()).toEqual([]);
    expect(dropFromInventoryCache("abc12")).toBe(0);
  });

  it("returns null/false when storage is absent (SSR)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(safeKeys()).toEqual([]);
  });

  it("returns null for unparseable JSON, and false for unserialisable values", () => {
    safeSet("bad", "{not json");
    expect(safeGetJSON("bad")).toBeNull();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(safeSetJSON("cyc", cyclic)).toBe(false);
  });

  it("supports sessionStorage too", () => {
    expect(safeSet("s", "1", "session")).toBe(true);
    expect(safeGet("s", "session")).toBe("1");
    expect(safeRemove("s", "session")).toBe(true);
  });
});

describe("callers do not crash when storage throws", () => {
  it("prefs and the inventory cache degrade to fallbacks", () => {
    const restore = stubThrowingGetter();
    try {
      expect(getPref("x", 7)).toBe(7);
      expect(() => setPref("x", 1)).not.toThrow();
      expect(() => removePref("x")).not.toThrow();
      expect(readInventoryCache("u1")).toBeNull();
      expect(
        writeInventoryCache({
          version: 2,
          osfUserId: "u1",
          fetchedAt: new Date().toISOString(),
          projects: [],
          total: null,
          enriched: {},
          enrichedAt: null,
        } as never),
      ).toBe(false);
      expect(() => clearInventoryCache("u1")).not.toThrow();
      expect(dropFromInventoryCache("abc12")).toBe(0);
    } finally {
      restore();
    }
  });

  it("syncPrefsOnSignIn survives throwing storage", async () => {
    stubThrowingMethods();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ prefs: {} }), { status: 200 })));
    const { syncPrefsOnSignIn } = await import("@/lib/sync/client");
    await expect(syncPrefsOnSignIn()).resolves.toBeUndefined();
  });
});
