/**
 * The inventory has to lead somewhere.
 *
 * THE DEFECT, reported by the user 2026-08-13 ("now what do I do? where is the actual
 * transitioning?"): the inventory listed 443 projects with a recommendation each, and
 * **nothing in the entire app linked to `/transition/[guid]`** — the export and Zenodo
 * transfer, the whole point of v1.8.0 and v1.9.0. The only way to reach the feature was to
 * type the URL. It was deployed, tested, and unreachable.
 *
 * That is the UI form of a rule this project already had: a module imported only by its own
 * test is not shipped. A page nothing links to is not shipped either. Source-level
 * assertions, deliberately — the value here is that the link EXISTS, and a render test
 * would pass just as well against a component nobody mounts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "../..");
const inventory = readFileSync(resolve(root, "src/components/transition/InventoryTable.tsx"), "utf8");

describe("the inventory links to the per-project transition page", () => {
  it("gives every row a link to /transition/<guid>", () => {
    expect(inventory).toMatch(/href=\{`\/transition\/\$\{project\.guid\}`\}/);
  });

  it("labels the link as the action, not as generic navigation", () => {
    // A button reading "Open" beside "Back it up" makes the reader do the join.
    expect(inventory).toContain("Back it up →");
    expect(inventory).toContain("Move it →");
  });

  it("offers the link even for 'leave it', because that is a recommendation not a lock", () => {
    expect(inventory).toContain("Take a copy anyway →");
  });

  it("tells the user what to do with the list at all", () => {
    expect(inventory).toContain("What to do now");
  });
});

describe("the transition feature is reachable from somewhere", () => {
  it("at least one shipped component links to /transition/<something>", () => {
    // The guard against this whole class: if every link to the feature is deleted again,
    // this fails. Scanning components rather than one file, so moving the link is fine and
    // removing it is not.
    const dir = resolve(root, "src/components/transition");
    const linked = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .some((f) => /href=\{?`?\/transition\//.test(readFileSync(join(dir, f), "utf8")));
    expect(linked).toBe(true);
  });

  it("the per-project page still exists to be linked to", () => {
    expect(() =>
      readFileSync(resolve(root, "src/app/transition/[guid]/page.tsx"), "utf8"),
    ).not.toThrow();
  });
});

describe("prior runs are shown honestly", () => {
  it("distinguishes a complete run from an incomplete one", () => {
    // "Exported" on a run that reconciled as incomplete would be the exact false-green
    // this toolkit exists to prevent, in a badge.
    expect(inventory).toContain("incomplete");
    expect(inventory).toMatch(/run\.status === "complete"/);
  });

  it("keeps the newest run per project rather than an arbitrary one", () => {
    expect(inventory).toMatch(/updatedAt > prev\.updatedAt/);
  });

  it("does not present a missing history as 'nothing done'", () => {
    expect(inventory).toMatch(/no history is not an error/i);
  });
});
