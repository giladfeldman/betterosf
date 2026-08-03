// When must the user take a ZIP off the device before we let them delete?
//
// The in-browser backup is evictable: the browser may clear it at any time, and the user
// may clear site data or lose the device. Below the thresholds that risk is acceptable
// because the copy is small and very likely to survive. Above them we would be gambling
// an evictable store on data OSF cannot restore, so the download stops being a suggestion.

export type BackupSelectionSummary = {
  totalBytes: number;
  fileCount: number;
  containsFolder: boolean;
};

export type DownloadRequirement = {
  mandatory: boolean;
  /** User-facing reasons. Empty when merely recommended. */
  reasons: string[];
};

/** Above this the local copy is a large bet on evictable storage. */
export const MAX_IDB_BYTES = 100 * 1024 * 1024;
/** Matches the delete route's per-request cap, so "one batch" and "one archive" align. */
export const MAX_IDB_FILES = 100;

export function downloadRequirement(
  summary: BackupSelectionSummary,
  storage: { idbAvailable: boolean; likelyFits: boolean }
): DownloadRequirement {
  const reasons: string[] = [];

  // Nothing to back up (e.g. deleting an empty folder) — there is no data at risk, so
  // demanding a download of a 0-byte archive is pure friction with no safety benefit.
  if (summary.fileCount === 0) return { mandatory: false, reasons: [] };

  if (summary.totalBytes > MAX_IDB_BYTES) {
    reasons.push(`This is over ${Math.round(MAX_IDB_BYTES / 1024 / 1024)} MB — too large to rely on browser storage.`);
  }
  if (summary.fileCount > MAX_IDB_FILES) {
    reasons.push(`This covers more than ${MAX_IDB_FILES} files.`);
  }
  if (summary.containsFolder) {
    // Knowable before expansion, and folder deletes are where people most under-estimate
    // how much they are about to destroy.
    reasons.push("You are deleting a folder, so this may include more than you can see.");
  }
  if (!storage.idbAvailable) {
    reasons.push("This browser cannot keep a local backup.");
  } else if (!storage.likelyFits) {
    reasons.push("There is not enough free space in this browser to keep a local backup.");
  }

  return { mandatory: reasons.length > 0, reasons };
}
