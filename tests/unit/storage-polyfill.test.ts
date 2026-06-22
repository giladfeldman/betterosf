import { describe, it, expect } from "vitest";

// Regression guard: jsdom 29 does NOT enable the Web Storage API, so without the
// polyfill installed in tests/setup.ts, `window.localStorage` / `globalThis.localStorage`
// are undefined and every prefs/favorites/upload-log test silently fails. This test
// locks in that the test environment exposes a working, round-tripping localStorage.
describe("test-env localStorage polyfill", () => {
  it("exposes a usable localStorage on window and globalThis", () => {
    expect(typeof globalThis.localStorage).not.toBe("undefined");
    expect(typeof window.localStorage).not.toBe("undefined");
  });

  it("round-trips and clears values", () => {
    window.localStorage.setItem("polyfill:probe", "ok");
    expect(window.localStorage.getItem("polyfill:probe")).toBe("ok");
    window.localStorage.removeItem("polyfill:probe");
    expect(window.localStorage.getItem("polyfill:probe")).toBeNull();
    window.localStorage.setItem("polyfill:probe2", "x");
    window.localStorage.clear();
    expect(window.localStorage.getItem("polyfill:probe2")).toBeNull();
  });
});
