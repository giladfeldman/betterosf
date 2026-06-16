const NS = "betterosf:";

function storage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      const s = globalThis.localStorage;
      if (s) return s;
    }
  } catch {
    // localStorage can exist but be unavailable in some runtimes.
  }
  try {
    if (typeof window !== "undefined" && "localStorage" in window) {
      const s = window.localStorage;
      if (s) return s;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getPref<T>(key: string, fallback: T): T {
  const s = storage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or otherwise — silently ignore
  }
}

export function removePref(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(NS + key);
  } catch {
    // ignore
  }
}
