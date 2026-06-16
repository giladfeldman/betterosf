import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

describe("route contracts", () => {
  it("keeps critical API routes wired", () => {
    expect(exists("src/app/api/zip/[guid]/route.ts")).toBe(true);
    expect(exists("src/app/api/osf/write-status/route.ts")).toBe(true);
  });

  it("keeps deep folder page route wired", () => {
    expect(exists("src/app/[guid]/files/[...path]/page.tsx")).toBe(true);
  });
});
