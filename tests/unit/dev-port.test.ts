/**
 * User directive 2026-08-04: "change betterosf to a non common port throughout
 * and make sure it never uses 3000 again."
 *
 * Port 3000 is the default for Next.js, CRA, Express, Rails-ish tooling and half
 * the JS ecosystem, so on a machine running several projects it is routinely
 * already taken. During this session that caused a REAL misdiagnosis: a probe of
 * "BetterOSF on localhost:3000" actually hit a different project's server and
 * returned its HTML, which briefly looked like a BetterOSF bug.
 *
 * BetterOSF uses 4747 (already the port in start_app.bat and the README).
 *
 * This suite is the enforcement mechanism, not documentation: it scans the real
 * operational files and fails if 3000 reappears in any of them. Docs under
 * docs/superpowers/** are historical records of past sessions and are
 * deliberately excluded — rewriting history would be dishonest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

export const DEV_PORT = 4747;

/**
 * Files that actually control where a server binds or where a probe points.
 * A stale 3000 in any of these sends real traffic to the wrong process.
 */
const OPERATIONAL_FILES = [
  "package.json",
  "playwright.config.ts",
  "start_app.bat",
  ".env.example",
  "tests/visual/visual-qa.mjs",
  "tests/setup.ts",
  "tests/e2e/smoke.spec.ts",
  // CLAUDE.md / AGENTS.md / README.md are deliberately NOT listed: they explain
  // *why* 3000 is banned and quote the incident, so they must be allowed to name
  // the port. The repo-wide sweep below exempts them for the same reason. They
  // are still covered by the "no runnable 3000 command" check further down,
  // which is the rule that actually matters for a doc.
];

// `localhost:3000`, `:3000`, `port: 3000`, `-p 3000`, `PORT=3000` — but NOT
// incidental numbers like `waitForTimeout(3000)` or a `30001793` version string.
const PORT_3000_RE =
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):3000\b|(?:^|[^\d])(?:-p|--port|port)[=:\s]+3000\b|PORT[=:\s]+3000\b/im;

describe("BetterOSF never binds or probes port 3000", () => {
  for (const file of OPERATIONAL_FILES) {
    it(`${file} contains no port-3000 reference`, () => {
      if (!existsSync(resolve(root, file))) return; // optional file
      const source = read(file);
      const match = source.match(PORT_3000_RE);
      expect(
        match?.[0] ?? null,
        `${file} still references port 3000 — BetterOSF must use ${DEV_PORT}. ` +
          `Port 3000 collides with other local projects and has already caused a ` +
          `misdiagnosis (a probe hit a different app's server).`,
      ).toBeNull();
    });
  }

  it("the guard regex actually detects the forms we care about", () => {
    // Without this, a broken regex would make every test above vacuously pass.
    expect("http://localhost:3000/foo").toMatch(PORT_3000_RE);
    expect("baseURL: 'http://127.0.0.1:3000'").toMatch(PORT_3000_RE);
    expect("port: 3000,").toMatch(PORT_3000_RE);
    expect("npx next start -p 3000").toMatch(PORT_3000_RE);
    expect("set PORT=3000").toMatch(PORT_3000_RE);
  });

  it("the guard does NOT flag incidental uses of the number 3000", () => {
    // These must stay legal, or the guard becomes noise people disable.
    expect("await page.waitForTimeout(3000);").not.toMatch(PORT_3000_RE);
    expect('"version": "1.0.30001793"').not.toMatch(PORT_3000_RE);
    expect("const TIMEOUT_MS = 3000;").not.toMatch(PORT_3000_RE);
  });
});

/**
 * The explicit list above documents intent, but a fixed list cannot catch a NEW
 * file that introduces port 3000. This walks the whole repo so the ban holds for
 * files that do not exist yet — the actual "never again" guarantee.
 */
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "test-results", "playwright-report",
  "coverage", "dist", "build", ".vercel",
]);

