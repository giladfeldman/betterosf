/**
 * The ONE place BetterOSF touches Web Storage (localStorage / sessionStorage).
 *
 * Web Storage throws in ordinary browsers, not only in exotic ones:
 *   - reading `window.localStorage` throws a SecurityError when the user blocks site data
 *     (Chrome/Firefox "block cookies"), and in some sandboxed iframes;
 *   - `setItem` throws QuotaExceededError when the ~5 MB quota is full, and always threw in
 *     old Safari private mode;
 *   - on the server (SSR) the global is simply absent.
 * Every helper here returns `null` / `false` / `[]` instead of throwing, and resolves the
 * storage object at call time (never cached), so a storage that disappears mid-session or
 * a test that swaps it is honoured.
 *
 * Callers that must tell the user a write failed use the boolean that the set helpers
 * return; a `false` is never to be read as "saved".
 *
 * `tests/unit/no-raw-web-storage.test.ts` fails if any other file in src/ touches
 * localStorage/sessionStorage directly. (d-a09501)
 */

export type StorageArea = "local" | "session";

function area(kind: StorageArea): Storage | null {
  try {
    const s = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
    return s ?? null;
  } catch {
    // The getter itself throws when storage is blocked.
    return null;
  }
}

export function safeGet(key: string, kind: StorageArea = "local"): string | null {
  const s = area(kind);
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

/** Returns whether the value was actually stored. */
export function safeSet(key: string, value: string, kind: StorageArea = "local"): boolean {
  const s = area(kind);
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Returns whether the remove call completed. */
export function safeRemove(key: string, kind: StorageArea = "local"): boolean {
  const s = area(kind);
  if (!s) return false;
  try {
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Parsed JSON, or `null` when absent, unreadable or not valid JSON. */
export function safeGetJSON<T = unknown>(key: string, kind: StorageArea = "local"): T | null {
  const raw = safeGet(key, kind);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Returns whether the value was serialised AND stored. */
export function safeSetJSON(key: string, value: unknown, kind: StorageArea = "local"): boolean {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false; // cyclic or otherwise unserialisable
  }
  return safeSet(key, raw, kind);
}

/** Every key currently in the area, or `[]` when storage is unavailable. */
export function safeKeys(kind: StorageArea = "local"): string[] {
  const s = area(kind);
  if (!s) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}
