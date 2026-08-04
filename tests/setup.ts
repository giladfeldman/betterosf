import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";
import { _resetOsfClientForTests } from "@/lib/osf/client";

// Some Node/jsdom combinations expose localStorage as present-but-unavailable.
// Detect both "undefined" and access-throws, then install an in-memory polyfill.
let localStorageAvailable = false;
try {
  localStorageAvailable = typeof globalThis.localStorage !== "undefined";
  if (localStorageAvailable) {
    const probe = "__betterosf_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
  }
} catch {
  localStorageAvailable = false;
}

if (!localStorageAvailable) {
  const makeStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    } as Storage;
  };
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: sessionStorage, configurable: true });
  }
}

// Set env vars BEFORE any test imports env.ts (which caches the parsed env on first call).
// Setting them in a per-test beforeEach is too late — the first test wins forever.
process.env.OSF_APP_TOKEN = "test-token";
process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:4747";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  _resetOsfClientForTests();
  cleanup();
});
afterAll(() => server.close());
