import type { TreeUploadTarget } from "@/components/UnifiedTreeNode";

/** A file or folder captured from a browser drag-drop, with nested structure. */
export type DroppedNode =
  | { kind: "file"; name: string; file: File }
  | { kind: "folder"; name: string; children: DroppedNode[] };

/** Plain-language classification of why an upload failed. */
export type UploadCause =
  | "connectivity"   // network/offline; fetch threw
  | "osf_down"       // OSF 5xx or repeated 429 after retries
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
