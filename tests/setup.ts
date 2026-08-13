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

// jsdom's Blob has `arrayBuffer`, `text` and `slice` but NO `stream()` — measured, not
// assumed (probe run 2026-08-13). Every browser that can run BetterOSF has it, and both
// the export and transfer paths depend on it: client-zip streams the archive rather than
// buffering it, which is what makes a multi-gigabyte export possible at all.
//
// Without this, those paths cannot be tested here, and "untestable" quietly becomes
// "untested" — the local export's packaging step has never had an end-to-end test for
// exactly this reason.
if (typeof Blob !== "undefined" && typeof Blob.prototype.stream !== "function") {
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    writable: true,
    value(this: Blob): ReadableStream<Uint8Array> {
      const bytes = this.arrayBuffer();
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(await bytes));
          controller.close();
        },
      });
    },
  });
}

// Under vitest's jsdom environment, `TextEncoder` comes from Node's realm while
// `Uint8Array` is jsdom's, so `new TextEncoder().encode("x") instanceof Uint8Array` is
// FALSE (measured 2026-08-13). Nothing in a browser behaves that way — there is one realm
// — but here it makes any `instanceof Uint8Array` check silently take the wrong branch.
// client-zip does exactly that check and fell through to treating the bytes as a stream.
//
// Re-wrapping in the jsdom realm's Uint8Array costs one copy per encode in tests and makes
// the environment match the browsers this code actually runs in.
if (typeof TextEncoder !== "undefined" && !(new TextEncoder().encode("x") instanceof Uint8Array)) {
  const ForeignTextEncoder = globalThis.TextEncoder;
  class SameRealmTextEncoder extends ForeignTextEncoder {
    encode(input?: string): Uint8Array<ArrayBuffer> {
      return new Uint8Array(super.encode(input)) as Uint8Array<ArrayBuffer>;
    }
  }
  globalThis.TextEncoder = SameRealmTextEncoder as unknown as typeof TextEncoder;
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
