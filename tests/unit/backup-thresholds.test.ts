import { describe, it, expect } from "vitest";
import { downloadRequirement, MAX_IDB_BYTES, MAX_IDB_FILES } from "@/lib/backup/thresholds";
import { confirmationPhrase, confirmationMatches, requiresAcknowledgement } from "@/lib/terms";

const HEALTHY = { idbAvailable: true, likelyFits: true };

describe("downloadRequirement", () => {
  it("only recommends the ZIP for a small single-file selection", () => {
    const req = downloadRequirement({ totalBytes: 1024, fileCount: 1, containsFolder: false }, HEALTHY);
    expect(req.mandatory).toBe(false);
    expect(req.reasons).toHaveLength(0);
  });

  it("never requires a download when there is nothing to back up", () => {
    // Deleting an empty folder: no data is at risk, so demanding a 0-byte archive is
    // friction with no safety benefit. Note this holds even though containsFolder is
    // true, which would otherwise force the download.
    const req = downloadRequirement({ totalBytes: 0, fileCount: 0, containsFolder: true }, HEALTHY);
    expect(req.mandatory).toBe(false);
    expect(req.reasons).toHaveLength(0);
  });

  it("does not require a download for an empty selection even with storage unavailable", () => {
    const req = downloadRequirement(
      { totalBytes: 0, fileCount: 0, containsFolder: true },
      { idbAvailable: false, likelyFits: false }
    );
    expect(req.mandatory).toBe(false);
  });

  it("requires the ZIP above the size threshold", () => {
    const req = downloadRequirement({ totalBytes: MAX_IDB_BYTES + 1, fileCount: 1, containsFolder: false }, HEALTHY);
    expect(req.mandatory).toBe(true);
  });

  it("requires the ZIP above the file-count threshold", () => {
    const req = downloadRequirement({ totalBytes: 10, fileCount: MAX_IDB_FILES + 1, containsFolder: false }, HEALTHY);
    expect(req.mandatory).toBe(true);
  });

  it("requires the ZIP whenever a folder is involved", () => {
    // Knowable before expansion, and folder deletes are where blast radius is least visible.
    const req = downloadRequirement({ totalBytes: 10, fileCount: 1, containsFolder: true }, HEALTHY);
    expect(req.mandatory).toBe(true);
    expect(req.reasons.join(" ")).toMatch(/folder/i);
  });

  it("requires the ZIP when the browser cannot store backups", () => {
    const req = downloadRequirement(
      { totalBytes: 10, fileCount: 1, containsFolder: false },
      { idbAvailable: false, likelyFits: false }
    );
    expect(req.mandatory).toBe(true);
  });

  it("requires the ZIP when storage will not fit it", () => {
    const req = downloadRequirement(
      { totalBytes: 10, fileCount: 1, containsFolder: false },
      { idbAvailable: true, likelyFits: false }
    );
    expect(req.mandatory).toBe(true);
    expect(req.reasons.join(" ")).toMatch(/space/i);
  });

  it("gives every applicable reason, not just the first", () => {
    const req = downloadRequirement(
      { totalBytes: MAX_IDB_BYTES + 1, fileCount: MAX_IDB_FILES + 1, containsFolder: true },
      HEALTHY
    );
    expect(req.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("confirmation phrases", () => {
  it("uses the bare filename for a single file", () => {
    expect(confirmationPhrase({ mode: "file", name: "data.csv" })).toBe("data.csv");
  });

  it("embeds the real count for bulk so the user must read it", () => {
    expect(confirmationPhrase({ mode: "bulk", itemCount: 7 })).toBe("delete 7 items permanently");
  });

  it("embeds folder name AND count", () => {
    expect(confirmationPhrase({ mode: "folder", name: "raw", itemCount: 12 })).toBe(
      "delete raw and 12 items permanently"
    );
  });

  it("singularises one item", () => {
    expect(confirmationPhrase({ mode: "bulk", itemCount: 1 })).toBe("delete 1 item permanently");
  });

  it("rejects a near-miss", () => {
    const subject = { mode: "file", name: "data.csv" } as const;
    expect(confirmationMatches("data.cs", subject)).toBe(false);
    expect(confirmationMatches("Data.csv", subject)).toBe(false);
    expect(confirmationMatches("data.csv", subject)).toBe(true);
  });

  it("tolerates surrounding whitespace only", () => {
    expect(confirmationMatches("  data.csv  ", { mode: "file", name: "data.csv" })).toBe(true);
  });

  it("requires acknowledgement for folder and bulk but not a single file", () => {
    expect(requiresAcknowledgement({ mode: "file", name: "a" })).toBe(false);
    expect(requiresAcknowledgement({ mode: "folder", name: "a", itemCount: 2 })).toBe(true);
    expect(requiresAcknowledgement({ mode: "bulk", itemCount: 2 })).toBe(true);
  });
});
