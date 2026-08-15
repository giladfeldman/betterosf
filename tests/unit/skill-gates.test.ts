/**
 * The four project skills must keep the gates added on 2026-08-14, and the shared class
 * reference must not claim enforcement it does not have.
 *
 * WHY. Nine defects shipped to production in two days from one feature (v1.10.x–v1.11.1).
 * Every one passed a fully green suite, a clean `tsc --noEmit`, a clean lint and 93/93 visual
 * QA. They were invisible to the KIND of checking being done. The gates that close them are
 * mostly prose in SKILL.md files — and prose is exactly what a future "trim the skill, it is
 * too long" pass deletes first, with no test going red. `betterosf-qa` has already been
 * trimmed once (382 -> 335 lines), which is what motivated the sibling
 * `qa-skill-integrity.test.ts`.
 *
 * So this file pins the ANCHORS, not the wording: rewriting a gate is fine, deleting one is
 * not. It also pins the honesty of the reference's own enforcement table — a row claiming a
 * test enforces a class, naming a test that does not exist, would be the "no pretending" rule
 * broken inside the very document written to prevent it.
 *
 * Verified red on 2026-08-14 by deleting each gate anchor in turn.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Collapse runs of whitespace before matching an anchor.
 *
 * These are hand-wrapped prose files, so a reflow moves a line break into the middle of an
 * anchor and the gate goes red for a change that deleted nothing. A false red is not a
 * harmless inconvenience here — it is how a gate earns a reputation for crying wolf and gets
 * removed by the next person in a hurry. Only the words are pinned; the layout is free.
 */
const flat = (s: string) => s.replace(/\s+/g, " ");

const CLASSES = ".claude/skills/_project/defect-classes.md";
const SKILLS = {
  qa: ".claude/skills/betterosf-qa/SKILL.md",
  review: ".claude/skills/betterosf-review/SKILL.md",
  cleanup: ".claude/skills/betterosf-cleanup/SKILL.md",
  deploy: ".claude/skills/betterosf-deploy/SKILL.md",
} as const;

describe("the shared defect-class reference", () => {
  const text = read(CLASSES);

  it("exists and is read before anything else by all four skills", () => {
    for (const [name, path] of Object.entries(SKILLS)) {
      const skill = read(path);
      expect(flat(skill), `${name} does not point at the shared class reference`).toContain(
        "_project/defect-classes.md",
      );
      // The link is relative from the skill's own directory; a broken one is a claim that
      // does not resolve, which is worse than no link.
      const target = resolve(root, dirname(path), "../_project/defect-classes.md");
      expect(existsSync(target), `${name}'s relative link does not resolve`).toBe(true);
    }
  });

  it("keeps all four questions to ask before checking anything", () => {
    // Whitespace-tolerant on purpose: these files are hand-wrapped prose, so a reflow must
    // not read as a deleted rule. Only the words matter.
    for (const anchor of [
      /Node's `fetch`\s+ignores\s+CORS/,      // 1 — the test environment gap
      /SHAPE\s+of\s+the\s+evidence/,          // 2 — does the diagnosis fit the pattern
      /add\s+observability/,                  // 3 — instrument before the third guess
      /claim\s+to\s+verify/,                  // 4 — a comment is a claim
    ]) {
      expect(text, `meta-lesson anchor ${anchor} is gone`).toMatch(anchor);
    }
  });

  it("keeps every one of the eleven classes", () => {
    for (const cls of [
      "Seam defect",
      "Unbounded loop inside one request",
      "Optional chain that silently misses",
      "Reachability",
      "Browser-only control invisible to Node",
      "Resource lifetime vs a lazy consumer",
      "Evidence ranking",
      "All-or-nothing on long-running work",
      "Browser-only control invisible to vitest/jsdom",
      "Duplication invariant",
      "A type forcing a false value",
    ]) {
      expect(flat(text), `class "${cls}" was dropped from the table`).toContain(cls);
    }
  });

  it("never claims a class is enforced by a test that does not exist", () => {
    // The enforcement table is the one place a reader decides "that one is covered, skip it".
    // A row naming a deleted test would send them past an unguarded class with confidence.
    const named = [...text.matchAll(/`(tests\/[^`]+\.test\.ts)`/g)].map((m) => m[1]);
    expect(named.length, "the enforcement table names no tests at all").toBeGreaterThan(4);
    for (const t of new Set(named)) {
      expect(existsSync(resolve(root, t!)), `defect-classes.md claims ${t} enforces a class, but it does not exist`).toBe(true);
    }
  });
});

describe("every skill ends with a verification checklist", () => {
  // A gate is only a gate if the run confirms it ran. Without a terminal checklist, "I ran the
  // browser-only controls gate" is unfalsifiable in the report — which is how nine defects
  // shipped past a skill that already contained rules covering several of them.
  for (const [name, path] of Object.entries(SKILLS)) {
    it(`${name} asks the run to confirm each gate fired or say why not`, () => {
      const text = flat(read(path));
      expect(text, `${name} has no Verification checklist`).toContain("Verification checklist");
      expect(text, `${name}'s checklist has no tickable items`).toContain("- [ ]");
      // "Not applicable" must be a legal answer, or the checklist trains people to tick
      // everything — a checklist that cannot be honestly declined is one that gets faked.
      expect(text.toLowerCase()).toMatch(/or say why not|not applicable/);
    });
  }
});

