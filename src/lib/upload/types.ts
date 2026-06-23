import type { TreeUploadTarget } from "@/components/UnifiedTreeNode";

/** A file in a dropped/extracted tree.
 *  - Drag-drop sets `file` eagerly (disk-backed FileSystemEntry handle, cheap to hold).
 *  - ZIP sets `size` + a lazy `getFile` so the archive entry is only decompressed at
 *    upload time (keeps a GB archive from being fully materialized in memory). */
export type DroppedFileNode = {
  kind: "file";
  name: string;
  file?: File;
  size?: number;
  getFile?: () => Promise<File>;
};

/** A file or folder captured from a drag-drop or extracted from a ZIP, nested. */
export type DroppedNode =
  | DroppedFileNode
  | { kind: "folder"; name: string; children: DroppedNode[] };

/** Byte size of a dropped file node, whether eager (drag-drop) or lazy (ZIP). */
export function droppedFileSize(node: DroppedFileNode): number {
  return node.size ?? node.file?.size ?? 0;
}

/** Materialize a dropped file node's bytes (decompresses a ZIP entry on demand). */
export function materializeDroppedFile(node: DroppedFileNode): Promise<File> {
  if (node.getFile) return node.getFile();
  if (node.file) return Promise.resolve(node.file);
  throw new Error(`Dropped file "${node.name}" has no bytes (neither file nor getFile).`);
}

/** Plain-language classification of why an upload failed. */
export type UploadCause =
  | "connectivity"   // network/offline; fetch threw
  | "rate_limited"   // 429 — OSF or BetterOSF throttling; retried with Retry-After
  | "osf_down"       // OSF 5xx after retries
  | "permission"     // 401/403 — session expired or no write access
  | "betterosf"      // our 400/validation/unexpected — our bug
  | "unknown";

/** Per-file conflict resolution chosen in the dialog. */
export type ConflictChoice = "new_version" | "skip";

/** Final per-file outcome after orchestration. */
export type FileOutcome = {
  /** Stable id within a run (relative path). */
  path: string;
  name: string;
  size: number;
  status: "confirmed" | "skipped" | "failed";
  cause?: UploadCause;
  detail?: string;     // raw status/message for the user
  attempts: number;
};

export type UploadPlanResult = {
  outcomes: FileOutcome[];
  confirmed: number;
  skipped: number;
  failed: number;
};

/** One row in the persisted activity log. */
export type ActivityEntry = {
  id: string;
  ts: number;                 // epoch ms (stamped by caller, not in pure code)
  guid: string;
  destinationLabel: string;   // e.g. "My Project / Data"
  summary: string;            // e.g. "3 files" or "folder data/ (12 files)"
  status: "in_progress" | "success" | "partial" | "failed";
  confirmed: number;
  skipped: number;
  failed: number;
  outcomes: FileOutcome[];
};

export type { TreeUploadTarget };
