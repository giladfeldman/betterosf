// ZIP archive → DroppedNode[] tree, reusing the existing upload pipeline.
//
// The browser extracts the archive's folder structure (jszip) into the same nested
// DroppedNode tree produced by folder drag-drop, so runUploadPlan recreates the exact
// hierarchy on OSF. Files are lazy: each entry is only decompressed at upload time
// (see DroppedFileNode.getFile), so a multi-GB archive never sits fully in memory.

import JSZip from "jszip";
import type { DroppedNode, DroppedFileNode } from "./types";
import { cleanName } from "@/lib/osf/waterbutler-url";

export type ZipExtractResult = {
  nodes: DroppedNode[];
  totalFiles: number;
  totalBytes: number;
  /** Entry paths we dropped (OS junk or unsafe names), surfaced so nothing fails silently. */
  skipped: string[];
};

/** macOS/Windows archive cruft that should never be pushed to OSF. */
function isJunkPath(path: string): boolean {
  const segs = path.split("/").filter((s) => s.length > 0);
  if (segs.some((s) => s === "__MACOSX")) return true;
  const base = segs[segs.length - 1] ?? "";
  return base === ".DS_Store" || base === "Thumbs.db" || base.startsWith("._");
}

/** jszip exposes the uncompressed size on the internal `_data` record (stable across 3.x).
 *  Used for the preview/totals so we don't have to decompress just to show sizes. */
function uncompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0;
}

function insertNode(root: DroppedNode[], folders: string[], fileNode: DroppedFileNode): void {
  let level = root;
  for (const folder of folders) {
    let existing = level.find((n): n is Extract<DroppedNode, { kind: "folder" }> => n.kind === "folder" && n.name === folder);
    if (!existing) {
      existing = { kind: "folder", name: folder, children: [] };
      level.push(existing);
    }
    level = existing.children;
  }
  level.push(fileNode);
}

export async function zipToDroppedNodes(
  input: File | Blob | ArrayBuffer | Uint8Array
): Promise<ZipExtractResult> {
  const zip = await JSZip.loadAsync(input);
  const nodes: DroppedNode[] = [];
  let totalFiles = 0;
  let totalBytes = 0;
  const skipped: string[] = [];

  // Deterministic order so the confirmation tree is stable.
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.dir) continue; // folders are recreated implicitly from file paths
    if (isJunkPath(entry.name)) { skipped.push(entry.name); continue; }

    const rawSegs = entry.name.split("/").filter((s) => s.length > 0);
    if (rawSegs.length === 0) { skipped.push(entry.name); continue; }

    // Validate every path segment with the same discipline as OSF writes (rejects
    // "..", encoded slashes, backslashes) so a malicious archive can't escape the folder.
    let segs: string[];
    try {
      segs = rawSegs.map((s) => cleanName(s));
    } catch {
      skipped.push(entry.name);
      continue;
    }

    const fileName = segs[segs.length - 1]!;
    const folders = segs.slice(0, -1);
    const size = uncompressedSize(entry);
    const node: DroppedFileNode = {
      kind: "file",
      name: fileName,
      size,
      getFile: () => entry.async("blob").then((blob) => new File([blob], fileName)),
    };
    insertNode(nodes, folders, node);
    totalFiles += 1;
    totalBytes += size;
  }

  return { nodes, totalFiles, totalBytes, skipped };
}
