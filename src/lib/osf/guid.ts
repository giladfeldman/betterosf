const GUID_RE = /^[a-zA-Z0-9]{2,8}$/;

export function isValidGuid(s: string): boolean {
  return GUID_RE.test(s);
}

// OSF path sections that are NOT guids — the real guid (if any) follows them.
const NON_GUID_PREFIXES = new Set([
  "preprints",
  "registries",
  "dashboard",
  "myprojects",
  "search",
  "settings",
  "support",
  "login",
  "quickfiles",
]);

/**
 * Extract an OSF guid from any pasted OSF URL or bare guid. OSF uses a flat guid
 * namespace, so this only needs to find the guid-shaped segment — the
 * /<guid> dispatcher then figures out the actual object type. Handles:
 *   - bare guid                          → ezcuj
 *   - osf.io/<guid>[/files/...|/wiki/..] → first guid segment
 *   - osf.io/preprints/<provider>/<guid> → the LAST guid segment (skips provider)
 *   - osf.io/registries/... etc.         → first guid after the section prefix
 *   - protocol-less osf.io/<guid>        → normalized to https first
 */
export function parseOsfUrl(input: string): string | null {
  const trimmed = input.trim();
  if (isValidGuid(trimmed)) return trimmed;

  // Allow protocol-less paste like "osf.io/ezcuj" or "www.osf.io/ezcuj".
  const candidate = /^(www\.)?osf\.io\//i.test(trimmed) ? `https://${trimmed}` : trimmed;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!/(^|\.)osf\.io$/i.test(url.hostname)) return null;

  const segs = url.pathname.split("/").filter(Boolean);
  const first = (segs[0] ?? "").toLowerCase();
  if (!first) return null;

  // Preprint URLs put the guid LAST (after an optional provider that may itself
  // look guid-shaped, e.g. "psyarxiv"), so scan from the end.
  if (first === "preprints") {
    for (let i = segs.length - 1; i >= 1; i--) {
      const s = segs[i];
      if (s && isValidGuid(s)) return s;
    }
    return null;
  }

  const start = NON_GUID_PREFIXES.has(first) ? 1 : 0;
  for (let i = start; i < segs.length; i++) {
    const s = segs[i];
    if (s && isValidGuid(s)) return s;
  }
  return null;
}
