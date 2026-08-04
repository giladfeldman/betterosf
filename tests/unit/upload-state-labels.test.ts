/**
 * User feedback 2026-08-04: "'upload pending' is not a clear message, should be
 * something like 'press to upload'".
 *
 * The dialog rendered the raw internal state name ("pending") as the per-file
 * status and labelled the batch button "Upload pending", both of which read as a
 * passive status rather than an action the user still has to take. These tests
 * pin the user-facing copy so the internal state names can never leak again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../../src/components/UploadDialog.tsx"),
  "utf8",
);

describe("upload dialog wording", () => {
  it("no longer uses the ambiguous 'Upload pending' button label", () => {
    expect(source).not.toContain("Upload pending");
  });

  it("does not render the raw internal state name as the per-file status", () => {
    // The old code did: {item.state === "uploading" ? "uploading..." : item.state}
    expect(source).not.toMatch(/:\s*item\.state\s*\}/);
    expect(source).toContain("ITEM_STATE_LABELS[item.state]");
  });

  it("maps every upload state to human-readable copy", () => {
    const block = source.match(
      /const ITEM_STATE_LABELS[\s\S]*?\};/,
    )?.[0];
    expect(block).toBeTruthy();
    // Each of the four states must have an explicit label.
    for (const state of ["pending", "uploading", "done", "error"]) {
      expect(block).toContain(`${state}:`);
    }
    // "ready to upload" tells the user the file is queued and awaiting action.
    expect(block).toContain("ready to upload");
  });

  it("labels the batch button with a concrete count instead of the word 'pending'", () => {
    expect(source).toMatch(/Upload \$\{pendingCount\} file/);
    expect(source).toMatch(/Upload remaining \$\{pendingCount\}/);
  });
});
