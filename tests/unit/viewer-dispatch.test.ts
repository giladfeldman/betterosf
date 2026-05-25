import { describe, it, expect } from "vitest";
import { viewerForFilename, exceedsSizeCap, sizeCapMB, type ViewerId } from "@/lib/viewers/dispatch";

describe("viewerForFilename", () => {
  const cases: Array<[string, ViewerId]> = [
    // Documents
    ["doc.pdf", "pdf"],
    ["report.docx", "docx"],
    ["data.xlsx", "xlsx"],
    ["legacy.xls", "xlsx"],
    ["data.csv", "csv"],
    ["data.tsv", "csv"],
    // Text + markup
    ["README.md", "markdown"],
    ["NOTES.markdown", "markdown"],
    ["a.txt", "code"],
    ["server.log", "code"],
    ["pkg.json", "json"],
    // Code
    ["file.js", "code"],
    ["file.ts", "code"],
    ["file.tsx", "code"],
    ["file.jsx", "code"],
    ["m.mjs", "code"],
    ["c.cjs", "code"],
    ["script.py", "code"],
    ["analysis.R", "code"], // case-insensitive
    ["doc.Rmd", "code"],
    ["stata.do", "code"],
    ["a.c", "code"],
    ["a.cpp", "code"],
    ["a.h", "code"],
    ["a.hpp", "code"],
    ["main.rs", "code"],
    ["main.go", "code"],
    ["A.java", "code"],
    ["A.kt", "code"],
    ["A.swift", "code"],
    ["a.rb", "code"],
    ["a.php", "code"],
    ["a.sh", "code"],
    ["a.bash", "code"],
    ["a.zsh", "code"],
    ["q.sql", "code"],
    ["a.yaml", "code"],
    ["a.yml", "code"],
    ["a.toml", "code"],
    ["a.xml", "code"],
    // Web
    ["index.html", "html"],
    ["page.htm", "html"],
    // Images
    ["pic.png", "image"],
    ["pic.JPG", "image"],
    ["pic.jpeg", "image"],
    ["pic.gif", "image"],
    ["pic.webp", "image"],
    ["pic.bmp", "image"],
    ["fav.ico", "image"],
    ["vec.svg", "svg"],
    // Media
    ["clip.mp4", "video"],
    ["clip.mov", "video"],
    ["clip.webm", "video"],
    ["clip.mkv", "video"],
    ["sound.mp3", "audio"],
    ["sound.wav", "audio"],
    ["sound.ogg", "audio"],
    ["sound.flac", "audio"],
    ["sound.m4a", "audio"],
    // Special
    ["analysis.ipynb", "notebook"],
    // Unknown fallback
    ["weirdfile.qqzz", "unknown"],
    ["no_extension", "unknown"],
    ["", "unknown"],
  ];
  for (const [name, expected] of cases) {
    it(`maps ${JSON.stringify(name)} → ${expected}`, () => {
      expect(viewerForFilename(name)).toBe(expected);
    });
  }

  it("handles multi-dot filenames using the last extension", () => {
    expect(viewerForFilename("data.tar.gz")).toBe("unknown");
    expect(viewerForFilename("backup.csv.bak")).toBe("unknown");
    expect(viewerForFilename("notes.draft.md")).toBe("markdown");
  });
});

describe("sizeCapMB", () => {
  it("returns documented caps for capped viewers", () => {
    expect(sizeCapMB("pdf")).toBe(50);
    expect(sizeCapMB("docx")).toBe(25);
    expect(sizeCapMB("xlsx")).toBe(15);
    expect(sizeCapMB("csv")).toBe(100);
    expect(sizeCapMB("json")).toBe(10);
    expect(sizeCapMB("image")).toBe(25);
    expect(sizeCapMB("svg")).toBe(5);
    expect(sizeCapMB("notebook")).toBe(20);
  });
  it("returns null for viewers with no cap", () => {
    for (const v of ["markdown", "code", "html", "video", "audio", "unknown"] as ViewerId[]) {
      expect(sizeCapMB(v)).toBeNull();
    }
  });
});

describe("exceedsSizeCap", () => {
  const MB = 1024 * 1024;

  it("returns false when bytes is null (size unknown)", () => {
    for (const v of ["pdf", "docx", "xlsx", "csv", "json", "image", "svg", "notebook", "unknown"] as ViewerId[]) {
      expect(exceedsSizeCap(v, null)).toBe(false);
    }
  });

  it("returns false for viewers with no cap, even for huge files", () => {
    for (const v of ["markdown", "code", "html", "video", "audio", "unknown"] as ViewerId[]) {
      expect(exceedsSizeCap(v, 999 * MB)).toBe(false);
    }
  });

  it("each format-specific cap is enforced correctly", () => {
    const cases: Array<[ViewerId, number]> = [
      ["pdf", 50], ["docx", 25], ["xlsx", 15], ["csv", 100],
      ["json", 10], ["image", 25], ["svg", 5], ["notebook", 20],
    ];
    for (const [v, capMB] of cases) {
      expect(exceedsSizeCap(v, capMB * MB)).toBe(false); // exactly at cap
      expect(exceedsSizeCap(v, capMB * MB + 1)).toBe(true); // just over
      expect(exceedsSizeCap(v, 0)).toBe(false); // zero bytes
    }
  });
});
