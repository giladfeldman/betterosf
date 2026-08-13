// The export report and crosswalk CSV.
//
// The report is what a researcher keeps and, months later, reads to decide whether it is
// safe to delete the original. So the one thing it must never do is let an INCOMPLETE
// export read as a successful one.

import { describe, it, expect } from "vitest";
import { renderReportMarkdown, renderCrosswalkCsv, csvCell, type ReportInput } from "@/lib/transition/report";
import { reconcile } from "@/lib/transition/verify";

function base(over: Partial<ReportInput> = {}): ReportInput {
  return {
    projectTitle: "Many Labs 2",
    projectGuid: "8cd4r",
    osfUrl: "https://osf.io/8cd4r/",
    osfDoi: "10.17605/OSF.IO/8CD4R",
    destination: { name: "Zenodo", recordUrl: "https://zenodo.org/records/1", doi: "10.5281/zenodo.1" },
    verdict: reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 10 }],
      results: [{ osfFileId: "a", path: "a.csv", state: "verified", checks: [], problems: [] }],
    }),
    fidelity: [
      { field: "rights", source: "CC0 1.0 Universal", status: "exact", note: "Matched exactly." },
    ],
    files: [{ path: "a.csv", size: 10, sha256: "aaa", state: "verified", destinationKey: "a.csv" }],
    createdAt: "2026-08-13T10:00:00.000Z",
    appVersion: "1.8.0",
    ...over,
  };
}

describe("report status", () => {
  it("says COMPLETE only when the verdict is complete", () => {
    expect(renderReportMarkdown(base())).toContain("**COMPLETE**");
  });

  it("leads with a warning when the export was incomplete", () => {
    const verdict = reconcile({
      expected: [
        { osfFileId: "a", path: "a.csv", size: 10 },
        { osfFileId: "b", path: "b.csv", size: 10 },
      ],
      results: [{ osfFileId: "a", path: "a.csv", state: "verified", checks: [], problems: [] }],
    });
    const md = renderReportMarkdown(base({ verdict }));
    expect(md).toContain("**INCOMPLETE — do not treat this as a full copy.**");
    expect(md).toContain("### Missing");
    expect(md).toContain("`b.csv`");
  });

  it("never lets an EMPTY run read as success", () => {
    const verdict = reconcile({ expected: [], results: [] });
    const md = renderReportMarkdown(base({ verdict, files: [] }));
    expect(md).toContain("**NOTHING WAS TRANSFERRED**");
    expect(md).not.toContain("**COMPLETE**");
  });

  it("lists failures with their specific problems", () => {
    const verdict = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 10 }],
      results: [
        { osfFileId: "a", path: "a.csv", state: "failed", checks: [], problems: ["SHA-256 does NOT match"] },
      ],
    });
    expect(renderReportMarkdown(base({ verdict }))).toContain("SHA-256 does NOT match");
  });

  it("explains unverifiable files rather than burying them", () => {
    const verdict = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 10 }],
      results: [{ osfFileId: "a", path: "a.csv", state: "unverifiable", checks: [], problems: [] }],
    });
    const md = renderReportMarkdown(base({ verdict }));
    expect(md).toContain("### Transferred but not verifiable");
    expect(md).toMatch(/Dropbox, Google Drive, S3/);
  });
});

describe("report always carries the disclaimer", () => {
  const md = renderReportMarkdown(base());

  it("says it is not a warranty", () => {
    expect(md).toMatch(/not\*\* a warranty/);
  });

  it("says BetterOSF deleted nothing", () => {
    expect(md).toMatch(/did \*\*not\*\* delete/);
  });

  it("includes the metadata fidelity table", () => {
    expect(md).toContain("## Metadata fidelity");
    expect(md).toContain("Matched exactly.");
  });

  it("escapes a pipe in a fidelity note so the table cannot be broken", () => {
    const md2 = renderReportMarkdown(
      base({ fidelity: [{ field: "x", source: "y", status: "exact", note: "a | b" }] }),
    );
    expect(md2).toContain("a \\| b");
  });
});

describe("crosswalk CSV", () => {
  it("maps each OSF path to its destination key", () => {
    const csv = renderCrosswalkCsv(base());
    const [header, row] = csv.trim().split("\n");
    expect(header).toContain("osf_path");
    expect(header).toContain("destination_key");
    expect(row).toContain("a.csv");
    expect(row).toContain("https://zenodo.org/records/1");
  });

  it("records the verification state per row", () => {
    expect(renderCrosswalkCsv(base())).toContain("verified");
  });

  it("says 'local export' when there is no destination repository", () => {
    expect(renderCrosswalkCsv(base({ destination: null }))).toContain("local export");
  });

  it("has a header row even when there are no files", () => {
    const csv = renderCrosswalkCsv(base({ files: [] }));
    expect(csv.trim().split("\n")).toHaveLength(1);
    expect(csv).toContain("osf_project_guid");
  });
});

describe("csvCell", () => {
  it("quotes a value containing a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("doubles internal quotes, per RFC 4180", () => {
    // Without this, a filename containing a quote shifts every later column — silently
    // corrupting the very file someone is using to repair their citations.
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("leaves a plain value unquoted", () => {
    expect(csvCell("plain")).toBe("plain");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("renders 0 as 0, not as empty", () => {
    // A zero-byte file must not read as a missing size.
    expect(csvCell(0)).toBe("0");
  });
});
