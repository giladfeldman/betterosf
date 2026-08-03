// Build a VERIFIABLE pre-delete archive, client-side.
//
// Why not reuse POST /api/zip/[guid]/selection, which already makes ZIPs:
//
//   1. It flushes response headers BEFORE assembling the archive, and writes failures
//      into `_BETTEROSF_SELECTION_ERRORS.txt` *inside* the ZIP. So a partial backup is
//      indistinguishable from a complete one at the HTTP layer. For an irreversible
//      delete, an unverifiable backup is worse than none: it manufactures confidence.
//   2. Folders come back as opaque NESTED .zip files, which cannot be enumerated to
//      verify, and which restore cannot read without a second unzip pass.
//   3. Its anonymous-token fallback can turn a private file into a silent 403.
//
// Capturing here costs more code but yields per-file accounting: every file is fetched,
// hashed, and counted, and anything missing marks the whole backup `incomplete` — which
// hard-blocks the delete. Expanding folders into real files also means the archive is a
// faithful tree, so restore works through the existing zipToDroppedNodes → runUploadPlan
// path with no special handling. Do not "optimize" this back onto the selection route.

import JSZip from "jszip";
import type { TreeSelectionPayload } from "@/components/tree-types";
import type { BackupItem, BackupRecord } from "./idb";

/** Refuse rather than silently degrade: a 50k-file delete should not be one click. */
export const MAX_EXPAND_FILES = 2000;
export const MAX_EXPAND_BYTES = 20 * 1024 * 1024 * 1024;
const FETCH_CONCURRENCY = 4;

export type PlannedFile = {
  /** Path inside the archive, mirroring the OSF tree. */
  archivePath: string;
  name: string;
  size: number;
  downloadUrl: string;
};

export type CapturePlan = {
  files: PlannedFile[];
  totalBytes: number;
  /** True when expansion hit a cap — the caller must refuse the delete. */
  tooLarge: boolean;
};

export type CaptureProgress = { done: number; total: number; currentName: string };

type FolderEntry = {
  kind: "file" | "folder";
  name: string;
  size: number | null;
  downloadUrl?: string;
  listingUrl?: string;
  materializedPath?: string;
};

async function listFolder(guid: string, listingUrl: string): Promise<FolderEntry[]> {
  const res = await fetch(`/api/files/${guid}/folder?` + new URLSearchParams({ provider: "osfstorage", listingUrl, fresh: "1" }));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body.slice(0, 200) || `Could not list a folder (HTTP ${res.status}).`);
  }
  const data: { entries: FolderEntry[] } = await res.json();
  return data.entries;
}

/**
 * Walk the selection into a flat list of real files.
 *
 * Folders are expanded recursively — that is what makes the archive restorable and the
 * count verifiable. Concurrency is capped to avoid a burst of OSF requests tripping 429.
 */
export async function planCapture(
  items: TreeSelectionPayload[],
  guid: string,
  onProgress?: (found: number) => void
): Promise<CapturePlan> {
  const files: PlannedFile[] = [];
  let totalBytes = 0;
  let tooLarge = false;

  async function walkFolder(listingUrl: string, prefix: string): Promise<void> {
    if (tooLarge) return;
    const entries = await listFolder(guid, listingUrl);
    const subfolders: { listingUrl: string; prefix: string }[] = [];

    for (const entry of entries) {
      if (tooLarge) return;
      if (entry.kind === "folder") {
        if (entry.listingUrl) subfolders.push({ listingUrl: entry.listingUrl, prefix: `${prefix}${entry.name}/` });
        continue;
      }
      files.push({
        archivePath: `${prefix}${entry.name}`,
        name: entry.name,
        size: entry.size ?? 0,
        downloadUrl: entry.downloadUrl ?? "",
      });
      totalBytes += entry.size ?? 0;
      onProgress?.(files.length);
      if (files.length > MAX_EXPAND_FILES || totalBytes > MAX_EXPAND_BYTES) {
        tooLarge = true;
        return;
      }
    }

    for (let i = 0; i < subfolders.length; i += FETCH_CONCURRENCY) {
      if (tooLarge) return;
      await Promise.all(subfolders.slice(i, i + FETCH_CONCURRENCY).map((s) => walkFolder(s.listingUrl, s.prefix)));
    }
  }

  for (const item of items) {
    if (tooLarge) break;
    if (item.kind === "file") {
      files.push({ archivePath: item.name, name: item.name, size: 0, downloadUrl: item.downloadUrl });
      onProgress?.(files.length);
    } else if (item.parentListingUrl) {
      // A folder's own listing URL is not on the payload; the tree supplies the parent's,
      // so we locate this folder within it and expand from there.
      const siblings = await listFolder(guid, item.parentListingUrl);
      const self = siblings.find((e) => e.kind === "folder" && e.name === item.name);
      if (self?.listingUrl) await walkFolder(self.listingUrl, `${item.name}/`);
    }
  }

  return { files, totalBytes, tooLarge };
}

