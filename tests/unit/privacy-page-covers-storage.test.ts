/**
 * The privacy page has to describe what BetterOSF actually stores.
 *
 * Project lesson, v1.8.0: "a new DB table means a privacy-page edit". v1.9.0 added two —
 * `transition_jobs` and `transition_items` — plus a credential cookie for a third-party
 * repository. A page that omits them is not a docs nit; it is a false statement about
 * retention on a page whose whole job is to be accurate.
 *
 * Source-level assertions, like the landing-page tests: the value here is the COPY, and
 * rendering a server component in jsdom would test React instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const privacy = readFileSync(resolve(root, "src/app/privacy/page.tsx"), "utf8");
const schema = readFileSync(resolve(root, "src/lib/db/schema.ts"), "utf8");

describe("the privacy page describes every table that holds user data", () => {
  it("mentions the transfer-run checkpoints", () => {
    expect(schema).toContain('"transition_jobs"');
    expect(schema).toContain('"transition_items"');
    expect(privacy).toMatch(/record of each transfer run/i);
  });

  it("says file PATHS and checksums are stored, and contents are not", () => {
    // The distinction is the whole point: a path can be as revealing as a directory
    // listing, and claiming "nothing about the contents" without saying what IS kept
    // would be true-but-misleading.
    expect(privacy).toMatch(/path/i);
    expect(privacy).toMatch(/checksums/i);
    expect(privacy).toMatch(/never its.{0,30}contents/is);
  });

  it("says where the Zenodo credential lives, and that it is not in the database", () => {
    expect(privacy).toMatch(/encrypted cookie/i);
    expect(privacy).toMatch(/never written to our database/i);
  });

  it("still states that export contents never pass through our servers", () => {
    expect(privacy).toMatch(/do not pass\s*\n?\s*through BetterOSF/i);
  });

  it("still covers the consent records", () => {
    expect(schema).toContain('"transition_consents"');
    expect(privacy).toMatch(/agreement to the transition terms/i);
  });
});
