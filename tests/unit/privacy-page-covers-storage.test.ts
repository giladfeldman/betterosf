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
const logger = readFileSync(resolve(root, "src/lib/logger.ts"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as { regions?: string[] };

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

// d-802b8c: two gaps found by the ethics verification of tools-and-secondary-data.
describe("the privacy page covers feedback reports and states the real log retention", () => {
  it("discloses the bug-report / feedback table and what it holds", () => {
    expect(schema).toContain('"bug_reports"');
    expect(privacy).toMatch(/bug report|feedback/i);
    // Fields src/app/api/feedback/route.ts actually stores.
    expect(privacy).toMatch(/contact email/i);
    expect(privacy).toMatch(/page you were on/i);
    expect(privacy).toMatch(/user-agent/i);
    // No code deletes bug_reports rows: the page must not imply a retention window for them.
    expect(privacy).toMatch(/kept until an administrator deletes/i);
  });

  it("states the log retention the code enforces, not a vague 'short window'", () => {
    const days = Number(/const RETENTION_DAYS = (\d+);/.exec(logger)?.[1]);
    expect(days).toBeGreaterThan(0);
    expect(privacy).toContain(`${days} days`);
    expect(privacy).not.toMatch(/retained for a short window/i);
  });
});

describe("Vercel functions are pinned to an EU region (owner directive: everything in the EU)", () => {
  // Hobby allows exactly one function region (Vercel docs, "Configuring regions for Vercel
  // Functions", Limits table). fra1 = Frankfurt, beside the Neon database (aws-eu-central-1).
  it("vercel.json pins one EU region", () => {
    expect(vercel.regions).toEqual(["fra1"]);
  });
  it("the privacy page names where functions run", () => {
    expect(privacy).toMatch(/Frankfurt.{0,80}fra1|fra1.{0,80}Frankfurt/is);
  });
});

// d-cc3f4e: Vercel runs Routing Middleware in all regions regardless of the fra1 pin, and
// the middleware reads the visitor's IP. The page must say where that counter lives (the
// memory of the instance that served the request; no shared store) and that the check can
// run outside Frankfurt — and the code must still match: no KV/Redis store wired in.
describe("the privacy page states where per-IP rate-limit counters live", () => {
  const limits = readFileSync(resolve(root, "src/lib/limits.ts"), "utf8");
  const middleware = readFileSync(resolve(root, "src/middleware.ts"), "utf8");

  it("says the counters are kept only in server memory and never written to a database or shared store", () => {
    expect(privacy).toMatch(/only in the memory of the server instance/i);
    expect(privacy).toMatch(/not written to our database/i);
  });

  it("says the rate-limit check can run in a Vercel region outside Frankfurt", () => {
    expect(privacy).toMatch(/Routing Middleware/);
    expect(privacy).toMatch(/nearest to you/i);
  });

  it("code still matches: middleware sends nothing out, and the only non-memory store is KV, gated on env", () => {
    expect(middleware).not.toMatch(/\bfetch\(|console\.|@vercel\/kv|neon|sql`/);
    expect(limits).toMatch(/if \(!process\.env\.KV_REST_API_URL \|\| !process\.env\.KV_REST_API_TOKEN\) return null/);
  });
});
