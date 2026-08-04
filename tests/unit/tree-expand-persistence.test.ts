/**
 * Backlog item (todo.md "Future polish"): "Registration sub-trees default to
 * collapsed; could remember per-registration expand state in localStorage so
 * users who routinely browse the same registration don't have to re-expand."
 *
 * On audit (2026-08-04) this was ALREADY implemented: `UnifiedTree` persists the
 * entire expand map — including `registration/<guid>` keys — under
 * `tree.expand.<guid>`, and restores it in preference to the computed defaults.
 * The backlog entry predated that work.
 *
 * These tests pin the round-trip so the persistence cannot be quietly dropped,
 * and document the two properties that actually matter:
 *  - stored state WINS over the defaults (otherwise persistence is decorative);
 *  - registrations still default to collapsed on first visit (they are expensive
 *    to hydrate, and auto-expanding them would spend OSF calls unasked).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getPref, setPref, removePref } from "@/lib/prefs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../../src/components/UnifiedTree.tsx"),
  "utf8",
);

const GUID = "3kmr9";
const KEY = `tree.expand.${GUID}`;

beforeEach(() => removePref(KEY));

describe("tree expand state is persisted per project", () => {
  it("round-trips an expand map through prefs", () => {
    const state = {
      "providers-root": true,
      "registrations-root": true,
      "registration/ujyh9": true,
      "registration/ujyh9/provider:osfstorage": true,
    };
    setPref(KEY, state);
    expect(getPref<Record<string, boolean> | null>(KEY, null)).toEqual(state);
  });

  it("keeps state separate per project guid", () => {
    setPref(`tree.expand.${GUID}`, { "registration/a": true });
    setPref("tree.expand.8cd4r", { "registration/b": true });
    expect(getPref<Record<string, boolean>>(`tree.expand.${GUID}`, {})).toEqual({ "registration/a": true });
    expect(getPref<Record<string, boolean>>("tree.expand.8cd4r", {})).toEqual({ "registration/b": true });
    removePref("tree.expand.8cd4r");
  });

  it("returns null when nothing is stored, so defaults apply on first visit", () => {
    expect(getPref<Record<string, boolean> | null>(KEY, null)).toBeNull();
  });
});

describe("UnifiedTree wiring", () => {
  it("prefers stored expand state over the computed defaults", () => {
    // The early return is what makes persistence meaningful — without it the
    // defaults would overwrite the user's choices on every mount.
    expect(source).toMatch(/const stored = getPref[\s\S]{0,120}?if \(stored\) return stored;/);
  });

  it("writes the expand map back on every toggle", () => {
    expect(source).toMatch(/setPref\(`tree\.expand\.\$\{guid\}`, next\)/);
  });

  it("expands registration sub-trees by key, so their state is persisted too", () => {
    expect(source).toContain("`registration/${r.guid}`");
  });

  it("still defaults registrations to collapsed on a first visit", () => {
    // Auto-expanding them would spend OSF calls the user never asked for.
    expect(source).toMatch(/"registrations-root":\s*false/);
  });
});
