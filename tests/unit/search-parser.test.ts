import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/search/parser";

describe("parseQuery", () => {
  it("parses a single word", () => {
    expect(parseQuery("replication")).toEqual({ type: "term", value: "replication" });
  });

  it("treats space-separated tokens as implicit AND", () => {
    expect(parseQuery("replication psychology")).toEqual({
      type: "and",
      children: [
        { type: "term", value: "replication" },
        { type: "term", value: "psychology" },
      ],
    });
  });

  it("respects explicit OR (uppercase only)", () => {
    expect(parseQuery("replication OR meta-analysis")).toEqual({
      type: "or",
      children: [
        { type: "term", value: "replication" },
        { type: "term", value: "meta-analysis" },
      ],
    });
  });

  it("treats lowercase 'or' as a literal token", () => {
    expect(parseQuery("apples or oranges")).toEqual({
      type: "and",
      children: [
        { type: "term", value: "apples" },
        { type: "term", value: "or" },
        { type: "term", value: "oranges" },
      ],
    });
  });

  it("parses quoted phrases verbatim", () => {
    expect(parseQuery('"social priming"')).toEqual({ type: "term", value: "social priming", phrase: true });
  });

  it("handles NOT with -prefix", () => {
    expect(parseQuery("replication -fraud")).toEqual({
      type: "and",
      children: [
        { type: "term", value: "replication" },
        { type: "not", child: { type: "term", value: "fraud" } },
      ],
    });
  });

  it("respects parens for grouping", () => {
    expect(parseQuery("(replication OR meta-analysis) AND psychology")).toEqual({
      type: "and",
      children: [
        { type: "or", children: [
          { type: "term", value: "replication" },
          { type: "term", value: "meta-analysis" },
        ] },
        { type: "term", value: "psychology" },
      ],
    });
  });

  it("explicit AND token is recognized when uppercase", () => {
    expect(parseQuery("a AND b")).toEqual({
      type: "and",
      children: [
        { type: "term", value: "a" },
        { type: "term", value: "b" },
      ],
    });
  });

  it("empty string is an empty AND", () => {
    expect(parseQuery("")).toEqual({ type: "and", children: [] });
  });

  it("whitespace only is an empty AND", () => {
    expect(parseQuery("   ")).toEqual({ type: "and", children: [] });
  });

  it("unmatched paren falls back to literal", () => {
    // Don't throw — treat as best-effort
    const ast = parseQuery("foo (bar");
    expect(ast).toBeTruthy();
  });

  it("quoted phrase with internal spaces and operators", () => {
    expect(parseQuery('"a AND b OR c"')).toEqual({ type: "term", value: "a AND b OR c", phrase: true });
  });
});
