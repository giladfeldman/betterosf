/**
 * Backlog item (todo.md "Future polish"): "File-view route for registrations
 * should bypass the `/<guid>/files` breadcrumb link (currently shows nothing
 * useful at that URL for a registration guid)."
 *
 * On audit (2026-08-04) this was ALREADY fixed in the route — the crumb is
 * conditionally omitted for registrations, and the project crumb points at
 * `/registrations/<guid>` rather than `/<guid>`. The backlog entry was stale.
 *
 * Rather than just ticking it off, this pins the behaviour so the fix cannot be
 * silently undone by a future edit to the breadcrumb array. A dead link in a
 * breadcrumb is the kind of thing no test would otherwise catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../../src/app/[guid]/files/view/[...path]/page.tsx"),
  "utf8",
);

describe("registration file-view breadcrumb", () => {
  it("omits the /<guid>/files crumb for registrations", () => {
    // The conditional spread that drops the crumb must still be present.
    expect(source).toMatch(/resourceKind === "registration"\s*\?\s*\[\]/);
  });

  it("points the project crumb at /registrations/<guid> for a registration", () => {
    expect(source).toContain("`/registrations/${guid}`");
  });

  it("still links /<guid>/files for ordinary nodes", () => {
    expect(source).toContain('label: "Files"');
    expect(source).toContain("`/${guid}/files`");
  });
});
