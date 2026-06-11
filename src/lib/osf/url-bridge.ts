// URL bridging between OSF and BetterOSF.
//
// Two concerns live here:
//  1. `bookmarkletTarget` — the OSF <-> BetterOSF redirect logic shipped inside
//     the draggable bookmarklet. Its source is embedded VERBATIM into the
//     bookmarklet via `.toString()`, so it must stay fully self-contained: no
//     imports, no module-scope references, no syntax that the bundler would
//     down-level into helper calls (hence the conservative `var`/`function`
//     style). It is unit-tested directly in tests/integration/url-bridge.test.ts.
//  2. `canonicalGuidPath` — server-side canonicalisation used by the middleware
//     so BetterOSF always serves brief, lowercase guid URLs (matching OSF's
//     canonical form), regardless of how the URL was typed or arrived.

export type BookmarkletLocation = {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
};

/**
 * Map the current OSF/BetterOSF location to its counterpart URL, or null when
 * the host is neither OSF nor BetterOSF.
 *
 * - osf.io (and any *.osf.io) <-> betterosf.vercel.app
 * - The guid segment is lowercased (OSF guids are case-insensitive; lowercase
 *   is the canonical form OSF itself resolves — `osf.io/3KMR9` 404s).
 * - OSF redirect/section suffixes (e.g. `/overview`, `/wiki`) collapse to the
 *   brief `/<guid>` URL; `/files` browser sub-paths are preserved (file names
 *   are case-sensitive, so only the guid is lowercased).
 * - Preprint URLs (`/preprints/<provider>/<guid>`) and other sectioned URLs
 *   resolve the guid that follows the section.
 *
 * Self-contained on purpose — see file header.
 */
export function bookmarkletTarget(loc: BookmarkletLocation): string | null {
  var OSF = "osf.io";
  var BETTEROSF = "betterosf.vercel.app";
  var host = loc.hostname;
  var onOsf = /(^|\.)osf\.io$/i.test(host);
  var onBetterosf = host === BETTEROSF;
  if (!onOsf && !onBetterosf) return null;
  var dest = onOsf ? BETTEROSF : OSF;
  var tail = (loc.search || "") + (loc.hash || "");
  var segs = (loc.pathname || "/").split("/").filter(function (s) {
    return s.length > 0;
  });
  var first = segs[0];
  if (first === undefined) return "https://" + dest + "/" + tail;
  // Leading path sections that are NOT a guid themselves (the guid follows).
  var sections =
    " preprints registries registrations users search dashboard myprojects settings support login quickfiles about bookmarklet information privacy me api ";
  var isSection = sections.indexOf(" " + first.toLowerCase() + " ") >= 0;
  var guidRe = /^[A-Za-z0-9]{2,8}$/;
  var gi = -1;
  if (isSection) {
    // The guid is the last guid-shaped segment after the section (preprints put
    // a provider, which may itself be guid-shaped, before the guid).
    for (var i = segs.length - 1; i >= 1; i--) {
      var seg = segs[i];
      if (seg !== undefined && guidRe.test(seg)) {
        gi = i;
        break;
      }
    }
  } else if (guidRe.test(first)) {
    gi = 0;
  }
  var guidSeg = gi >= 0 ? segs[gi] : undefined;
  if (guidSeg === undefined) return "https://" + dest + loc.pathname + tail;
  var guid = guidSeg.toLowerCase();
  var after = segs.slice(gi + 1);
  var firstAfter = after[0];
  var section = (firstAfter === undefined ? "" : firstAfter).toLowerCase();
  var path;
  if (section === "files") {
    // The file browser exists on both OSF and BetterOSF; keep the provider +
    // folder sub-path, preserving case (file names are case-sensitive).
    path = "/" + guid + "/" + after.join("/");
  } else {
    // Everything else collapses to the brief overview URL: OSF redirects
    // `/<guid>` to `/<guid>/overview` itself, and BetterOSF uses the brief form.
    path = "/" + guid;
  }
  return "https://" + dest + path + tail;
}

// Leading segments that are real BetterOSF routes, never a project guid.
const STATIC_FIRST_SEGMENTS = new Set([
  "about",
  "bookmarklet",
  "information",
  "privacy",
  "login",
  "me",
  "search",
  "api",
  "registrations",
  "preprints",
  "users",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

const CANON_GUID_RE = /^[A-Za-z0-9]{2,8}$/;

/**
 * Canonical BetterOSF path for a project-style URL, or null when no change is
 * needed. Lowercases the leading guid segment and strips an OSF-style
 * `/overview` suffix so BetterOSF always serves brief, lowercase guid URLs
 * (matching OSF's canonical form). Real static routes and `/files` sub-path
 * case are left untouched.
 */
export function canonicalGuidPath(pathname: string): string | null {
  const segs = pathname.split("/").filter((s) => s.length > 0);
  const first = segs[0];
  if (first === undefined) return null;
  if (STATIC_FIRST_SEGMENTS.has(first.toLowerCase())) return null;
  if (!CANON_GUID_RE.test(first)) return null;
  const lower = first.toLowerCase();
  let rest = segs.slice(1);
  const afterGuid = rest[0];
  if (afterGuid !== undefined && afterGuid.toLowerCase() === "overview") rest = rest.slice(1);
  const changed = lower !== first || rest.length !== segs.length - 1;
  if (!changed) return null;
  return "/" + [lower, ...rest].join("/");
}
