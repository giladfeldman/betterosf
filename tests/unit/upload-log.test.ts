import { describe, it, expect, beforeEach } from "vitest";
import { appendActivity, patchActivity, listActivity, clearActivity, _resetForTests } from "@/lib/upload/log";
import type { ActivityEntry } from "@/lib/upload/types";

function entry(id: string, ts: number): ActivityEntry {
  return { id, ts, guid: "ezcuj", destinationLabel: "Proj / Data", summary: "1 file", status: "in_progress", confirmed: 0, skipped: 0, failed: 0, outcomes: [] };
}

beforeEach(() => _resetForTests());

describe("upload activity log", () => {
  it("append + list is most-recent-first", () => {
    appendActivity(entry("a", 1));
    appendActivity(entry("b", 2));
    expect(listActivity().map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("patchActivity updates an entry in place", () => {
    appendActivity(entry("a", 1));
    patchActivity("a", { status: "success", confirmed: 1 });
    expect(listActivity()[0]!).toMatchObject({ status: "success", confirmed: 1 });
  });

  it("caps at 200 entries, dropping oldest", () => {
    for (let i = 0; i < 205; i++) appendActivity(entry(String(i), i));
    const list = listActivity();
    expect(list).toHaveLength(200);
    expect(list[0]!.id).toBe("204");
    expect(list.some((e) => e.id === "0")).toBe(false);
  });

  it("clearActivity empties the log", () => {
    appendActivity(entry("a", 1));
    clearActivity();
    expect(listActivity()).toEqual([]);
  });
});
