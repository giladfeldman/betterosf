import { describe, it, expect, beforeEach } from "vitest";
import { addPin, removePin, listPins, recordView, listRecent, _resetForTests } from "@/lib/favorites";

beforeEach(() => {
  _resetForTests();
});

describe("favorites", () => {
  // These use toMatchObject rather than toEqual because pins also carry a
  // `pinnedAt` timestamp (added 2026-08-04 for the homepage workspace stats);
  // asserting the exact object shape would make every new field a false failure.
  it("addPin + listPins round-trip", () => {
    addPin({ id: "abc12", title: "My Project", kind: "project" });
    expect(listPins()).toHaveLength(1);
    expect(listPins()[0]).toMatchObject({ id: "abc12", title: "My Project", kind: "project" });
  });

  it("addPin is idempotent on id", () => {
    addPin({ id: "abc12", title: "My Project", kind: "project" });
    addPin({ id: "abc12", title: "Renamed", kind: "project" }); // updates title
    expect(listPins()).toHaveLength(1);
    expect(listPins()[0]).toMatchObject({ id: "abc12", title: "Renamed", kind: "project" });
  });

  it("removePin removes by id", () => {
    addPin({ id: "a", title: "A", kind: "project" });
    addPin({ id: "b", title: "B", kind: "project" });
    removePin("a");
    expect(listPins().map((p) => p.id)).toEqual(["b"]);
  });

  it("recordView prepends and dedupes", () => {
    recordView({ id: "a", title: "A", kind: "project" });
    recordView({ id: "b", title: "B", kind: "project" });
    recordView({ id: "a", title: "A", kind: "project" }); // re-view bumps to front
    expect(listRecent().map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("recordView caps at 25", () => {
    for (let i = 0; i < 30; i++) recordView({ id: String(i), title: `T${i}`, kind: "project" });
    expect(listRecent()).toHaveLength(25);
    expect(listRecent()[0]?.id).toBe("29");
  });
});
