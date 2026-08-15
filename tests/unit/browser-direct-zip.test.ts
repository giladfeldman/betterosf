/**
 * The two facts a browser-direct ZIP rests on, pinned as static assertions.
 *
 * Neither can be caught by an integration test: **Node's `fetch` ignores CORS entirely**,
 * so a passing probe script proves nothing about a browser. Both were measured with real
 * requests on 2026-08-14 (see `osfBrowserAuthHeader`), and what is testable here is that
 * the code keeps sending what those measurements say it must.
 */
import { describe, it, expect } from "vitest";
import {
  osfBrowserAuthHeader,
  waterbutlerZipUrl,
  waterbutlerDownloadUrl,
  PUBLIC_FETCH_PLACEHOLDER_TOKEN,
  OsfWriteError,
} from "@/lib/osf/waterbutler-url";

describe("osfBrowserAuthHeader", () => {
  it("always sends an Authorization header, because that is what flips Waterbutler's CORS branch", () => {
    // Measured: anonymously Waterbutler answers 200 with the bytes and NO
    // Access-Control-Allow-Origin, so the browser discards the response. No other allowed
    // header does it — not X-Requested-With, Cache-Control, Range or X-CSRFToken.
    expect(osfBrowserAuthHeader(null)).toBe(`Bearer ${PUBLIC_FETCH_PLACEHOLDER_TOKEN}`);
    expect(osfBrowserAuthHeader(undefined)).toBe(`Bearer ${PUBLIC_FETCH_PLACEHOLDER_TOKEN}`);
    expect(osfBrowserAuthHeader("   ")).toBe(`Bearer ${PUBLIC_FETCH_PLACEHOLDER_TOKEN}`);
  });

  it("uses a real token when there is one, so private files still work", () => {
    expect(osfBrowserAuthHeader("abc123")).toBe("Bearer abc123");
    expect(osfBrowserAuthHeader("  abc123  ")).toBe("Bearer abc123");
  });

  it("names the placeholder for what it is, so nobody reads it as a credential", () => {
    // It is not one, and it cannot become one: on a PRIVATE file the same value still
    // returns 403 while a real token returns 200. It flips the CORS branch and nothing
    // else.
    expect(PUBLIC_FETCH_PLACEHOLDER_TOKEN).toMatch(/no-credential/);
    expect(PUBLIC_FETCH_PLACEHOLDER_TOKEN).not.toMatch(/[A-Za-z0-9]{20,}/);
  });
});

describe("waterbutlerZipUrl", () => {
  it("builds a provider-root archive URL", () => {
    expect(waterbutlerZipUrl({ guid: "ezcuj", provider: "osfstorage" })).toBe(
      "https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/?zip=",
    );
  });

  it("builds a nested-folder archive URL, encoding each segment but keeping the slashes", () => {
    expect(
      waterbutlerZipUrl({ guid: "8cd4r", provider: "osfstorage", path: "/Wiki images/sub dir/" }),
    ).toBe("https://files.osf.io/v1/resources/8cd4r/providers/osfstorage/Wiki%20images/sub%20dir/?zip=");
  });

  it("pins the host, so a browser token can never be sent off OSF", () => {
    for (const url of [
      waterbutlerZipUrl({ guid: "ezcuj", provider: "osfstorage" }),
      waterbutlerDownloadUrl({ guid: "ezcuj", provider: "osfstorage", path: "/abc" }),
    ]) {
      expect(new URL(url).host).toBe("files.osf.io");
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("refuses a bad guid or a provider carrying a path separator", () => {
    expect(() => waterbutlerZipUrl({ guid: "!!!", provider: "osfstorage" })).toThrow(OsfWriteError);
    expect(() => waterbutlerZipUrl({ guid: "ezcuj", provider: "osfstorage/../x" })).toThrow(
      OsfWriteError,
    );
  });
});
