// Allowlist for the OSF `sort` query parameter.
//
// `URLSearchParams` already encodes the value (so there's no query-string
// injection), but forwarding an arbitrary client-supplied string to OSF is still
// untidy and lets a caller probe OSF's sort surface. We accept only a known set
// of sort fields, each optionally prefixed with `-` for descending order, and
// drop anything else.

const ALLOWED_SORT_FIELDS = new Set([
  "title",
  "name",
  "full_name",
  "date_created",
  "date_modified",
  "date_registered",
  "last_logged",
  "modified",
  "created",
  "relevance",
]);

/**
 * Returns the sort value if it's an allowlisted field (optionally `-`-prefixed),
 * otherwise `undefined` so the caller omits the param entirely.
 */
export function sanitizeSort(sort: string | undefined | null): string | undefined {
  if (!sort) return undefined;
  const trimmed = sort.trim();
  const field = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
  return ALLOWED_SORT_FIELDS.has(field) ? trimmed : undefined;
}
