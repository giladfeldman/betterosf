import { safeGet, safeRemove, safeSetJSON } from "@/lib/browser/safe-storage";

const NS = "betterosf:";

export function getPref<T>(key: string, fallback: T): T {
  // An absent, unreadable or corrupt key falls back; a stored JSON `null` is returned as
  // null (unchanged behaviour from before the safe-storage migration).
  const raw = safeGet(NS + key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  // Quota exceeded or storage blocked: a preference is a convenience, so the failure is
  // silent (safe-storage reports it as `false`).
  safeSetJSON(NS + key, value);
}

export function removePref(key: string): void {
  safeRemove(NS + key);
}
