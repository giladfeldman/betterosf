import { getPref, setPref } from "./prefs";

export type FavoriteKind = "project" | "component" | "file" | "folder" | "registration" | "preprint" | "user";

export type FavoriteRef = {
  id: string;
  title: string;
  kind: FavoriteKind;
  /**
   * Epoch ms of the most recent view. Optional because entries written before
   * this field existed have no timestamp — the UI must render those as
   * "unknown" rather than inventing a date.
   */
  lastViewed?: number;
  /** Total recorded views. Optional for the same backward-compatibility reason. */
  visits?: number;
  /** Epoch ms when the item was pinned. Optional on legacy pins. */
  pinnedAt?: number;
};

const PINS_KEY = "favorites.pins";
const RECENTS_KEY = "favorites.recents";
const RECENT_LIMIT = 25;

export function listPins(): FavoriteRef[] {
  return getPref<FavoriteRef[]>(PINS_KEY, []);
}

export function addPin(ref: FavoriteRef): void {
  const pins = listPins();
  const existing = pins.findIndex((p) => p.id === ref.id);
  if (existing >= 0) {
    // Refresh the metadata but keep the ORIGINAL pin time: re-pinning or a title
    // refresh shouldn't make an old pin look brand new.
    pins[existing] = { ...ref, pinnedAt: pins[existing]?.pinnedAt ?? Date.now() };
  } else {
    pins.push({ ...ref, pinnedAt: ref.pinnedAt ?? Date.now() });
  }
  setPref(PINS_KEY, pins);
}

export function removePin(id: string): void {
  setPref(PINS_KEY, listPins().filter((p) => p.id !== id));
}

export function isPinned(id: string): boolean {
  return listPins().some((p) => p.id === id);
}

export function listRecent(): FavoriteRef[] {
  return getPref<FavoriteRef[]>(RECENTS_KEY, []);
}

export function recordView(ref: FavoriteRef): void {
  const all = listRecent();
  const prior = all.find((r) => r.id === ref.id);
  // A legacy entry has no `visits` but DID represent at least one earlier view,
  // so it counts as 1 before this one — otherwise re-viewing an old entry would
  // reset its history to a single visit.
  const priorVisits = prior ? (prior.visits ?? 1) : 0;
  const rest = all.filter((r) => r.id !== ref.id);
  rest.unshift({
    ...ref,
    lastViewed: Date.now(),
    visits: priorVisits + 1,
  });
  if (rest.length > RECENT_LIMIT) rest.length = RECENT_LIMIT;
  setPref(RECENTS_KEY, rest);
}

export function _resetForTests(): void {
  setPref(PINS_KEY, []);
  setPref(RECENTS_KEY, []);
}
