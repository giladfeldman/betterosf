/**
 * Backlog item (todo.md, v1.6.0 follow-ups): "`.claude/skills/betterosf-qa/SKILL.md`
 * is 382 lines (audit-bloat: NEEDS WORK). Candidate for extracting the
 * destructive-gates section into `references/`."
 *
 * Done 2026-08-04. The risk in ANY such extraction is losing safety-critical
 * content while the line count improves — a "successful" cleanup that quietly
 * deletes the rules protecting irreversible deletion.
 *
 * So this test does not check the line count. It checks that every
 * safety-critical fact is still reachable from one of the two files, and that
 * the skill still points at the reference. Trimming that drops a rule fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SKILL = ".claude/skills/betterosf-qa/SKILL.md";
const REF = ".claude/skills/betterosf-qa/references/destructive-gates.md";

const skill = read(SKILL);
const reference = read(REF);
const combined = skill + "\n" + reference;

/** Facts that must survive any future trim. Each one exists because a real
 *  incident or a real irreversible-data risk made it necessary. */
const SAFETY_CRITICAL = [
  "28 Delete buttons",        // the 2026-08-03 anonymous leak
  "canDeleteHere",            // the correct gate
  "canUploadHere",            // the WRONG gate that caused the leak
  "write-status",             // where canWrite comes from
  "no project argument",      // the destructive harness must stay unaimable
  "confirm_delete=1",         // query-strip-before-root-check ordering
  "263-byte",                 // the Forbidden page that looks like content
  "eventually consistent",    // read-after-write polling requirement
  "byte-identical",           // restore integrity assertion
  "OSF_TEST_TOKEN",           // throwaway credential requirement
  "test:destructive",         // the harness command
];

describe("betterosf-qa skill retains every destructive-path safety rule", () => {
  it("has the extracted reference file", () => {
    expect(existsSync(resolve(root, REF))).toBe(true);
  });

  for (const fact of SAFETY_CRITICAL) {
    it(`still documents "${fact}" somewhere reachable`, () => {
      expect(combined).toContain(fact);
    });
  }

  it("links the reference from the skill so the detail is findable", () => {
    expect(skill).toContain("references/destructive-gates.md");
  });

  it("keeps the P0 warning inline, not only in the reference", () => {
    // Someone skimming the skill must hit the severity signal without a click.
    expect(skill).toMatch(/P0/);
    expect(skill).toContain("28 Delete buttons");
  });

  it("still names all five destructive-code trigger paths", () => {
    for (const p of ["waterbutler-url.ts", "src/lib/backup/", "delete/", "DeleteDialog.tsx", "terms.ts"]) {
      expect(combined, `trigger path ${p} missing`).toContain(p);
    }
  });

  it("still forbids wiring the live harness into /ship or CI", () => {
    expect(reference).toMatch(/NEVER be wired into/i);
  });

  // The byte-identical `.agents` mirror assertion that used to live here was removed on
  // 2026-08-14. Pinning a duplicate is the weaker remedy: it keeps two files that must agree
  // and merely watches them, and it only ever covered ONE of the five duplicated files — the
  // other four had already drifted, including a review copy missing every destructive-
  // operation rule. `.agents/` is now pointers, and
  // `tests/unit/agent-docs-single-source.test.ts` makes a copy impossible to reintroduce.
});
