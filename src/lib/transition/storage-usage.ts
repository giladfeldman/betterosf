/**
 * Storage-usage shape and its pure helpers.
 *
 * Split out of `src/lib/osf/storage.ts` — which is `server-only` because it fetches —
 * so the inventory table can render the result in the browser. Types and formatting are
 * shared; the network call is not.
 *
 * The distinction this file exists to preserve: a size we could not determine is NOT
 * zero. A researcher scanning an inventory for what still needs moving would skip
 * straight past a "0 bytes" row.
 */

export type StorageUsage =
  | { known: true; bytes: number }
  /** We asked and could not get an answer. `reason` drives the text shown to the user. */
  | { known: false; reason: "forbidden" | "not_found" | "unrecognised_shape" | "error" };

export type StorageUnknownReason = Extract<StorageUsage, { known: false }>["reason"];

export type RawStorage = {
  data?: {
    attributes?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
};

/**
 * Field names OSF might use, in order of preference.
 *
 * ⚠️ The `/v2/nodes/{guid}/storage/` response shape is UNVERIFIED. The endpoint is
 * contributor-only — verified 2026-08-13, it returns 401 anonymously and 403 even with a
 * valid token for a project the caller does not contribute to, and the only test account
 * available owns zero projects. So this accepts the plausible names and returns null for
 * anything else rather than guessing a number.
 */
const BYTE_FIELDS = ["storage_usage", "storage_bytes", "size", "used", "bytes"];

/** Pull a byte count out of whichever field carries it — or null if none does. */
export function extractStorageBytes(raw: RawStorage): number | null {
  const buckets = [raw.data?.attributes, raw.data?.meta, raw.meta];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const field of BYTE_FIELDS) {
      const value = bucket[field];
      // Accept a numeric string too — OSF returns large integers as strings in places.
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/** Human-readable explanation for an unknown size. Never implies zero. */
export function describeStorageUnknown(reason: StorageUnknownReason): string {
  switch (reason) {
    case "forbidden":
      return "Not counted — OSF only reports size to project contributors.";
    case "not_found":
      return "Not counted — OSF reported no storage record for this project.";
    case "unrecognised_shape":
      return "Not counted — OSF returned a size in a format BetterOSF does not recognise.";
    default:
      return "Not counted — the request to OSF failed.";
  }
}
