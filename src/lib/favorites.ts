import { getPref, setPref } from "./prefs";

export type FavoriteKind = "project" | "component" | "file" | "registration";

export type FavoriteRef = {
  id: string;
  title: string;
  kind: FavoriteKind;
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
  if (existing >= 0) pins[existing] = ref;
  else pins.push(ref);
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
  const existing = listRecent().filter((r) => r.id !== ref.id);
  existing.unshift(ref);
  if (existing.length > RECENT_LIMIT) existing.length = RECENT_LIMIT;
  setPref(RECENTS_KEY, existing);
}

export function _resetForTests(): void {
  setPref(PINS_KEY, []);
  setPref(RECENTS_KEY, []);
}
