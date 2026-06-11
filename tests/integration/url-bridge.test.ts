import { describe, it, expect } from "vitest";
import { bookmarkletTarget, canonicalGuidPath, type BookmarkletLocation } from "@/lib/osf/url-bridge";

function loc(hostname: string, pathname: string, search = "", hash = ""): BookmarkletLocation {
  return { hostname, pathname, search, hash };
}

describe("bookmarkletTarget", () => {
  it("BetterOSF project with UPPERCASE guid -> OSF lowercased brief (the reported bug)", () => {
    expect(bookmarkletTarget(loc("betterosf.vercel.app", "/3KMR9"))).toBe("https://osf.io/3kmr9");
  });

  it("OSF /overview -> BetterOSF brief (strips the OSF redirect suffix)", () => {
    expect(bookmarkletTarget(loc("osf.io", "/3kmr9/overview"))).toBe("https://betterosf.vercel.app/3kmr9");
  });

  it("OSF bare guid -> BetterOSF brief", () => {
    expect(bookmarkletTarget(loc("osf.io", "/3kmr9"))).toBe("https://betterosf.vercel.app/3kmr9");
  });

  it("non-files OSF section (e.g. /wiki) collapses to the brief BetterOSF URL", () => {
    expect(bookmarkletTarget(loc("osf.io", "/3kmr9/wiki/home"))).toBe("https://betterosf.vercel.app/3kmr9");
  });

  it("preserves /files sub-path + query + hash and lowercases only the guid", () => {
    expect(
      bookmarkletTarget(loc("betterosf.vercel.app", "/3KMR9/files/osfstorage/PCIRR%20Stage%201", "?x=1", "#h"))
    ).toBe("https://osf.io/3kmr9/files/osfstorage/PCIRR%20Stage%201?x=1#h");
  });

  it("OSF preprint URL (guid LAST, after a provider) -> BetterOSF brief", () => {
    expect(bookmarkletTarget(loc("osf.io", "/preprints/psyarxiv/abc12"))).toBe("https://betterosf.vercel.app/abc12");
  });

  it("BetterOSF /registrations/<guid> -> OSF flat guid", () => {
    expect(bookmarkletTarget(loc("betterosf.vercel.app", "/registrations/ujyh9"))).toBe("https://osf.io/ujyh9");
  });

  it("home page just swaps host", () => {
    expect(bookmarkletTarget(loc("osf.io", "/"))).toBe("https://betterosf.vercel.app/");
  });

  it("unsupported host -> null", () => {
    expect(bookmarkletTarget(loc("example.com", "/3kmr9"))).toBeNull();
  });

  it("the .toString() form (embedded in the shipped bookmarklet) is self-contained and equivalent", () => {
    // This is exactly how the bookmarklet runs the function in the browser.
    const rebuilt = new Function("loc", "return (" + bookmarkletTarget.toString() + ")(loc);") as (
      l: BookmarkletLocation
    ) => string | null;
    const cases = [
      loc("betterosf.vercel.app", "/3KMR9"),
      loc("osf.io", "/3kmr9/overview"),
      loc("osf.io", "/preprints/psyarxiv/abc12"),
      loc("betterosf.vercel.app", "/3KMR9/files/osfstorage/A%20B", "?q=1", "#x"),
      loc("example.com", "/x"),
    ];
    for (const c of cases) expect(rebuilt(c)).toBe(bookmarkletTarget(c));
  });
});

describe("canonicalGuidPath", () => {
  it("lowercases an uppercase guid", () => {
    expect(canonicalGuidPath("/3KMR9")).toBe("/3kmr9");
  });

  it("strips /overview to the brief URL", () => {
    expect(canonicalGuidPath("/3kmr9/overview")).toBe("/3kmr9");
  });

  it("lowercases the guid and strips /overview together", () => {
    expect(canonicalGuidPath("/3KMR9/overview")).toBe("/3kmr9");
  });

  it("leaves an already-canonical project URL unchanged (null)", () => {
    expect(canonicalGuidPath("/3kmr9")).toBeNull();
  });

  it("lowercases the guid but preserves case-sensitive file path segments", () => {
    expect(canonicalGuidPath("/3KMR9/files/osfstorage/MyFile.PDF")).toBe("/3kmr9/files/osfstorage/MyFile.PDF");
  });

  it("does not redirect a canonical file path", () => {
    expect(canonicalGuidPath("/3kmr9/files/osfstorage/MyFile.PDF")).toBeNull();
  });

  it("ignores real static routes", () => {
    expect(canonicalGuidPath("/about")).toBeNull();
    expect(canonicalGuidPath("/search")).toBeNull();
    expect(canonicalGuidPath("/registrations/ujyh9")).toBeNull();
    expect(canonicalGuidPath("/bookmarklet")).toBeNull();
  });

  it("ignores the root and non-guid-shaped first segments", () => {
    expect(canonicalGuidPath("/")).toBeNull();
    expect(canonicalGuidPath("/thisislongerthanaguid")).toBeNull();
  });
});
