import { describe, it, expect } from "vitest";
import { csvCell, renderCrosswalkCsv, type ReportInput } from "@/lib/transition/report";

// d-33dc2f: OWASP CSV injection. A cell a spreadsheet would read as a formula must be
// prefixed with a single quote. OSF file names, project titles and destination names are
// user-controlled, so a file called `=HYPERLINK("http://evil","x").csv` must not become a
// live formula when the crosswalk CSV is opened in Excel / LibreOffice / Sheets.

function unquote(cell: string): string {
  return cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

describe("csvCell neutralises spreadsheet formulas", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    it(`prefixes a string starting with ${JSON.stringify(lead)}`, () => {
      expect(unquote(csvCell(`${lead}1+1`))).toBe(`'${lead}1+1`);
    });
  }

  it("neutralises a formula that also needs RFC 4180 quoting", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });

  it("leaves ordinary strings and mid-string triggers alone", () => {
    expect(csvCell("data/a=b.csv")).toBe("data/a=b.csv");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("")).toBe("");
    expect(csvCell(null)).toBe("");
  });

  it("leaves typed numbers alone, including negatives", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(42)).toBe("42");
  });
});

describe("renderCrosswalkCsv neutralises user-controlled names", () => {
  it("writes no cell that a spreadsheet would execute", () => {
    const input = {
      projectGuid: "abc12",
      osfUrl: "https://osf.io/abc12/",
      osfDoi: "-doi",
      files: [
        {
          path: 'osfstorage/=HYPERLINK("http://evil","x").csv',
          osfPath: "@SUM(1+1)",
          sourceGuid: "+guid",
          size: 10,
          sha256: "=sha",
          state: "verified",
          destinationKey: "\tkey",
        },
      ],
      destination: { name: "+evil", recordUrl: "-1+1", doi: "@doi" },
    } as unknown as ReportInput;
    const csv = renderCrosswalkCsv(input);
    const rows = csv.trimEnd().split("\n").slice(1);
    expect(rows.length).toBe(1);
    const cells = rows[0]!.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)!
      .map((c) => c.replace(/,$/, ""))
      .filter((_, i, a) => i < a.length - 1 || a[i] !== "");
    expect(cells.length).toBeGreaterThanOrEqual(14);
    for (const c of cells) {
      expect(unquote(c), `cell ${c}`).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'+evil");
  });
});
