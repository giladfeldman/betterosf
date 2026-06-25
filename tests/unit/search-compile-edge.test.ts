import { describe, it, expect } from "vitest";
import { compileQuery, MAX_QUERY_BRANCHES } from "@/lib/search/compile";
import { parseQuery } from "@/lib/search/parser";

describe("compileQuery edge cases", () => {
  it("NOT-only query yields a single empty-filter request and the exclusion list", () => {
    const plan = compileQuery(parseQuery("-fraud"), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([]);
    expect(plan.exclusions).toEqual(["fraud"]);
    expect(plan.combine).toBe("intersect");
  });

  it("multiple NOTs collected into exclusions, no positive filters", () => {
    const plan = compileQuery(parseQuery("-fraud -bias"), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([]);
    expect(plan.exclusions.sort()).toEqual(["bias", "fraud"]);
  });

  it("pure-OR with N branches yields N requests under union", () => {
    const plan = compileQuery(parseQuery("a OR b OR c OR d"), "title");
    expect(plan.requests).toHaveLength(4);
    expect(plan.combine).toBe("union");
    const filters = plan.requests.flatMap((r) => r.filters);
    expect(filters).toEqual([
      ["title", "a"],
      ["title", "b"],
      ["title", "c"],
      ["title", "d"],
    ]);
  });

  it("deeply-nested AND/OR distributes correctly", () => {
    // (a OR b) AND (c OR d) → 4 branches: a+c, a+d, b+c, b+d
    const plan = compileQuery(parseQuery("(a OR b) AND (c OR d)"), "title");
    expect(plan.requests).toHaveLength(4);
    expect(plan.combine).toBe("union");
    const branchSignatures = plan.requests
      .map((r) => r.filters.map((f) => f[1]).sort().join("+"))
      .sort();
    expect(branchSignatures).toEqual(["a+c", "a+d", "b+c", "b+d"]);
  });

  it("triple-nested distribution: (a OR b) AND (c OR d) AND e → 4 branches each with e", () => {
    const plan = compileQuery(parseQuery("(a OR b) AND (c OR d) AND e"), "title");
    expect(plan.requests).toHaveLength(4);
    for (const r of plan.requests) {
      const values = r.filters.map((f) => f[1]);
      expect(values).toContain("e");
      expect(values.length).toBe(3);
    }
  });

  it("OR with a NOT branch — NOT is harvested into exclusions, positive remains", () => {
    // a OR -b → request[a], exclusions=[b]
    const plan = compileQuery(parseQuery("a OR -b"), "title");
    expect(plan.exclusions).toContain("b");
    // The positive 'a' branch survives.
    const hasA = plan.requests.some((r) => r.filters.some((f) => f[1] === "a"));
    expect(hasA).toBe(true);
  });

  it("phrase term carries through compile as a single filter value", () => {
    const plan = compileQuery(parseQuery('"social priming" effect'), "title");
    expect(plan.requests).toHaveLength(1);
    const values = plan.requests[0]!.filters.map((f) => f[1]).sort();
    expect(values).toEqual(["effect", "social priming"]);
  });

  it("empty query → one empty request, no exclusions", () => {
    const plan = compileQuery(parseQuery(""), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([]);
    expect(plan.exclusions).toEqual([]);
  });

  it("caps the OR-in-AND cross-product at MAX_QUERY_BRANCHES (no 2^k blowup)", () => {
    // (a OR b) AND (c OR d) AND (e OR f) AND (g OR h) = 2^4 = 16 branches unbounded.
    const plan = compileQuery(parseQuery("(a OR b) AND (c OR d) AND (e OR f) AND (g OR h)"), "title");
    expect(plan.requests.length).toBeLessThanOrEqual(MAX_QUERY_BRANCHES);
  });

  it("caps a wide flat OR at MAX_QUERY_BRANCHES", () => {
    const plan = compileQuery(parseQuery("a OR b OR c OR d OR e OR f OR g OR h"), "title");
    expect(plan.requests.length).toBeLessThanOrEqual(MAX_QUERY_BRANCHES);
  });
});
