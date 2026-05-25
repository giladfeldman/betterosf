const NS = "betterosf:";

function isClient(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getPref<T>(key: string, fallback: T): T {
  if (!isClient()) return fallback;
  try {
    const raw = window.localStorage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  if (!isClient()) return;
  try {
    window.localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or otherwise — silently ignore
  }
}

export function removePref(key: string): void {
  if (!isClient()) return;
  try {
    window.localStorage.removeItem(NS + key);
  } catch {
    // ignore
  }
}
