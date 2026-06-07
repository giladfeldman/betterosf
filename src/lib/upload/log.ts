import { getPref, setPref } from "@/lib/prefs";
import type { ActivityEntry } from "./types";

const KEY = "upload.activity";
const CAP = 200;
const EVENT = "betterosf:upload-activity-changed";

export function listActivity(): ActivityEntry[] {
  return getPref<ActivityEntry[]>(KEY, []);
}

function save(entries: ActivityEntry[]): void {
  setPref(KEY, entries.slice(0, CAP));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

/** Insert a new entry at the front (most-recent-first). */
export function appendActivity(entry: ActivityEntry): void {
  save([entry, ...listActivity().filter((e) => e.id !== entry.id)]);
}

export function patchActivity(id: string, patch: Partial<ActivityEntry>): void {
  save(listActivity().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function clearActivity(): void {
  save([]);
}

/** Subscribe to log changes (same-tab via custom event, cross-tab via storage event). */
export function subscribeActivity(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function _resetForTests(): void {
  setPref(KEY, []);
}
