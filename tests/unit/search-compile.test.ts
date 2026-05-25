import { describe, it, expect } from "vitest";
import { compileQuery } from "@/lib/search/compile";
import { parseQuery } from "@/lib/search/parser";

describe("compileQuery", () => {
  it("single term → one request with one filter", () => {
    const plan = compileQuery(parseQuery("replication"), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([["title", "replication"]]);
    expect(plan.combine).toBe("intersect");
    expect(plan.exclusions).toEqual([]);
  });

  it("implicit AND → one request with multiple title filters", () => {
    const plan = compileQuery(parseQuery("replication psychology"), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([["title", "replication"], ["title", "psychology"]]);
  });

  it("explicit OR → two requests", () => {
    const plan = compileQuery(parseQuery("replication OR meta-analysis"), "title");
    expect(plan.requests).toHaveLength(2);
    expect(plan.combine).toBe("union");
    expect(plan.requests[0]?.filters).toEqual([["title", "replication"]]);
    expect(plan.requests[1]?.filters).toEqual([["title", "meta-analysis"]]);
  });

  it("NOT term → exclusion list, primary request keeps AND'd remainder", () => {
    const plan = compileQuery(parseQuery("replication -fraud"), "title");
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]?.filters).toEqual([["title", "replication"]]);
    expect(plan.exclusions).toEqual(["fraud"]);
  });

  it("quoted phrase passes through verbatim", () => {
    const plan = compileQuery(parseQuery('"social priming"'), "title");
    expect(plan.requests[0]?.filters).toEqual([["title", "social priming"]]);
  });

  it("(A OR B) AND C → two requests, both with C", () => {
    const plan = compileQuery(parseQuery("(replication OR meta-analysis) AND psychology"), "title");
    expect(plan.requests).toHaveLength(2);
    expect(plan.requests[0]?.filters).toContainEqual(["title", "replication"]);
    expect(plan.requests[0]?.filters).toContainEqual(["title", "psychology"]);
    expect(plan.requests[1]?.filters).toContainEqual(["title", "meta-analysis"]);
    expect(plan.requests[1]?.filters).toContainEqual(["title", "psychology"]);
    expect(plan.combine).toBe("union");
  });
});