/** Paths where a 3000 mention is legitimate and must NOT fail the build. */
function isExempt(relPath: string): boolean {
  const p = relPath.split(sep).join("/");
  // Historical session records — rewriting them would falsify what was run.
  if (p.startsWith("docs/superpowers/")) return true;
  // Scratch output from past review tooling (gitignored).
  if (p.includes("deep-review-tmp/")) return true;
  // Dependency lockfile (contains version numbers like 1.0.30001793).
  if (p.endsWith("package-lock.json")) return true;
  // This guard itself, which must contain the banned string to test for it.
  if (p.endsWith("tests/unit/dev-port.test.ts")) return true;
  // Narrative documentation: these explain WHY 3000 is banned and record the
  // migration, so they necessarily name the old port. Rewriting them to hide it
  // would erase the reason the rule exists. They are NOT unguarded — the
  // "no runnable command" suite below covers them, which is the property that
  // actually matters for prose: an agent copy-pastes commands, not sentences.
  if (NARRATIVE_DOCS.has(p) || NARRATIVE_DOCS.has(p.toLowerCase())) return true;
  if (p.endsWith("_project/lessons.md") || p.endsWith("LESSONS.md")) return true;
  // The same narrative, at the paths the 2026-10-01 docs split moved it to: CLAUDE.md detail
  // (moved verbatim to references/claude-md/), the lessons journal (one card per entry), the
  // TODO archive, and gitignored past correspondence. Exempt for the reason above, still
  // covered by the "no runnable command" suite.
  if (p.startsWith("references/claude-md/")) return true;
  if (p.startsWith(".claude/skills/_project/lessons/")) return true;
  if (p.toLowerCase() === "todo-archive.md") return true;
  if (p.startsWith("communications/")) return true;
  return false;
}

/** Docs allowed to *mention* 3000 while explaining the ban or the migration. */
const NARRATIVE_DOCS = new Set([
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "KNOWN_ISSUES.md",
  "todo.md",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|cjs|js|jsx|json|md|bat|sh|ps1|ya?ml|env|example)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("repo-wide sweep: no file reintroduces port 3000", () => {
  it("finds zero port-3000 references outside the documented exemptions", () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const rel = relative(root, file);
      if (isExempt(rel)) continue;
      let source: string;
      try { source = readFileSync(file, "utf8"); } catch { continue; }
      const m = source.match(PORT_3000_RE);
      if (m) offenders.push(`${rel.split(sep).join("/")} → "${m[0]}"`);
    }
    expect(
      offenders,
      `These files reference port 3000. BetterOSF uses ${DEV_PORT}; 3000 collides ` +
        `with other local projects and has already produced a confidently wrong ` +
        `test result. Fix them, or add a justified exemption to isExempt().`,
    ).toEqual([]);
  });

  it("the sweep actually reaches real files (guard against a vacuous pass)", () => {
    // If walk() silently returned [], every assertion above would pass for the
    // wrong reason. Pin that it sees a meaningful number of files.
    const files = walk(root).map((f) => relative(root, f).split(sep).join("/"));
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("package.json");
    expect(files).toContain("playwright.config.ts");
  });
});

describe("agent docs may explain the 3000 ban but never instruct using it", () => {
  // These files are exempt from the blanket scan (they quote the incident), so
  // they get a narrower rule: prose about 3000 is fine, a runnable command that
  // TARGETS 3000 is not — that is what an agent would actually copy and paste.
  // Derived from the exemption set, so exempting a doc can never leave it
  // unguarded — the two lists cannot drift apart.
  for (const file of [...NARRATIVE_DOCS, ".claude/skills/_project/lessons.md"]) {
    it(`${file} contains no runnable command pointing at port 3000`, () => {
      const source = read(file);
      const bad = [
        /--base-url=https?:\/\/localhost:3000/,
        /curl[^\n]*localhost:3000/,
        /next (?:dev|start)[^\n]*-p\s*3000/,
        /BASE_URL=https?:\/\/localhost:3000/,
      ];
      for (const re of bad) {
        expect(source.match(re)?.[0] ?? null, `${file} has a runnable 3000 command`).toBeNull();
      }
    });
  }

  it("both docs state the rule and point at the enforcing test", () => {
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const source = read(file);
      expect(source).toContain(String(DEV_PORT));
      expect(source).toContain("dev-port.test.ts");
    }
  });
});

describe("the chosen port is configured consistently", () => {
  it("package.json dev/start scripts pin the BetterOSF port", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toContain(String(DEV_PORT));
    expect(pkg.scripts.start).toContain(String(DEV_PORT));
  });

  it("playwright targets the same port it starts the server on", () => {
    const cfg = read("playwright.config.ts");
    expect(cfg).toContain(`localhost:${DEV_PORT}`);
    expect(cfg).toContain(`port: ${DEV_PORT}`);
  });

  it("visual-qa defaults to the BetterOSF port, not a generic one", () => {
    expect(read("tests/visual/visual-qa.mjs")).toContain(String(DEV_PORT));
  });

  it("start_app.bat uses the same port as everything else", () => {
    expect(read("start_app.bat")).toContain(`set PORT=${DEV_PORT}`);
  });
});
