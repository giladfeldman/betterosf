#!/usr/bin/env node
/**
 * Public-repo hygiene gate.
 *
 * This repository is public. Anything tracked by git is visible to everyone, so this script
 * fails when a tracked file contains something that belongs only on the maintainer's machine:
 *
 *   1. a maintainer-local path or file (assistant instructions, skills, private backlog, local
 *      deploy metadata, environment files),
 *   2. an e-mail address that is not on the allowlist (a new personal address is the usual leak),
 *   3. a local filesystem path, an AWS account number or a Vercel project/team id,
 *   4. a secret-shaped string (keys, tokens, private keys, database URLs with a password),
 *   5. wording that only makes sense inside the maintainer's private workflow.
 *
 * It scans `git ls-files` (the files a commit would publish), or the working directory when the
 * folder is not a git checkout (for example an exported copy). It reads only; it changes nothing.
 *
 *   node scripts/public-hygiene.mjs        # exit 0 = clean, exit 1 = findings printed
 *
 * `tests/unit/public-hygiene.test.ts` runs the same checks in `npm test`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Tracked paths that must never be published. Matched against the repo-relative path. */
export const FORBIDDEN_PATHS = [
  /^\.claude(\/|$)/,
  /^\.agents(\/|$)/,
  /^\.vercel(\/|$)/,
  /^(CLAUDE|AGENTS)\.md$/i,
  /^todo(-archive)?\.md$/i,
  /^communications(\/|$)/,
  /^docs\/superpowers(\/|$)/,
  /(^|\/)\.env(\.[^/]*)?$/,
];
/** `.env.example` is the one environment file that belongs in the repo. */
const ALLOWED_ENV = /(^|\/)\.env\.example$/;

/** Addresses that are fine to publish: the app's own contact/sender, placeholders, test doubles. */
const EMAIL_ALLOW = [
  /@example\.(org|com|net|test)$/i,
  /@files\.osf\.io$/i, // fake credentials-in-URL test strings (user@host)
  /^betterosf@scimeto\.app$/i,
  /^noreply@(scimeto\.app|example\.(org|com|net))$/i,
  /@simulator\.amazonses\.com$/i,
  /^you@university\.edu$/i,
  /^support@osf\.io$/i,
  /^[a-z0-9._-]*[a-z_-][a-z0-9._-]*@\d+(\.\d+)+$/i, // package@1.2.3 style references
];

const CONTENT_RULES = [
  { id: "local-path", re: /[A-Za-z]:[\\/][Uu]sers[\\/]|\/Users\/[A-Za-z]|\/home\/[a-z]+\/|Dropbox[\\]|[\\]Dropbox/, why: "local filesystem path" },
  {
    id: "aws-account",
    re: /arn:aws:[a-z0-9-]+:[a-z0-9-]*:(?!123456789012\b|999999999999\b|ACCOUNT\b)\d{12}\b/,
    why: "real-looking AWS account number (use 123456789012 in examples and tests)",
  },
  { id: "vercel-id", re: /\b(prj|team)_[A-Za-z0-9]{20,}\b/, why: "Vercel project or team id" },
  { id: "vercel-team-url", re: /vercel\.com\/[a-z0-9-]+-projects\//i, why: "link into a private Vercel dashboard" },
  {
    id: "secret",
    re: /sk-ant-[A-Za-z0-9_-]{20,}|\b[A-Z][A-Z0-9_]*(SECRET|TOKEN|API_KEY|PASSWORD)\s*[=:]\s*["']?(?![A-Za-z0-9+\/_-]*(test|placeholder|example|dummy|fake|no-credential))[A-Za-z0-9+\/_-]{16,}|AKIA[0-9A-Z]{16}|sk_(live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?:\/\/[^\s"'<>:@/$]+:[^\s"'<>@$]+@/,
    why: "secret-shaped string",
  },
  {
    id: "secret",
    // lower/camelCase and quoted-key forms: token = "...", "apiKey": "...", x-api-key: ...
    re: /\b[\w-]*(secret|token|api[_-]?key|password)[\w-]*["']?\s*[=:]\s*["'](?![A-Za-z0-9]*_[A-Za-z0-9_]*["'])(?![A-Za-z0-9+\/_=-]*(test|placeholder|example|dummy|fake|no-credential|redacted))[A-Za-z0-9+\/_=-]{24,}["']|\bx-api-key\s*:\s*[A-Za-z0-9._-]{20,}/i,
    why: "secret-shaped assignment",
  },
  {
    id: "secret",
    re: /\bBearer\s+[A-Za-z0-9._-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    why: "bearer token or JWT",
  },
  {
    id: "private-workflow",
    re: /\b(CLAUDE|AGENTS)\.md\b|\btodo(-archive)?\.md\b|(^|[^\w.])\.(claude|agents)\/|\bgit add (-f|--force)\b|\/ship\b|\/wrapup\b|Claude Max|claude -p\b|~\/\.claude|~\/Vibe|\$VIBE_ROOT|Co-Authored-By/,
    why: "refers to the maintainer's private tooling",
  },
];

/** Files that name the maintainer-local files on purpose (ignore rules; a test that skips them when absent). */
const WORKFLOW_NAME_OK = new Set([".gitignore", ".gitattributes", "tests/unit/dev-port.test.ts"]);
const WORKFLOW_TOOLING = /\/ship\b|\/wrapup\b|Claude Max|claude -p\b|~\/\.claude|~\/Vibe/;

/** Files that legitimately contain the patterns above (this gate and its own test). */
const SELF = new Set(["scripts/public-hygiene.mjs", "tests/unit/public-hygiene.test.ts"]);

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|wasm)$/i;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results", "dist", "build"]);
const SKIP_FILES = new Set(["package-lock.json"]);

function walk(dir, root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

/** Files that would be published: tracked files, or every file when this is not a git checkout. */
export function publishedFiles(root = ROOT) {
  if (existsSync(join(root, ".git"))) {
    try {
      const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return out.split("\0").filter(Boolean).filter((f) => existsSync(join(root, f)));
    } catch {
      /* fall through to a directory walk */
    }
  }
  return walk(root, root);
}

export function scan(root = ROOT) {
  const findings = [];
  for (const file of publishedFiles(root)) {
    if (FORBIDDEN_PATHS.some((re) => re.test(file)) && !ALLOWED_ENV.test(file)) {
      findings.push({ file, rule: "forbidden-path", detail: "maintainer-local file is tracked; untrack it (git rm --cached) and gitignore it" });
      continue;
    }
    if (SELF.has(file) || SKIP_FILES.has(file) || BINARY.test(file)) continue;
    const text = readFileSync(join(root, file), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
        const addr = m[0];
        if (!EMAIL_ALLOW.some((re) => re.test(addr))) {
          findings.push({ file, line: i + 1, rule: "email", detail: `address ${addr} is not on the allowlist` });
        }
      }
      for (const rule of CONTENT_RULES) {
        if (rule.id === "private-workflow" && WORKFLOW_NAME_OK.has(file) && !WORKFLOW_TOOLING.test(line)) continue;
        if (rule.re.test(line)) findings.push({ file, line: i + 1, rule: rule.id, detail: rule.why });
      }
    });
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const findings = scan();
  if (findings.length === 0) {
    console.log("public-hygiene: clean (nothing maintainer-local is published)");
    process.exit(0);
  }
  console.error(`public-hygiene: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  ${f.file}${f.line ? ":" + f.line : ""}  [${f.rule}]  ${f.detail}`);
  process.exit(1);
}
