/**
 * Version badge (requested 2026-08-04, matching docpluck.app / escimate.app /
 * scimeto.app). The user explicitly corrected the position mid-implementation:
 * "instead of version badge on top right I meant bottom right, just like in
 * docpluck/escimate/scimeto".
 *
 * These tests pin the position and the single-source-of-truth version, so the
 * badge can never drift from what actually shipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/version";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const badge = read("src/components/VersionBadge.tsx");
const layout = read("src/app/layout.tsx");

describe("version is a single source of truth", () => {
  it("APP_VERSION matches package.json exactly", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("the label is the version prefixed with v", () => {
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
    expect(APP_VERSION_LABEL).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

describe("badge placement", () => {
  it("is pinned bottom-right, not top-right", () => {
    expect(badge).toContain("bottom-3");
    expect(badge).toContain("right-3");
    // The first implementation used top-16; the user corrected it.
    expect(badge).not.toContain("top-16");
    expect(badge).not.toMatch(/\btop-\d/);
  });

  it("is fixed-position so it floats over page content", () => {
    expect(badge).toContain("fixed");
  });

  it("renders on every page via the root layout", () => {
    expect(layout).toContain("VersionBadge");
  });

  it("links to the bug-report page so it doubles as the feedback entry point", () => {
    expect(badge).toContain('href="/feedback"');
  });
});
