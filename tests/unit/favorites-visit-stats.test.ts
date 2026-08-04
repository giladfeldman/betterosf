/**
 * User request 2026-08-04: the homepage workspace should show "some stats on
 * when accessed or other useful information".
 *
 * `FavoriteRef` previously stored only {id,title,kind} — there was no timestamp
 * and no visit count, so the UI could only ever render an unordered list of
 * names. These tests pin the visit metadata that makes the redesign possible,
 * INCLUDING backward compatibility: entries written by an older build have no
 * `lastViewed`/`visits` and must not crash or vanish.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { recordView, listRecent, addPin, listPins, _resetForTests } from "@/lib/favorites";
import { setPref } from "@/lib/prefs";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recent-view visit statistics", () => {
  it("stamps lastViewed and starts the visit count at 1", () => {
    vi.setSystemTime(new Date("2026-08-04T10:00:00Z"));
    recordView({ id: "a", title: "A", kind: "project" });
    const [entry] = listRecent();
    expect(entry?.lastViewed).toBe(Date.parse("2026-08-04T10:00:00Z"));
    expect(entry?.visits).toBe(1);
  });

  it("increments the visit count and refreshes lastViewed on re-view", () => {
    vi.setSystemTime(new Date("2026-08-04T10:00:00Z"));
    recordView({ id: "a", title: "A", kind: "project" });
    vi.setSystemTime(new Date("2026-08-04T12:30:00Z"));
    recordView({ id: "a", title: "A", kind: "project" });

    const [entry] = listRecent();
    expect(entry?.visits).toBe(2);
    expect(entry?.lastViewed).toBe(Date.parse("2026-08-04T12:30:00Z"));
    // Still deduped to a single row.
    expect(listRecent()).toHaveLength(1);
  });

  it("keeps counting visits across other projects being viewed in between", () => {
    recordView({ id: "a", title: "A", kind: "project" });
    recordView({ id: "b", title: "B", kind: "project" });
    recordView({ id: "a", title: "A", kind: "project" });
    const a = listRecent().find((r) => r.id === "a");
    expect(a?.visits).toBe(2);
    // Most-recent-first ordering is preserved.
    expect(listRecent().map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("tolerates legacy entries with no visit metadata (no crash, no data loss)", () => {
    // Simulate data written by a build that predates this feature.
    setPref("favorites.recents", [{ id: "old", title: "Old", kind: "project" }]);
    const entries = listRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("old");
    // Missing metadata reads as "unknown", never NaN or a bogus 1970 date.
    expect(entries[0]?.lastViewed).toBeUndefined();
    expect(entries[0]?.visits).toBeUndefined();
  });

  it("upgrades a legacy entry in place when it is viewed again", () => {
    setPref("favorites.recents", [{ id: "old", title: "Old", kind: "project" }]);
    vi.setSystemTime(new Date("2026-08-04T09:00:00Z"));
    recordView({ id: "old", title: "Old", kind: "project" });
    const [entry] = listRecent();
    expect(entry?.visits).toBe(2); // the unrecorded prior visit + this one
    expect(entry?.lastViewed).toBe(Date.parse("2026-08-04T09:00:00Z"));
  });

  it("still caps the recent list at 25 entries", () => {
    for (let i = 0; i < 30; i++) recordView({ id: String(i), title: `T${i}`, kind: "project" });
    expect(listRecent()).toHaveLength(25);
    expect(listRecent()[0]?.id).toBe("29");
  });

  it("records when a pin was added so pins can be sorted meaningfully", () => {
    vi.setSystemTime(new Date("2026-08-04T08:00:00Z"));
    addPin({ id: "p", title: "P", kind: "project" });
    expect(listPins()[0]?.pinnedAt).toBe(Date.parse("2026-08-04T08:00:00Z"));
  });

  it("preserves the original pinnedAt when a pin's title is refreshed", () => {
    vi.setSystemTime(new Date("2026-08-04T08:00:00Z"));
    addPin({ id: "p", title: "P", kind: "project" });
    vi.setSystemTime(new Date("2026-08-05T08:00:00Z"));
    addPin({ id: "p", title: "P renamed", kind: "project" });
    const [pin] = listPins();
    expect(pin?.title).toBe("P renamed");
    expect(pin?.pinnedAt).toBe(Date.parse("2026-08-04T08:00:00Z"));
  });
});
