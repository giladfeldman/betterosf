import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/search/parser";

/**
 * Edge-case coverage for the search parser.
 *
 * Regressions guarded:
 * - Hyphenated words like "meta-analysis" must NOT be split into NOT-children
 *   when the hyphen is in the middle of a word.
 * - Search operators are case-insensitive, matching what users naturally type
 *   in quick filters such as "MP4 or MP3".
 * - Nested parens 3+ levels deep parse correctly.
 */
describe("parseQuery edge cases", () => {
  it("hyphenated mid-word is NOT a NOT-prefix", () => {
    const ast = parseQuery("meta-analysis");
    expect(ast).toEqual({ type: "term", value: "meta-analysis" });
  });

  it("hyphenated mid-word inside an AND still keeps the hyphen", () => {
    const ast = parseQuery("psychology meta-analysis");
    expect(ast).toEqual({
      type: "and",
      children: [
        { type: "term", value: "psychology" },
        { type: "term", value: "meta-analysis" },
      ],
    });
  });

  it("only a hyphen at start-of-token (after whitespace/paren) is NOT", () => {
    // The 2nd `-` is mid-word, so the inner becomes 'wonky-thing'
    const ast = parseQuery("-fraud wonky-thing");
    expect(ast).toEqual({
      type: "and",
      children: [
        { type: "not", child: { type: "term", value: "fraud" } },
        { type: "term", value: "wonky-thing" },
      ],
    });
  });

  it("mixed-case 'Or' is an OR operator", () => {
    const ast = parseQuery("apples Or oranges");
    expect(ast).toEqual({
      type: "or",
      children: [
        { type: "term", value: "apples" },
        { type: "term", value: "oranges" },
      ],
    });
  });

  it("'oR' lowercased+uppercased mix is an OR operator", () => {
    const ast = parseQuery("a oR b");
    expect(ast).toEqual({
      type: "or",
      children: [
        { type: "term", value: "a" },
        { type: "term", value: "b" },
      ],
    });
  });

  it("'and' lowercased is an AND operator", () => {
    const ast = parseQuery("apples and oranges");
    expect(ast).toEqual({
      type: "and",
      children: [
        { type: "term", value: "apples" },
        { type: "term", value: "oranges" },
      ],
    });
  });

  it("nested parens 3 levels deep parse correctly", () => {
    // ((a OR (b AND c)) AND d) — exercises the recursive expr-in-factor
    const ast = parseQuery("((a OR (b AND c)) AND d)");
    expect(ast).toEqual({
      type: "and",
      children: [
        {
          type: "or",
          children: [
            { type: "term", value: "a" },
            {
              type: "and",
              children: [
                { type: "term", value: "b" },
                { type: "term", value: "c" },
              ],
            },
          ],
        },
        { type: "term", value: "d" },
      ],
    });
  });

  it("nested parens 4 levels deep with mixed operators", () => {
    const ast = parseQuery("(((a OR b) AND c) OR d) AND e");
    // Walk shape rather than full deep-equal — the key property is that we don't crash
    // and that every leaf term shows up in the AST.
    function leaves(n: ReturnType<typeof parseQuery>): string[] {
      if (n.type === "term") return [n.value];
      if (n.type === "not") return leaves(n.child);
      return n.children.flatMap(leaves);
    }
    expect(leaves(ast).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});
