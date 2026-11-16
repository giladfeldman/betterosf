import { describe, it, expect } from "vitest";
import { selectHydrationTasks, mayHaveComponents, componentListsToFetch } from "@/lib/tree/nested-components";

const task = (kind: string, guid: string) => ({ id: `${kind}:${guid}`, kind, guid });

describe("selectHydrationTasks", () => {
  it("loads every top-level section in the background when there are few (unchanged behaviour)", () => {
    const top = [task("component", "a"), task("linked", "b"), task("registration", "c")];
    expect(selectHydrationTasks(top, [], {}, 10)).toEqual(top);
  });

  it("above the cap, loads only the sections the user opened (100-component project)", () => {
    const top = Array.from({ length: 100 }, (_, i) => task("component", `c${i}`));
    const picked = selectHydrationTasks(top, [], { "component/c7": true, "component/c42": true, "component/c9": false }, 10);
    expect(picked.map((t) => t.guid)).toEqual(["c7", "c42"]);
  });

  it("nested components never load in the background, only when opened", () => {
    const nested = [task("component", "n1"), task("component", "n2")];
    expect(selectHydrationTasks([], nested, {}, 10)).toEqual([]);
    expect(selectHydrationTasks([], nested, { "component/n2": true }, 10).map((t) => t.guid)).toEqual(["n2"]);
  });

  it("does not schedule the same section twice", () => {
    const t = task("component", "dup");
    expect(selectHydrationTasks([t], [t], { "component/dup": true }, 10)).toEqual([t]);
  });
});

describe("mayHaveComponents", () => {
  it("only a known 0 rules components out; unknown stays openable", () => {
    expect(mayHaveComponents(0)).toBe(false);
    expect(mayHaveComponents(2)).toBe(true);
    expect(mayHaveComponents(undefined)).toBe(true);
  });
});

describe("componentListsToFetch", () => {
  const nodes = [
    { rowId: "component/a", guid: "a", childCount: 2 },
    { rowId: "component/b", guid: "b", childCount: 0 },
    { rowId: "component/c", guid: "c" },
    { rowId: "linked/d", guid: "d", childCount: 1 },
    { rowId: "component/e", guid: "e", childCount: 4 },
  ];

  it("fetches open rows that may have components and were not requested yet", () => {
    const expanded = { "component/a": true, "component/b": true, "component/c": true, "linked/d": true };
    expect(componentListsToFetch(nodes, expanded, {})).toEqual(["a", "c", "d"]);
  });

  it("never fetches for a closed row (a 100-component project costs nothing until opened)", () => {
    expect(componentListsToFetch(nodes, {}, {})).toEqual([]);
    expect(componentListsToFetch(nodes, { "component/e": false }, {})).toEqual([]);
  });

  it("does not refetch a list already loading, loaded or failed (a failure waits for Retry, no loop)", () => {
    const expanded = { "component/a": true, "component/c": true, "linked/d": true };
    const requested = { a: { status: "loading" }, c: { status: "ok", items: [] }, d: { status: "error", message: "x" } };
    expect(componentListsToFetch(nodes, expanded, requested)).toEqual([]);
  });
});
