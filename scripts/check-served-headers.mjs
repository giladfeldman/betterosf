#!/usr/bin/env node
/**
 * Assert that the DEPLOYED app serves a CSP whose `connect-src` lists every origin the
 * browser is expected to fetch.
 *
 * WHY THIS EXISTS. v1.11.1 shipped the Zenodo transfer while `connect-src` still read
 * `'self' https://*.osf.io`. The browser refused every request to zenodo.org before it left
 * the page and reported a bare `TypeError: NetworkError when attempting to fetch resource` —
 * naming neither CSP nor the host, and looking exactly like a network outage. Two rounds of
 * investigation went elsewhere. **One `curl -I | grep connect-src` would have caught it.**
 *
 * `tests/unit/csp-connect-src.test.ts` already pins the policy in the SOURCE. This checks the
 * other half — that the policy the middleware builds is the policy Vercel actually serves.
 * Those differ whenever a deploy did not land, an edge cache is stale, or a rewrite strips
 * headers, and nothing local can see the difference.
 *
 * TWO MEASURED FACTS, both learned by running this rather than reasoning about it (2026-08-14):
 *
 *   1. **Vercel's bot mitigation answers a bare curl with `429 Too Many Requests`** and no CSP
 *      header at all. A naive `curl -I | grep connect-src` therefore prints NOTHING — which
 *      reads identically to "the origin is missing from the policy". A browser User-Agent gets
 *      a 200. So this script checks the STATUS FIRST and exits `UNVERIFIED` rather than `FAIL`
 *      when it never got a real response. A probe that cannot tell "absent" from "unreachable"
 *      is not a probe.
 *   2. `HEAD` and `GET` both work once the UA is set; `GET` with `-o /dev/null -D -` is used
 *      here so the check exercises the same path a browser does.
 *
 * Usage:  node scripts/check-served-headers.mjs [url]
 *         node scripts/check-served-headers.mjs http://localhost:4747
 * Exit:   0 = PASS · 1 = FAIL (header served, origin missing) · 2 = UNVERIFIED (no real response)
 */

const url = process.argv[2] ?? "https://betterosf.vercel.app/";

/**
 * Every origin the BROWSER fetches directly. Keep this in step with `buildCsp` in
 * `src/middleware.ts` — `tests/unit/csp-connect-src.test.ts` is what pins the source side.
 */
const REQUIRED_ORIGINS = [
  "'self'",
  "https://*.osf.io",          // Waterbutler file bytes, browser-direct
  "https://zenodo.org",        // deposit target when ZENODO_ENV=production
  "https://sandbox.zenodo.org", // deposit target when ZENODO_ENV=sandbox (or unset)
];

/** A browser UA. Without it Vercel's mitigation returns 429 and no headers — see fact 1. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0 Safari/537.36";

const fail = (msg) => {
  console.error(`✗ FAIL  ${msg}`);
  process.exit(1);
};
const unverified = (msg) => {
  console.error(`? UNVERIFIED  ${msg}`);
  console.error(`  Not a pass and not a failure — the probe never got a usable response.`);
  process.exit(2);
};

let res;
try {
  res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
} catch (err) {
  unverified(`${url} could not be reached: ${err.message}`);
}

if (res.status !== 200) {
  unverified(
    `${url} answered ${res.status}, not 200. ` +
      (res.status === 429
        ? "That is Vercel's bot mitigation, not your app — the CSP header is absent from a " +
          "challenge response, so a header check here would report a defect that is not there."
        : "A non-200 carries no guarantee about the app's own headers."),
  );
}

const csp = res.headers.get("content-security-policy");
if (!csp) {
  fail(
    `${url} returned 200 but served NO Content-Security-Policy header. ` +
      `It is built per-request in src/middleware.ts — check the matcher still covers this path.`,
  );
}

const connectSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
if (!connectSrc) {
  fail(`CSP is served but has no connect-src directive at all:\n  ${csp}`);
}

const missing = REQUIRED_ORIGINS.filter((o) => !connectSrc.includes(o));
if (missing.length) {
  fail(
    `connect-src is missing ${missing.join(", ")}.\n` +
      `  served: ${connectSrc}\n` +
      `  Every request the browser makes to a missing origin fails with a bare\n` +
      `  "TypeError: NetworkError when attempting to fetch resource" that names neither\n` +
      `  the host nor the policy. It will be misread as a flaky network.`,
  );
}

// A closed list, checked here too: a wildcard would satisfy every assertion above while
// authorising the browser to send a deposit credential to any subdomain anyone stands up.
if (/(^|\s)\*(\s|$)/.test(connectSrc) || /\s https:(\s|$)/.test(connectSrc)) {
  fail(`connect-src has been widened to a blanket wildcard:\n  ${connectSrc}`);
}
if (connectSrc.includes("*.zenodo.org")) {
  fail(`connect-src uses *.zenodo.org; list exact hosts:\n  ${connectSrc}`);
}

console.log(`✓ PASS  ${url}`);
console.log(`        ${connectSrc}`);
