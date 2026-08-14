/**
 * The URL the BROWSER downloads research bytes from.
 *
 * THE DEFECT, reported 2026-08-14: an export of a 79-file project failed on all 79 with
 * "NetworkError when attempting to fetch resource". The export was fetching OSF's
 * `links.download` — `https://osf.io/download/<id>/` — which sends **no CORS headers at
 * all**, so a browser `fetch` carrying `Authorization` never even leaves the tab.
 *
 * It went unnoticed because every other consumer of that URL is SERVER-side (the ZIP
 * route, the download proxy), where CORS does not exist, and because the toolkit's own
 * CORS matrix was verified with a server-side client — which cannot observe CORS either.
 * Node's `fetch` ignores it entirely.
 *
 * Measured on 2026-08-14 against the real hosts, all four:
 *   - `osf.io/download/<id>/`            → preflight 200, `ACAO: null`  → blocked
 *   - `files.osf.io/v1/resources/...`    → preflight 204, `ACAO: <origin>`, allows Range +
 *                                          Authorization … but GET 302s to
 *                                          `storage.googleapis.com`, which sends NO CORS
 *                                          headers, so following the redirect fails too
 *   - `files.osf.io/...?direct=`         → 200, `ACAO: <origin>`, bytes streamed directly
 *   - a ranged `?direct=` request returns the CORRECT bytes but status 200 and no
 *     `Content-Range`
 */
import { describe, it, expect } from "vitest";
import { waterbutlerDownloadUrl, WATERBUTLER_BASE } from "@/lib/osf/waterbutler-url";
import { checkRangeResponse } from "@/lib/transition/range";

describe("waterbutlerDownloadUrl", () => {
  it("builds the form a browser can actually fetch", () => {
    const url = waterbutlerDownloadUrl({
      guid: "gf8rc",
      provider: "osfstorage",
      path: "/659f816ef2240f03a732e177",
    });
    expect(url).toBe(
      "https://files.osf.io/v1/resources/gf8rc/providers/osfstorage/659f816ef2240f03a732e177?direct=",
    );
  });

  it("always carries ?direct=, which is the whole point", () => {
    // Without it Waterbutler 302s to a storage bucket with no CORS headers, and the
    // browser blocks the redirect — the failure looks identical to the original bug.
    const url = waterbutlerDownloadUrl({ guid: "abc12", provider: "osfstorage", path: "/x" });
    expect(url).toMatch(/\?direct=$/);
  });

  it("never points anywhere but OSF's Waterbutler host", () => {
    const url = waterbutlerDownloadUrl({ guid: "abc12", provider: "osfstorage", path: "/x" });
    expect(url.startsWith(WATERBUTLER_BASE)).toBe(true);
    expect(new URL(url).hostname).toBe("files.osf.io");
  });

  it("is never osf.io/download, the host that cannot be fetched from a browser", () => {
    const url = waterbutlerDownloadUrl({ guid: "abc12", provider: "osfstorage", path: "/x" });
    expect(url).not.toContain("osf.io/download");
    expect(new URL(url).hostname).not.toBe("osf.io");
  });

  it("carries the provider, so add-on storage is not silently treated as osfstorage", () => {
    const url = waterbutlerDownloadUrl({ guid: "abc12", provider: "dropbox", path: "/a/b.txt" });
    expect(url).toContain("/providers/dropbox/");
  });

  it("encodes each path segment but keeps the separators", () => {
    const url = waterbutlerDownloadUrl({ guid: "abc12", provider: "osfstorage", path: "/sub dir/a b.csv" });
    expect(url).toContain("/sub%20dir/a%20b.csv");
  });

  it("refuses rather than building a URL from missing pieces", () => {
    // The alternative is a plausible-looking URL that 404s at run time, on every file.
    expect(() => waterbutlerDownloadUrl({ guid: "abc12", provider: "", path: "/x" })).toThrow();
    expect(() => waterbutlerDownloadUrl({ guid: "abc12", provider: "osfstorage", path: "" })).toThrow();
    expect(() => waterbutlerDownloadUrl({ guid: "not a guid", provider: "osfstorage", path: "/x" })).toThrow();
    expect(() =>
      waterbutlerDownloadUrl({ guid: "abc12", provider: "evil/../x", path: "/x" }),
    ).toThrow();
  });
});

describe("a resume against ?direct= is refused, not trusted", () => {
  it("rejects the 200-without-Content-Range answer a ranged ?direct= request gets", () => {
    // The bytes really are the requested range — verified against the whole file — but a
    // server that does not SAY so cannot be taken at its word, and appending on a wrong
    // guess produces a file of the right length with the wrong contents.
    const check = checkRangeResponse({
      status: 200,
      requestedFrom: 5000,
      contentRange: null,
      expectedTotal: 18227,
    });
    expect(check.ok).toBe(false);
  });

  it("still accepts a fresh download, which is the normal path", () => {
    expect(
      checkRangeResponse({
        status: 200,
        requestedFrom: 0,
        contentRange: null,
        expectedTotal: 18227,
      }).ok,
    ).toBe(true);
  });
});
