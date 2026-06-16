import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPref, setPref, removePref } from "@/lib/prefs";

beforeEach(() => {
  globalThis.localStorage?.clear();
  vi.restoreAllMocks();
});

describe("prefs — arrays + nested objects", () => {
  it("round-trips arrays of strings", () => {
    setPref("tags", ["a", "b", "c"]);
    expect(getPref<string[]>("tags", [])).toEqual(["a", "b", "c"]);
  });

  it("round-trips arrays of objects", () => {
    const value = [{ id: 1, name: "x" }, { id: 2, name: "y" }];
    setPref("rows", value);
    expect(getPref<typeof value>("rows", [])).toEqual(value);
  });

  it("round-trips deeply nested objects", () => {
    const value = {
      level1: { level2: { level3: { leaf: "hi", nums: [1, 2, 3] } } },
      list: [{ a: { b: 1 } }, { a: { b: 2 } }],
    };
    setPref("deep", value);
    expect(getPref<typeof value>("deep", { level1: { level2: { level3: { leaf: "", nums: [] } } }, list: [] })).toEqual(value);
  });

  it("round-trips booleans + null", () => {
    setPref("flag", true);
    expect(getPref("flag", false)).toBe(true);
    setPref("nothing", null);
    expect(getPref<null | string>("nothing", "fallback")).toBe(null);
  });
});

describe("prefs — quota / write failures", () => {
  it("swallows setItem quota errors silently", () => {
    const orig = window.localStorage.setItem;
    let called = false;
    window.localStorage.setItem = function () {
      called = true;
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    try {
      expect(() => setPref("big", "x".repeat(10))).not.toThrow();
      expect(called).toBe(true);
      // And nothing was stored, since the write threw
      expect(window.localStorage.getItem("betterosf:big")).toBeNull();
    } finally {
      window.localStorage.setItem = orig;
    }
  });

  it("swallows removeItem failures silently", () => {
    const orig = window.localStorage.removeItem;
    window.localStorage.removeItem = function () {
      throw new Error("boom");
    };
    try {
      expect(() => removePref("foo")).not.toThrow();
    } finally {
      window.localStorage.removeItem = orig;
    }
  });

  it("swallows getItem failures and returns fallback", () => {
    const orig = window.localStorage.getItem;
    window.localStorage.getItem = function () {
      throw new Error("boom");
    };
    try {
      expect(getPref("foo", "default")).toBe("default");
    } finally {
      window.localStorage.getItem = orig;
    }
  });
});

describe("prefs — namespacing", () => {
  it("stores under the 'betterosf:' prefix to avoid collisions", () => {
    setPref("ns-test", { id: 42 });
    expect(window.localStorage.getItem("betterosf:ns-test")).toBe(JSON.stringify({ id: 42 }));
    expect(window.localStorage.getItem("ns-test")).toBeNull();
  });
});