describe("betterosf-qa keeps its diff-shape gates", () => {
  // The detail lives in references/ so SKILL.md stays skimmable (it was extracted on
  // 2026-08-14, taking the skill from 420 back to 366 lines — below where it started). The
  // risk in ANY such extraction is that the line count improves while a rule quietly
  // disappears, so these anchors are checked against skill + reference COMBINED, exactly as
  // the sibling qa-skill-integrity.test.ts does for the destructive gates.
  const qa = read(SKILLS.qa);
  const ref = read(".claude/skills/betterosf-qa/references/diff-shape-gates.md");
  const combined = flat(qa + "\n" + ref).toLowerCase();

  it("still links the reference, so the detail is findable at all", () => {
    expect(flat(qa)).toContain("references/diff-shape-gates.md");
  });

  it("keeps a trigger visible INLINE for every gate, so none can be missed by skimming", () => {
    // A gate whose only trace is inside a linked file is a gate nobody opens.
    for (const trigger of ["fetch(", "src/app/**/page.tsx", "loop over upstream data"]) {
      expect(flat(qa), `no inline trigger row mentions ${trigger}`).toContain(trigger);
    }
  });

  const anchors: Array<[string, string]> = [
    ["seam gate (class 1)", "seam gate"],
    ["the seam question, stated so it cannot be skimmed past", "test that spans this join"],
    ["reachability gate (class 4)", "route-reachability.test.ts"],
    ["long-run gate (classes 2 + 8)", "long-run gate"],
    ["the every-exit rule that class 8 turns on", "every** exit"],
    ["browser-only controls (classes 5 + 9)", "connect-src"],
    ["the bogus-control rule that makes a preflight probe mean anything", "control"],
  ];
  for (const [what, anchor] of anchors) {
    it(`still has ${what}`, () => expect(combined).toContain(anchor.toLowerCase()));
  }

  // The anchors above are all ALSO present inline, so none of them can detect a rule being
  // deleted from the reference alone — which is precisely the risk an extraction creates.
  // Caught on 2026-08-14 by red-testing the guard and watching it stay green. These four live
  // ONLY in the reference, so they are what actually pins its contents.
  const referenceOnly: Array<[string, string]> = [
    ["the redirect-chain rule (Waterbutler 302s to a CORS-less bucket)", "storage.googleapis.com"],
    ["why OSF downloads must use ?direct=", "?direct="],
    ["the unborrowable redirect-only exemption for legacy aliases", "legacy alias"],
    ["the worked example a seam test should copy", "api-error.test.ts"],
  ];
  for (const [what, anchor] of referenceOnly) {
    it(`reference still documents ${what}`, () => {
      expect(flat(ref).toLowerCase()).toContain(anchor.toLowerCase());
    });
  }
});

describe("betterosf-review keeps the diagnosis preamble and the un-automated classes", () => {
  const review = read(SKILLS.review);

  it("has the how-to-think-about-a-bug-report preamble BEFORE the checklists", () => {
    const preamble = review.indexOf("How to think about a bug report");
    expect(preamble, "the diagnosis preamble is gone").toBeGreaterThan(-1);
    // Review is where diagnosis discipline belongs; behind the checklists it is decoration.
    expect(preamble).toBeLessThan(review.indexOf("Blast-radius"));
  });

  it("keeps the three evidence-shape signatures that each cost a debugging round", () => {
    expect(review).toMatch(/perfectly selective by origin/i);
    expect(review).toMatch(/size split/i);
    expect(review).toMatch(/same point every run/i);
  });

  for (const [cls, anchor] of [
    ["3 (dead fallback)", "dead code wearing a disguise"],
    ["6 (resource lifetime)", "lazy consumer"],
    ["7 (evidence ranking)", "a hash is a statement"],
    ["11 (a type forcing a false value)", "defect in the type"],
  ] as const) {
    it(`keeps class ${cls}`, () => expect(flat(review)).toContain(anchor));
  }
});

describe("betterosf-cleanup keeps the three documentation-shaped gates", () => {
  const cleanup = read(SKILLS.cleanup);
  for (const [what, anchor] of [
    ["the comment-claim audit", "Comment-claim audit"],
    ["single-source integrity", "agent-docs-single-source.test.ts"],
    ["the binary-mode patching rule", "newline="],
    ["dead-fallback detection", "Dead FALLBACKS are dead code too"],
  ] as const) {
    it(`still has ${what}`, () => expect(flat(cleanup)).toContain(anchor));
  }
});

describe("betterosf-deploy keeps the assertions only a deploy can make", () => {
  const deploy = read(SKILLS.deploy);

  it("still runs the served-header check, and the script it names exists", () => {
    expect(flat(deploy)).toContain("scripts/check-served-headers.mjs");
    expect(existsSync(resolve(root, "scripts/check-served-headers.mjs"))).toBe(true);
  });

  it("still distinguishes UNVERIFIED from PASS and FAIL", () => {
    // Without this the 429 bot-mitigation response reads as a missing header (or, with an
    // inverted grep, as a clean pass) and the gate reports a defect that is not there.
    expect(flat(deploy)).toContain("UNVERIFIED");
  });

  it("still asserts required env vars in the TARGET environment", () => {
    expect(flat(deploy)).toContain("vercel env ls");
    expect(flat(deploy)).toContain("ZENODO_ENV");
  });
});
