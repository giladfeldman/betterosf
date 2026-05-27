import { describe, expect, it } from "vitest";
import { middleTruncateFilename } from "@/components/UnifiedTreeNode";

describe("middleTruncateFilename", () => {
  it("keeps short names unchanged", () => {
    expect(middleTruncateFilename("README.txt")).toBe("README.txt");
  });

  it("preserves the extension for long filenames", () => {
    const out = middleTruncateFilename("Newman-etal-2011-Effect-sizes-power-analysis-combined-v4-G.html", 32);
    expect(out.endsWith(".html")).toBe(true);
    expect(out).toContain("...");
    expect(out.length).toBeLessThanOrEqual(32);
  });
});
