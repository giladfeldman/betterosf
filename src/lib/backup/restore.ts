// Restore a backup archive back into OSF Storage.
//
// This is deliberately thin: because capture.ts expands folders into real files at their
// true relative paths, a backup archive is an ordinary faithful tree. So the existing
// upload machinery reads it with no special handling —
//
//     backup .zip → zipToDroppedNodes → runUploadPlan
//
// That is the single strongest reason capture.ts does not reuse the ZIP-selection route,
// whose folders arrive as opaque nested .zip files that this path could not read.
//
// IMPORTANT: restore is NOT undo. Files come back with new OSF ids and fresh version
// history, and any external link to the original file id stays broken. Every user-facing
// string must say "restore a copy".

import { zipToDroppedNodes } from "@/lib/upload/zip";
import { runUploadPlan } from "@/lib/upload/orchestrate";
import type { FileOutcome, TreeUploadTarget, UploadPlanResult } from "@/lib/upload/types";
import { makeHttpUploadIO } from "@/lib/upload/http-io";
import type { BackupRecord } from "./idb";

export type RestorePreflight = {
  ok: boolean;
  fileCount: number;
  expectedCount: number;
  /** Set when the archive holds top-level .zip entries (e.g. a "Download selected" archive). */
  opaqueArchives: string[];
  message?: string;
};

export async function inspectBackup(record: BackupRecord): Promise<RestorePreflight> {
  const extracted = await zipToDroppedNodes(record.blob);
  const opaqueArchives = extracted.nodes
    .filter((n) => n.kind === "file" && n.name.toLowerCase().endsWith(".zip"))
    .map((n) => n.name);

  const ok = extracted.totalFiles > 0;
  return {
    ok,
    fileCount: extracted.totalFiles,
    expectedCount: record.items.length,
    opaqueArchives,
    message: ok ? undefined : "This backup archive appears to be empty.",
  };
}

/**
 * Upload the archive's contents into `target`.
 *
 * Conflict policy is "skip": a restore should never overwrite something that already
 * exists at the destination, because the user may have re-created work there since.
 * runUploadPlan already verifies each upload by re-listing, so restore inherits that.
 */
export async function restoreBackup(
  record: BackupRecord,
  target: TreeUploadTarget,
  onProgress?: (outcome: FileOutcome) => void
): Promise<UploadPlanResult> {
  const extracted = await zipToDroppedNodes(record.blob);
  return runUploadPlan(
    target,
    extracted.nodes,
    { resolve: () => "skip" },
    makeHttpUploadIO(target.guid),
    { onProgress }
  );
}
