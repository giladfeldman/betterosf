import { describe, it, expect, beforeEach } from "vitest";
import { getPref, setPref, removePref } from "@/lib/prefs";

beforeEach(() => {
  // jsdom localStorage is per-test-file; clear before each
  globalThis.localStorage?.clear();
});

describe("prefs", () => {
  it("returns default when key missing", () => {
    expect(getPref("foo.bar", "default")).toBe("default");
  });

  it("round-trips strings", () => {
    setPref("foo", "hello");
    expect(getPref("foo", "")).toBe("hello");
  });

  it("round-trips numbers", () => {
    setPref("size", 320);
    expect(getPref("size", 0)).toBe(320);
  });

  it("round-trips objects", () => {
    setPref("user", { id: "u1", name: "Ada" });
    expect(getPref<{ id: string; name: string }>("user", { id: "", name: "" })).toEqual({ id: "u1", name: "Ada" });
  });

  it("removePref clears the value", () => {
    setPref("temp", 42);
    removePref("temp");
    expect(getPref("temp", -1)).toBe(-1);
  });

  it("returns default when stored value is malformed JSON", () => {
    globalThis.localStorage.setItem("betterosf:bad", "{not json");
    expect(getPref("bad", "fallback")).toBe("fallback");
  });

  it("is a no-op on server (localStorage undefined)", () => {
    const orig = globalThis.localStorage;
    // @ts-expect-error simulate SSR
    delete globalThis.localStorage;
    expect(getPref("foo", "default")).toBe("default");
    setPref("foo", "value"); // should not throw
    // restore
    globalThis.localStorage = orig;
  });
});
