import { describe, it, expect } from "vitest";
import { encodePathSegments } from "@/lib/url";

describe("encodePathSegments", () => {
  it("percent-encodes each segment and joins with /", () => {
    expect(encodePathSegments(["PCIRR Stage 1", "Materials"])).toBe("PCIRR%20Stage%201/Materials");
  });

  it("round-trips through decodeURIComponent for breadcrumb hrefs", () => {
    const segments = ["a b", "c&d", "e#f", "g+h"];
    const encoded = encodePathSegments(segments);
    expect(encoded.split("/").map(decodeURIComponent)).toEqual(segments);
  });

  it("does not collapse or drop empty input", () => {
    expect(encodePathSegments([])).toBe("");
    expect(encodePathSegments(["only"])).toBe("only");
  });

  it("encodes characters that would otherwise break a URL path", () => {
    // '/' inside a segment must be encoded so it isn't read as a separator.
    expect(encodePathSegments(["a/b"])).toBe("a%2Fb");
    expect(encodePathSegments(["100% done"])).toBe("100%25%20done");
  });
});
