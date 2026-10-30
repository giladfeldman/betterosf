/**
 * The repository is public, so what is tracked must contain nothing maintainer-local.
 * The checks live in scripts/public-hygiene.mjs; this test runs them in `npm test` and proves
 * each rule can actually fire (a gate that cannot fail would pass an empty or broken scan).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs module without type declarations
import { scan, publishedFiles, FORBIDDEN_PATHS } from "../../scripts/public-hygiene.mjs";

type Finding = { file: string; line?: number; rule: string; detail: string };

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hygiene-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("public-repo hygiene", () => {
  it("scans a real set of files (an empty scan would pass everything)", () => {
    expect(publishedFiles().length).toBeGreaterThan(50);
  });

  it("finds nothing maintainer-local in the files this repository publishes", () => {
    const findings = scan() as Finding[];
    expect(findings.map((f) => `${f.file}${f.line ? ":" + f.line : ""} [${f.rule}] ${f.detail}`)).toEqual([]);
  });

  describe("each rule can fire", () => {
    const cases: Array<[string, Record<string, string>, string]> = [
      ["assistant instructions tracked", { "CLAUDE.md": "x" }, "forbidden-path"],
      ["private backlog tracked", { "todo.md": "x" }, "forbidden-path"],
      ["skills folder tracked", { ".claude/skills/a/SKILL.md": "x" }, "forbidden-path"],
      ["environment file tracked", { ".env.local": "A=1" }, "forbidden-path"],
      ["unknown e-mail address", { "a.md": "write to someone@gmail.com" }, "email"],
      ["local path", { "a.md": "cd C:\\Users\\someone\\project" }, "local-path"],
      ["AWS account number", { "a.ts": "arn:aws:sns:eu-west-1:111122223333:topic" }, "aws-account"],
      ["Vercel project id", { "a.json": '{"projectId":"prj_abcdefghijklmnopqrstuvwxyz1"}' }, "vercel-id"],
      ["secret key", { "a.ts": "const k = 'AKIAABCDEFGHIJKLMNOP'" }, "secret"],
      ["database URL with password", { "a.ts": "postgres://user:hunter2@host/db" }, "secret"],
      ["private workflow wording", { "a.md": "then run /ship" }, "private-workflow"],
      ["assistant-instructions file named in prose", { "a.md": "see CLAUDE.md and todo.md" }, "private-workflow"],
      ["maintainer-local folder named", { "a.md": "in .claude/skills/x" }, "private-workflow"],
      ["forward-slash local path", { "a.md": "C:/Users/Someone/x" }, "local-path"],
      ["macOS home path", { "a.md": "/Users/Someone/x" }, "local-path"],
      ["Anthropic key", { "a.ts": "k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'" }, "secret"],
      ["secret assignment", { "a.env": "AUTH_SECRET=abcdefghijklmnop1234" }, "secret"],
      ["secret in YAML colon form", { "a.yml": 'OSF_CLIENT_SECRET: "abcdEFGH1234567890abcdEFGH"' }, "secret"],
      ["lowercase token assignment", { "a.ts": 'const token = "abcdEFGH1234567890abcdEFGH12";' }, "secret"],
      ["quoted-key JSON secret", { "a.json": '{"apiKey": "abcdEFGH1234567890abcdEFGH12"}' }, "secret"],
      ["header-style key", { "a.md": "x-api-key: abcdEFGH1234567890abcdEFGH1234" }, "secret"],
      ["bearer token", { "a.md": "Authorization: Bearer abcdefghijklmnopqrstuv1234" }, "secret"],
      ["JWT", { "a.md": "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop" }, "secret"],
      ["forced add reminder", { "a.md": "then git add -f secrets.txt" }, "private-workflow"],
      ["noreply at a personal domain", { "a.md": "noreply@evil-personal.com" }, "email"],
      ["numeric-domain address", { "a.md": "someone@1.example.io" }, "email"],
    ];
    for (const [name, files, rule] of cases) {
      it(`flags: ${name}`, () => {
        const dir = fixture(files);
        try {
          expect((scan(dir) as Finding[]).map((f) => f.rule)).toContain(rule);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }

    it("allows .env.example and the placeholder addresses", () => {
      const dir = fixture({ ".env.example": "A=\n# admin@example.org", "a.md": "mail betterosf@scimeto.app" });
      try {
        expect(scan(dir)).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("lists every forbidden-path rule it enforces", () => {
      expect(FORBIDDEN_PATHS.length).toBeGreaterThanOrEqual(8);
    });
  });
});
