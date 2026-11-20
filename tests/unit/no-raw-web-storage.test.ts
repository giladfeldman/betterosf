import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// d-a09501: every localStorage/sessionStorage access goes through
// src/lib/browser/safe-storage.ts. A raw access reappearing elsewhere is a crash waiting
// for a Safari private window or a browser with storage blocked. Comments are stripped
// before matching, so prose may still mention the words; a string literal such as the
// privacy page's "Browser localStorage" is not followed by `.`/`[`/`in`, so it passes.
const ROOT = join(__dirname, "..", "..", "src");
const ALLOWED = new Set([join("lib", "browser", "safe-storage.ts")]);

// An identifier use: `localStorage.x`, `localStorage[`, `localStorage)`, `localStorage;`,
// `typeof localStorage`, or the `"localStorage" in window` probe.
const RAW = /\b(localStorage|sessionStorage)\b\s*(\.|\[|\)|;|,|\?|$)|typeof\s+(localStorage|sessionStorage)\b|["'](localStorage|sessionStorage)["']\s+in\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}

function stripComments(src: string): string {
  // Block comments keep their newlines so reported line numbers stay true.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function offendersIn(code: string): number[] {
  return stripComments(code)
    .split("\n")
    .flatMap((line, i) => (RAW.test(line) ? [i + 1] : []));
}

describe("no raw Web Storage outside safe-storage", () => {
  it("walks the real source tree (a zero must be a real zero)", () => {
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });

  it("detector catches raw accesses and ignores prose (control)", () => {
    expect(offendersIn("const x = window.localStorage.getItem('a');")).toEqual([1]);
    expect(offendersIn("for (let i = 0; i < sessionStorage.length; i++) {}")).toEqual([1]);
    expect(offendersIn('if ("localStorage" in window) {}')).toEqual([1]);
    expect(offendersIn("if (typeof localStorage === 'undefined') {}")).toEqual([1]);
    expect(offendersIn("// localStorage.getItem in a comment")).toEqual([]);
    expect(offendersIn("<strong>Browser localStorage</strong> on your device")).toEqual([]);
  });

  it("has no localStorage/sessionStorage use outside the wrapper", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      for (const line of offendersIn(readFileSync(file, "utf8"))) {
        offenders.push(`${rel.split(sep).join("/")}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
