/**
 * Guidance lives in ONE place. A second copy is a copy that goes stale silently.
 *
 * THE DEFECT, found 2026-08-14. `.agents/` held hand-maintained duplicates of all four
 * project skills and of the project lesson log, and `AGENTS.md` was a second copy of
 * `CLAUDE.md`. They had drifted in four independent ways, none of which failed loudly:
 *
 *   1. A global find-replace rewrote `~/.claude/` -> `~/.Codex/` in three of the four skill
 *      copies. `~/.Codex/skills/_shared/` DOES NOT EXIST, so 102 preflight and lesson
 *      instructions pointed at nothing. An agent following them reads no rules, and gets no
 *      error to tell it so.
 *   2. The same replace hit `claude-code` where it was a lesson TAG rather than a path,
 *      silently corrupting two tags into `Codex`.
 *   3. `betterosf-review`'s copy was missing the ENTIRE destructive-operation section — nine
 *      rules covering the only irreversible thing this app does. OSF has no trash. Whichever
 *      agent read that tree reviewed delete-path changes with none of them.
 *   4. `.agents/skills/_project/lessons.md` had stopped at v1.6.0: 159 lines against the real
 *      file's 1151, missing every lesson from the nine releases that shipped broken.
 *
 * A prior fix had force-synced ONE of the pairs to byte-identical and pinned that pair with a
 * test. That is the weaker remedy: it keeps the duplication and merely watches it. The user's
 * call on 2026-08-14 was to keep one place — so `.agents/` is now pointers, `AGENTS.md` is a
 * pointer, and this test makes a copy impossible to reintroduce quietly.
 *
 * Verified red on 2026-08-14 by restoring a real skill body into `.agents/` and by adding a
 * `~/.Codex/` path back; both failed here.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const agentFiles = walk(resolve(root, ".agents"))
  .map((f) => relative(root, f).replace(/\\/g, "/"))
  .sort();

/** Markers only a REAL skill body carries. Their presence under `.agents/` means somebody
 *  pasted a copy back in — which is the whole defect, not a formatting nit. */
const REAL_SKILL_MARKERS = [
  "preflight-filter.sh",
  "postflight_heartbeat",
  "## Phase 0",
  "spine-gate.sh",
];

describe(".agents/ holds pointers, never copies", () => {
  it("scanned some files at all (an empty walk would pass every assertion below)", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  for (const file of agentFiles) {
    const text = read(file);

    it(`${file} points at its .claude counterpart`, () => {
      expect(text).toMatch(/\.claude\/skills\//);
      expect(text.toLowerCase()).toContain("not the source of truth");
    });

    it(`${file} is a pointer, not a pasted-back copy`, () => {
      for (const marker of REAL_SKILL_MARKERS) {
        expect(
          text,
          `"${marker}" belongs to a real skill body. Finding it under .agents/ means a copy ` +
            `came back. Delete it and leave the pointer — .claude/ is the one place.`,
        ).not.toContain(marker);
      }
      // A pointer has no room to drift. A copy does.
      expect(text.split("\n").length).toBeLessThan(60);
    });

    it(`${file} names a .claude path that actually resolves`, () => {
      // The `~/.Codex/` rewrite failed exactly here: every path it produced was dangling,
      // and nothing checked. A pointer whose target does not exist is worse than no pointer.
      const targets = [...text.matchAll(/`?(\.claude\/[^\s`)]+\.md)`?/g)].map((m) => m[1]);
      expect(targets.length, "the pointer names no target at all").toBeGreaterThan(0);
      for (const t of targets) {
        if (!t) continue;
        expect(existsSync(resolve(root, t)), `pointer target ${t} does not exist`).toBe(true);
      }
    });
  }

  it("never INSTRUCTS an agent to run or read a path under ~/.Codex", () => {
    // Deliberately anchored on the instruction verbs rather than on the bare string. These
    // pointer files describe the dangling-path defect in prose, and a naive substring check
    // would fire on the description of the bug instead of the bug — the same
    // weakest-signal-decides mistake as class 7. What must never come back is the form that
    // sends an agent to a nonexistent file: "bash `~/.Codex/...`", "read `~/.Codex/...`".
    const instruction = /(?:bash|read|load|initialize)\s+`?~\/\.Codex\//i;
    for (const f of [...agentFiles, "AGENTS.md", "CLAUDE.md"]) {
      expect(
        read(f),
        `${f} tells an agent to use a path under ~/.Codex/, which does not exist on this ` +
          `machine. It will read nothing and report no error.`,
      ).not.toMatch(instruction);
    }
  });
});

describe("AGENTS.md is a pointer to CLAUDE.md, not a second copy of it", () => {
  const agents = read("AGENTS.md");

  it("names CLAUDE.md as authoritative", () => {
    expect(agents).toMatch(/CLAUDE\.md/);
    expect(agents.toLowerCase()).toMatch(/authoritative|source of truth/);
  });

  it("stays short enough that it cannot drift back into a copy", () => {
    // It was 140 lines and five releases stale when this was written. CLAUDE.md was 393.
    expect(agents.split("\n").length).toBeLessThan(60);
  });

  it("every repo path it names resolves", () => {
    const paths = [...agents.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      if (!p) continue;
      expect(existsSync(resolve(root, p)), `AGENTS.md links ${p}, which does not exist`).toBe(true);
    }
  });
});
