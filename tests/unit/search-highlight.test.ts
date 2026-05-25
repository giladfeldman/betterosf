import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/search/parser";
import { collectPositiveTerms, highlightSegments, snippetAroundMatch } from "@/lib/search/highlight";

describe("collectPositiveTerms", () => {
  it("returns a single term from a single-word query", () => {
    expect(collectPositiveTerms(parseQuery("replication"))).toEqual(["replication"]);
  });

  it("extracts every positive term from an AND", () => {
    expect(collectPositiveTerms(parseQuery("replication psychology"))).toEqual([
      "replication",
      "psychology",
    ]);
  });

  it("walks into OR branches", () => {
    expect(collectPositiveTerms(parseQuery("a OR b OR c"))).toEqual(["a", "b", "c"]);
  });

  it("skips NOT-children entirely", () => {
    expect(collectPositiveTerms(parseQuery("replication -fraud"))).toEqual(["replication"]);
    expect(collectPositiveTerms(parseQuery("-bias"))).toEqual([]);
  });

  it("dedupes case-insensitively, preserving first-seen casing", () => {
    expect(collectPositiveTerms(parseQuery("Apple apple APPLE"))).toEqual(["Apple"]);
  });

  it("preserves quoted phrases as a single multi-word term", () => {
    expect(collectPositiveTerms(parseQuery('"social priming" effect'))).toEqual([
      "social priming",
      "effect",
    ]);
  });

  it("empty query → empty list", () => {
    expect(collectPositiveTerms(parseQuery(""))).toEqual([]);
    expect(collectPositiveTerms(parseQuery("   "))).toEqual([]);
  });

  it("nested AND/OR with NOTs — only positives surface", () => {
    expect(
      collectPositiveTerms(parseQuery("(replication OR meta-analysis) AND psychology -fraud"))
    ).toEqual(["replication", "meta-analysis", "psychology"]);
  });
});

describe("highlightSegments", () => {
  it("empty text returns a single empty unmarked segment", () => {
    expect(highlightSegments("", ["a"])).toEqual([{ text: "", match: false }]);
  });

  it("no terms returns the text as a single unmarked segment", () => {
    expect(highlightSegments("hello world", [])).toEqual([{ text: "hello world", match: false }]);
  });

  it("single match in middle splits into three segments", () => {
    const segs = highlightSegments("hello world today", ["world"]);
    expect(segs).toEqual([
      { text: "hello ", match: false },
      { text: "world", match: true },
      { text: " today", match: false },
    ]);
  });

  it("case-insensitive matching preserves original case in the segment", () => {
    const segs = highlightSegments("Hello WORLD", ["world"]);
    expect(segs).toEqual([
      { text: "Hello ", match: false },
      { text: "WORLD", match: true },
    ]);
  });

  it("with overlapping terms, the longer term wins (longest-first sort)", () => {
    // 'social priming' is 14 chars, 'social' is 6. The longer should match the whole phrase
    // rather than letting 'social' shadow it.
    const segs = highlightSegments("Studies of social priming effects", ["social", "social priming"]);
    const matched = segs.find((s) => s.match)!;
    expect(matched.text).toBe("social priming");
  });

  it("multiple non-overlapping matches each become their own segment", () => {
    const segs = highlightSegments("alpha beta alpha", ["alpha"]);
    const matches = segs.filter((s) => s.match);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.text === "alpha")).toBe(true);
  });

  it("matches at the very start and very end", () => {
    const segs = highlightSegments("alpha middle alpha", ["alpha"]);
    expect(segs[0]).toEqual({ text: "alpha", match: true });
    expect(segs[segs.length - 1]).toEqual({ text: "alpha", match: true });
  });

  it("regex-special characters in term are escaped (no crash)", () => {
    const segs = highlightSegments("see [a.b] for details", ["[a.b]"]);
    const matched = segs.find((s) => s.match)!;
    expect(matched.text).toBe("[a.b]");
  });
});

describe("snippetAroundMatch", () => {
  it("empty text → empty string", () => {
    expect(snippetAroundMatch("", ["a"])).toBe("");
  });

  it("no terms + short text → original text", () => {
    expect(snippetAroundMatch("short text", [])).toBe("short text");
  });

  it("no terms + long text → first N chars + ellipsis", () => {
    const long = "x".repeat(500);
    const out = snippetAroundMatch(long, [], 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(51);
  });

  it("matching term in long text yields a window around the match", () => {
    const text = "PREFIX ".repeat(50) + "FOUND_HERE " + "SUFFIX ".repeat(50);
    const out = snippetAroundMatch(text, ["FOUND_HERE"], 60);
    expect(out).toContain("FOUND_HERE");
    // Both ellipses present when match is interior
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("match near the start of the text → no leading ellipsis", () => {
    const text = "FOUND " + "x".repeat(500);
    const out = snippetAroundMatch(text, ["FOUND"], 60);
    expect(out.startsWith("FOUND")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("match near the end of the text → no trailing ellipsis", () => {
    const text = "x".repeat(500) + " FOUND";
    const out = snippetAroundMatch(text, ["FOUND"], 60);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("FOUND")).toBe(true);
  });

  it("text shorter than window with no match → return as-is", () => {
    expect(snippetAroundMatch("short text", ["zzz"], 200)).toBe("short text");
  });

  it("longest term is preferred when scanning for the match start", () => {
    const text = "lorem ipsum social priming dolor sit amet ".repeat(20);
    const out = snippetAroundMatch(text, ["social", "social priming"], 80);
    expect(out).toContain("social priming");
  });
});
