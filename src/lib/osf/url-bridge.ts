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
 *   brief `/<guid>` URL.
 * - File URLs: `/<guid>/files/<provider>/<path>` keeps the storage-provider
 *   path (case preserved); `/<guid>/files/<fileGuid>` (a file referenced by its
 *   OWN guid, not a provider) maps to the bare `/<fileGuid>` which both OSF and
 *   BetterOSF resolve to the file. BetterOSF's `/files/view/` segment is dropped
 *   when going back to OSF.
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
  if (segs.length === 0) return "https://" + dest + "/" + tail;
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
      var sg = segs[i];
      if (sg !== undefined && guidRe.test(sg)) {
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
  var section = (after[0] || "").toLowerCase();
  // OSF storage providers (the segment after `/files/`). Anything else there is
  // a file/folder guid, not a provider.
  var providers =
    " osfstorage github googledrive dropbox box s3 figshare onedrive owncloud gitlab bitbucket dataverse s3compat dropboxbusiness mendeley zotero weko ";
  var path;
  if (section === "files") {
    var sub = after.slice(1);
    var sub0 = sub[0];
    // BetterOSF's file-VIEW route inserts a "view" segment; drop it so the path
    // matches OSF's `/files/<provider>/<path>` form.
    if (sub0 !== undefined && sub0.toLowerCase() === "view") {
      sub = sub.slice(1);
      sub0 = sub[0];
    }
    if (sub0 === undefined) {
      path = "/" + guid + "/files";
    } else if (providers.indexOf(" " + sub0.toLowerCase() + " ") >= 0) {
      // Storage-provider path (folder browser). Preserve case (file names are
      // case-sensitive); only the guid was lowercased.
      path = "/" + guid + "/files/" + sub.join("/");
    } else if (guidRe.test(sub0)) {
      // `/files/<fileGuid>` — OSF references a file by its own guid. The bare
      // guid resolves to the file on both OSF and BetterOSF.
      path = "/" + sub0.toLowerCase();
    } else {
      path = "/" + guid;
    }
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

// OSF storage providers — the valid segment after `/<guid>/files/`. BetterOSF
// also uses a `view` segment there for its file viewer. Anything else is a
// file/folder guid, not a provider.
const STORAGE_PROVIDERS = new Set([
  "osfstorage",
  "github",
  "googledrive",
  "dropbox",
  "box",
  "s3",
  "figshare",
  "onedrive",
  "owncloud",
  "gitlab",
  "bitbucket",
  "dataverse",
  "s3compat",
  "dropboxbusiness",
  "mendeley",
  "zotero",
  "weko",
]);

const CANON_GUID_RE = /^[A-Za-z0-9]{2,8}$/;

/**
 * Canonical BetterOSF path for a project-style URL, or null when no change is
 * needed. Normalises to BetterOSF's brief, lowercase guid form (matching OSF's
 * canonical URLs):
 *  - lowercases the leading guid (`/3KMR9` -> `/3kmr9`),
 *  - strips an OSF `/overview` suffix (`/3kmr9/overview` -> `/3kmr9`),
 *  - rewrites a file referenced by its own guid (`/<guid>/files/<fileGuid>`,
 *    which BetterOSF can't read as a storage provider) to the bare `/<fileGuid>`
 *    route, which resolves the file.
 * Real static routes, storage-provider paths, and the `/files/view/` route are
 * left untouched.
 */
export function canonicalGuidPath(pathname: string): string | null {
  const segs = pathname.split("/").filter((s) => s.length > 0);
  const first = segs[0];
  if (first === undefined) return null;
  if (STATIC_FIRST_SEGMENTS.has(first.toLowerCase())) return null;
  if (!CANON_GUID_RE.test(first)) return null;

  // `/<guid>/files/<fileGuid>` — OSF addresses a file by its own guid. BetterOSF
  // reads the post-`files` segment as a storage provider, so resolve via the
  // bare guid route instead.
  const seg1 = segs[1];
  const seg2 = segs[2];
  if (seg1 !== undefined && seg1.toLowerCase() === "files" && seg2 !== undefined) {
    const p = seg2.toLowerCase();
    if (p !== "view" && !STORAGE_PROVIDERS.has(p) && CANON_GUID_RE.test(seg2)) {
      return "/" + p;
    }
  }

  const lower = first.toLowerCase();
  let rest = segs.slice(1);
  const afterGuid = rest[0];
  if (afterGuid !== undefined && afterGuid.toLowerCase() === "overview") rest = rest.slice(1);
  const changed = lower !== first || rest.length !== segs.length - 1;
  if (!changed) return null;
  return "/" + [lower, ...rest].join("/");
}
