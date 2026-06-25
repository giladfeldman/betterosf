import { describe, it, expect } from "vitest";
import { sanitizeSort } from "@/lib/osf/sort";

describe("sanitizeSort", () => {
  it("passes allowlisted ascending fields through", () => {
    expect(sanitizeSort("date_modified")).toBe("date_modified");
    expect(sanitizeSort("title")).toBe("title");
  });

  it("passes allowlisted descending (-prefixed) fields through", () => {
    expect(sanitizeSort("-date_modified")).toBe("-date_modified");
  });

  it("drops unknown / crafted sort values", () => {
    expect(sanitizeSort("evil_field")).toBeUndefined();
    expect(sanitizeSort("title; DROP TABLE")).toBeUndefined();
    expect(sanitizeSort("-not_a_field")).toBeUndefined();
  });

  it("returns undefined for empty / nullish input", () => {
    expect(sanitizeSort(undefined)).toBeUndefined();
    expect(sanitizeSort(null)).toBeUndefined();
    expect(sanitizeSort("")).toBeUndefined();
  });
});
