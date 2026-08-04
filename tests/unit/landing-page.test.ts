/**
 * User directive 2026-08-04: "in the anonymous no-login homepage, remove the two
 * examples, they're very heavy and they're taking a lot of resources. no need
 * for heavy demos." Plus: make the landing page informative, like escimate.app /
 * scimeto.app / docpluck.app.
 *
 * These tests pin BOTH halves so a future edit can't quietly undo either:
 *  - no link to a heavy demo project, anywhere in the anonymous entry path;
 *  - the page actually explains the product (it is a landing page, not a form).
 *
 * Source-level assertions are used deliberately: the page is a server component
 * whose value is its CONTENT, and rendering it in jsdom would test React, not
 * the copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const landing = read("src/app/page.tsx");
const workspace = read("src/components/PinnedRecentPanels.tsx");

/** The two projects that were removed, plus the third that predated them. */
const HEAVY_DEMO_GUIDS = ["8cd4r", "ezcuj", "3kmr9"];

describe("the anonymous landing page links no heavy demo projects", () => {
  for (const guid of HEAVY_DEMO_GUIDS) {
    it(`does not link /${guid}`, () => {
      expect(landing).not.toContain(`/${guid}`);
    });
  }

  it("has no 'Examples' section left over", () => {
    expect(landing).not.toMatch(/>\s*Examples\s*</);
    expect(landing).not.toMatch(/Try an example/i);
  });

  it("the workspace empty-state does not reintroduce them", () => {
    // Strip comments first: the file explains WHY the examples were removed, and
    // that rationale is worth keeping. Only real code may not reference them.
    const code = workspace
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const guid of HEAVY_DEMO_GUIDS) {
      expect(code).not.toContain(`/${guid}`);
    }
    expect(code).not.toContain("Many Labs");
    expect(code).not.toContain("Reproducibility Project");
  });
});

describe("the landing page explains what BetterOSF is", () => {
  it("keeps the GUID entry form as the primary action", () => {
    expect(landing).toContain("GuidEntryForm");
  });

  it("has the informative sections a first-time visitor needs", () => {
    // Not cosmetic: without these the page is just a search box with no
    // explanation of what the product does, which is what the user asked to fix.
    expect(landing).toMatch(/What it does/);
    expect(landing).toMatch(/How it works/);
    expect(landing).toMatch(/Where your data goes/);
  });

  it("sets a descriptive page title and meta description for search/social", () => {
    expect(landing).toMatch(/export const metadata/);
    expect(landing).toMatch(/description:/);
  });

  it("surfaces the running version and a route to report bugs", () => {
    expect(landing).toContain("APP_VERSION_LABEL");
    expect(landing).toContain("/feedback");
  });

  it("does not promise features that were never built", () => {
    // Guards against marketing drift: these are things BetterOSF does NOT do.
    const forbidden = [
      /full-text search inside files/i,
      /edit .{0,20}on OSF/i,
      /unlimited/i,
      /AI[- ]powered/i,
    ];
    for (const re of forbidden) {
      expect(landing).not.toMatch(re);
    }
  });
});
