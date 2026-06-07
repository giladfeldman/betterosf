import { describe, it, expect } from "vitest";
import { isValidGuid, parseOsfUrl } from "@/lib/osf/guid";

describe("isValidGuid", () => {
  it("accepts a typical 5-char alphanumeric", () => {
    expect(isValidGuid("ezcuj")).toBe(true);
    expect(isValidGuid("4znzp")).toBe(true);
    expect(isValidGuid("XY7AB")).toBe(true);
  });
  it("accepts up to 8 chars (OSF has used wider guids)", () => {
    expect(isValidGuid("abc12")).toBe(true);
    expect(isValidGuid("abcdef12")).toBe(true);
  });
  it("rejects empty, special chars, too long", () => {
    expect(isValidGuid("")).toBe(false);
    expect(isValidGuid("abc!")).toBe(false);
    expect(isValidGuid("abcdefghij")).toBe(false);
    expect(isValidGuid("abc/def")).toBe(false);
  });
});

describe("parseOsfUrl", () => {
  it("extracts guid from osf.io URL", () => {
    expect(parseOsfUrl("https://osf.io/ezcuj/")).toBe("ezcuj");
    expect(parseOsfUrl("https://osf.io/ezcuj")).toBe("ezcuj");
    expect(parseOsfUrl("http://osf.io/4znzp/files/")).toBe("4znzp");
  });
  it("returns the input if it is already a bare guid", () => {
    expect(parseOsfUrl("ezcuj")).toBe("ezcuj");
  });
  it("returns null for invalid input", () => {
    expect(parseOsfUrl("https://example.com/foo")).toBe(null);
    expect(parseOsfUrl("not a url")).toBe(null);
  });
  it("extracts the registration guid from a canonical bare URL", () => {
    expect(parseOsfUrl("https://osf.io/p9qb4/")).toBe("p9qb4");
  });
  it("extracts the preprint guid from a provider-prefixed URL", () => {
    expect(parseOsfUrl("https://osf.io/preprints/psyarxiv/g7w6u/")).toBe("g7w6u");
    expect(parseOsfUrl("https://osf.io/preprints/g7w6u")).toBe("g7w6u");
  });
  it("extracts the guid from deep file/wiki URLs", () => {
    expect(parseOsfUrl("https://osf.io/ezcuj/files/osfstorage/data.csv")).toBe("ezcuj");
    expect(parseOsfUrl("https://osf.io/ezcuj/wiki/home/")).toBe("ezcuj");
  });
  it("accepts protocol-less and subdomain osf.io URLs", () => {
    expect(parseOsfUrl("osf.io/ezcuj")).toBe("ezcuj");
    expect(parseOsfUrl("www.osf.io/ezcuj/")).toBe("ezcuj");
  });
  it("skips known section prefixes that look guid-shaped", () => {
    expect(parseOsfUrl("https://osf.io/registries/abc12")).toBe("abc12");
  });
});
