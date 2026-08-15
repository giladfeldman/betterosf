/**
 * One archive, two producers — and nothing used to check they agreed.
 *
 * A whole-tree ZIP is assembled server-side by `/api/zip/[guid]` and in the browser from
 * `/api/zip/[guid]/manifest`. The browser path falls back to the server one silently, so a
 * researcher is never told which built their archive. That makes the two a duplication
 * invariant (defect class 10): two things that must agree, with nothing checking that they do.
 *
 * They had already drifted by the end of the session that introduced the second one — the
 * partial-failure report carried a different header on each side. The remedy is a single
 * module both import (a pointer cannot drift), and this pins the shape that module produces
 * plus the fact that both routes really use it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeFolderName, nodeFolder, errorsFileName, errorsFileBody } from "@/lib/zip/tree-naming";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Source with block and line comments removed, so prose cannot satisfy or fail a code check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("safeFolderName", () => {
  it("strips path separators, which would invent folder levels the project never had", () => {
    expect(safeFolderName("a/b")).toBe("a_b");
    expect(safeFolderName("a\\b")).toBe("a_b");
  });

  it("never returns empty", () => {
    expect(safeFolderName("")).toBe("untitled");
    expect(safeFolderName("   ")).toBe("untitled");
  });

  it("caps the length so a long title cannot blow the path limit", () => {
    expect(safeFolderName("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("nodeFolder", () => {
  const base = { rootTitle: "Root project", guid: "kid01", title: "A component", linked: false };

  it("puts the root at the archive root", () => {
    expect(nodeFolder({ ...base, guid: "abc12", title: "Root project", isRoot: true })).toBe(
      "Root project",
    );
  });

  it("carries the guid, because two components can share a title", () => {
    // Without the guid, two same-named components would merge into one folder and one would
    // silently overwrite the other.
    const a = nodeFolder({ ...base, guid: "kid01", isRoot: false });
    const b = nodeFolder({ ...base, guid: "kid02", isRoot: false });
    expect(a).not.toBe(b);
    expect(a).toBe("Root project/A component_kid01");
  });

  it("marks a linked project, so it is never mistaken for the author's own work", () => {
    expect(nodeFolder({ ...base, linked: true, isRoot: false })).toBe(
      "Root project/linked_A component_kid01",
    );
  });
});

describe("the partial-failure report", () => {
  it("names the project and the time, so the archive is self-describing", () => {
    const body = errorsFileBody({
      guid: "abc12",
      generatedAt: "2026-08-14T12:00:00Z",
      problems: ["[abc12/osfstorage] HTTP 500"],
    });
    expect(body).toContain("BetterOSF whole-tree ZIP — partial failures");
    expect(body).toContain("Generated for OSF project abc12 at 2026-08-14T12:00:00Z");
    expect(body).toContain("- [abc12/osfstorage] HTTP 500");
  });

  it("sits inside the root folder, not beside it", () => {
    expect(errorsFileName("Root project")).toBe("Root project/_BETTEROSF_ERRORS.txt");
  });
});

describe("both producers use the shared module, rather than their own copy", () => {
  const sources = {
    "server whole-tree route": "src/app/api/zip/[guid]/route.ts",
    "manifest route": "src/app/api/zip/[guid]/manifest/route.ts",
    "browser assembler": "src/lib/download/browser-zip.ts",
  };

  it.each(Object.entries(sources))("%s imports @/lib/zip/tree-naming", (_label, path) => {
    expect(read(path)).toMatch(/from "@\/lib\/zip\/tree-naming"/);
  });

  it.each(Object.entries(sources))("%s defines no local copy of the helpers", (_label, path) => {
    // Comments are stripped first. These files legitimately DESCRIBE the shared artefacts in
    // prose — "the `_BETTEROSF_ERRORS.txt` file listing partial failures" is documentation,
    // not a second copy. Asserting over raw text made the prose fail the check, which would
    // have taught the next reader to delete the explanation instead of the duplication.
    const src = stripComments(read(path));
    // A re-declared helper is exactly how the two sides drifted the first time.
    expect(src).not.toMatch(/function safeFolderName/);
    expect(src).not.toMatch(/_BETTEROSF_ERRORS\.txt/);
    expect(src).not.toMatch(/BetterOSF whole-tree ZIP — partial failures/);
  });
});
