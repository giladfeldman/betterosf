/**
 * Backlog item (todo.md, 2026-06-22 prevention): "Defer the overview's 4
 * citation OSF calls (getCitation + 3× getStyledCitation in
 * src/app/[guid]/page.tsx) to client/on-demand — cuts ~40% of OSF calls per
 * overview render, lowering 429 likelihood. The data is non-critical and
 * already .catch'd."
 *
 * Done 2026-08-04. The overview no longer fetches citations at render time;
 * `CitationExport` loads them from `/api/osf/citation/<guid>` only when a user
 * asks for them.
 *
 * These are source-level assertions on purpose: the thing being protected is
 * "this module does not call OSF", which is a property of the import/call graph,
 * not of any single rendered output. A future edit that innocently re-adds
 * `await getStyledCitation(...)` to the overview would silently restore ~40% of
 * the page's OSF cost without changing anything a rendering test could see.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const overview = read("src/app/[guid]/page.tsx");
const exporter = read("src/components/CitationExport.tsx");

describe("project overview does not spend OSF calls on citations", () => {
  it("makes no citation calls during render", () => {
    expect(overview).not.toMatch(/await\s+getCitation\s*\(/);
    expect(overview).not.toMatch(/getStyledCitation\s*\(/);
  });

  it("does not even import the citation helpers", () => {
    // Importing them is the first step back to calling them.
    expect(overview).not.toMatch(/from\s+"@\/lib\/osf\/citation"/);
  });

  it("passes only the guid to CitationExport, not pre-fetched strings", () => {
    expect(overview).toMatch(/<CitationExport\s+guid=\{guid\}\s*\/>/);
    expect(overview).not.toMatch(/<CitationExport[^>]*apa=/);
  });
});

describe("CitationExport loads on demand", () => {
  it("fetches from the dedicated endpoint rather than receiving props", () => {
    expect(exporter).toContain("/api/osf/citation/");
  });

  it("does not fetch until the user asks", () => {
    // No useEffect auto-load: the request must be tied to a click, otherwise
    // the calls simply move from the server to every page load.
    expect(exporter).not.toMatch(/useEffect\s*\(/);
    expect(exporter).toMatch(/onClick=\{load\}/);
  });

  it("surfaces a retry when the fetch fails instead of rendering nothing", () => {
    expect(exporter).toMatch(/Retry/);
  });
});