export type CaptureResult = {
  blob: Blob;
  items: BackupItem[];
  missing: { path: string; reason: string }[];
  totalBytes: number;
  status: "complete" | "incomplete";
};

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fetch every planned file, hash it, and zip it.
 *
 * Hashes cover the bytes we actually stored, not OSF's reported hash: that verifies OUR
 * archive, which is what a restore depends on. OSF's hash only proves the download was
 * faithful to OSF.
 *
 * Any file we cannot retrieve lands in `missing` and forces status "incomplete". The
 * caller MUST treat that as a hard block — never infer success from the absence of a throw.
 */
export async function captureBackup(
  plan: CapturePlan,
  guid: string,
  onProgress?: (p: CaptureProgress) => void
): Promise<CaptureResult> {
  const zip = new JSZip();
  const items: BackupItem[] = [];
  const missing: { path: string; reason: string }[] = [];
  let stored = 0;
  let done = 0;

  const queue = [...plan.files];
  async function worker(): Promise<void> {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      onProgress?.({ done, total: plan.files.length, currentName: file.name });
      try {
        // Query params are `u` (source URL) and `name` — see api/files/[guid]/download.
        const url = file.downloadUrl
          ? `/api/files/${guid}/download?` + new URLSearchParams({ u: file.downloadUrl, name: file.name })
          : "";
        if (!url) throw new Error("No download URL");
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();

        // A 200 is not proof we got the file. If an upstream auth/redirect problem ever
        // leaks an error page through the proxy, it arrives as a small JSON/HTML body with
        // HTTP 200 — and would be archived as if it were content. OSF's own reported size
        // is the cross-check: a mismatch means what we stored is NOT the file, so treat it
        // as missing and let the incomplete-backup gate block the delete.
        // (Live evidence: OSF's `links.download` 302s and drops Authorization, yielding a
        // 263-byte "Forbidden" page. The server proxy avoids that today; this is the belt.)
        if (file.size > 0 && bytes.byteLength !== file.size) {
          throw new Error(`size mismatch: expected ${file.size} bytes, got ${bytes.byteLength}`);
        }

        zip.file(file.archivePath, bytes);
        items.push({
          kind: "file",
          path: file.archivePath,
          name: file.name,
          size: bytes.byteLength,
          sha256: await sha256(bytes),
        });
        stored += bytes.byteLength;
      } catch (e) {
        missing.push({ path: file.archivePath, reason: e instanceof Error ? e.message : "Unknown error" });
      } finally {
        done += 1;
        onProgress?.({ done, total: plan.files.length, currentName: file.name });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, plan.files.length || 1) }, worker));

  // level 0: research data is largely incompressible, and speed matters more here than
  // size — the user is waiting to delete.
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });

  return {
    blob,
    items,
    missing,
    totalBytes: stored,
    // Completeness is COMPUTED, never inferred from a 200.
    status: missing.length === 0 && items.length === plan.files.length ? "complete" : "incomplete",
  };
}

export function makeBackupRecord(args: {
  guid: string;
  projectTitle: string;
  capture: CaptureResult;
}): BackupRecord {
  return {
    id: `${args.guid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guid: args.guid,
    projectTitle: args.projectTitle,
    createdAt: Date.now(),
    status: args.capture.status,
    items: args.capture.items,
    missing: args.capture.missing,
    totalBytes: args.capture.totalBytes,
    blob: args.capture.blob,
  };
}

export function backupFilename(guid: string, title: string): string {
  const safe = (title || guid).replace(/[^\w.-]+/g, "_").slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `betterosf-backup_${safe}_${stamp}.zip`;
}
