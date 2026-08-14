/**
 * Every host the browser must reach has to be in `connect-src`.
 *
 * THE DEFECT, 2026-08-14: the Zenodo transfer shipped in v1.9.0 while `connect-src` still
 * read `'self' https://*.osf.io`. The browser blocked every request to zenodo.org before it
 * left the page and reported `TypeError: NetworkError when attempting to fetch resource` —
 * which names neither CSP nor the host, and looks identical to a network outage or a
 * blocking extension. Two rounds of investigation went elsewhere. Zenodo's own CORS was
 * measured clean the whole time.
 *
 * The lesson this pins: **a feature that fetches a new origin is not shipped until the CSP
 * knows about it**, and no integration test catches that, because tests do not enforce CSP.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const middleware = readFileSync(resolve(__dirname, "../../src/middleware.ts"), "utf8");
const connectSrc = middleware.match(/"connect-src ([^"]+)"/)?.[1] ?? "";

describe("connect-src covers every origin the app fetches", () => {
  it("allows same-origin", () => {
    expect(connectSrc).toContain("'self'");
  });

  it("allows OSF, for file downloads straight from Waterbutler", () => {
    expect(connectSrc).toContain("https://*.osf.io");
  });

  it("allows BOTH Zenodo instances, because ZENODO_ENV picks one at runtime", () => {
    // Listing only the configured one would break the moment the env flips, and the
    // failure would again look like a network problem rather than a policy one.
    expect(connectSrc).toContain("https://zenodo.org");
    expect(connectSrc).toContain("https://sandbox.zenodo.org");
  });

  it("does NOT use a wildcard for Zenodo", () => {
    // `https://*.zenodo.org` would authorise the browser to send a deposit credential to
    // any subdomain anyone ever stands up there.
    expect(connectSrc).not.toContain("*.zenodo.org");
  });

  it("stays a closed list — no blanket https: or *", () => {
    expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/);
    expect(connectSrc).not.toMatch(/(^|\s)https:(\s|$)/);
  });
});
