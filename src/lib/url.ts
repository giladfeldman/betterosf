/**
 * Join already-DECODED path segments into a URL path, percent-encoding each one.
 *
 * Next.js 15 catch-all segments arrive URL-encoded; the pages decode them to
 * match OSF's decoded names. But the decoded segments are then used to BUILD
 * hrefs (breadcrumbs, folder/file links) — a name like "PCIRR Stage 1" must be
 * re-encoded ("PCIRR%20Stage%201") or the resulting link is malformed. Use this
 * anywhere decoded segments are turned back into a URL path.
 */
export function encodePathSegments(segments: string[]): string {
  return segments.map((seg) => encodeURIComponent(seg)).join("/");
}
