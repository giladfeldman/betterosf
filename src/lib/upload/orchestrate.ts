import type { FileEntry } from "@/lib/osf/files";
import type { DroppedNode, DroppedFileNode, FileOutcome, TreeUploadTarget, UploadPlanResult, ConflictChoice } from "./types";
import { droppedFileSize, materializeDroppedFile } from "./types";
import { classifyUploadError, type ClassifyInput } from "./classify";
import { withRetry } from "./retry";

export type UploadIO = {
  list: (target: TreeUploadTarget) => Promise<FileEntry[]>;
  createFolder: (target: TreeUploadTarget, name: string) => Promise<void>;
  uploadFile: (target: TreeUploadTarget, file: File, opts: { overwrite: boolean }) => Promise<void>;
};

export type ConflictContext = { path: string; name: string; size: number; existingSize: number | null };
export type ConflictPolicy = { resolve: (ctx: ConflictContext) => ConflictChoice };

export type RunOpts = {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (outcome: FileOutcome) => void;
};

function toClassifyInput(error: unknown): ClassifyInput {
  if (error && typeof error === "object") {
    const e = error as { status?: number; code?: string; message?: string };
    if (typeof e.status === "number") return { status: e.status, code: e.code, message: e.message };
    return { threw: true, message: e.message };
  }
  return { threw: true, message: String(error) };
}

function childTargetFromEntry(
  entry: Extract<FileEntry, { kind: "folder" }>,
  parent: TreeUploadTarget
): TreeUploadTarget {
  return {
    guid: parent.guid,
    provider: "osfstorage",
    path: entry.materializedPath.endsWith("/") ? entry.materializedPath : `${entry.materializedPath}/`,
    name: entry.name,
    listingUrl: entry.listingUrl,
    uploadUrl: entry.uploadUrl,
    newFolderUrl: entry.newFolderUrl,
    nodeTitle: parent.nodeTitle,
    sourceKind: parent.sourceKind,
  };
}

export async function runUploadPlan(
  rootTarget: TreeUploadTarget,
  nodes: DroppedNode[],
  policy: ConflictPolicy,
  io: UploadIO,
  opts: RunOpts = {}
): Promise<UploadPlanResult> {
  const { maxAttempts = 4, sleep, onProgress } = opts;
  const outcomes: FileOutcome[] = [];

  const emit = (o: FileOutcome) => { outcomes.push(o); onProgress?.(o); };

  function failSubtree(children: DroppedNode[], relBase: string, detail: string, cause: FileOutcome["cause"]): void {
    for (const child of children) {
      const relPath = `${relBase}${child.name}`;
      if (child.kind === "file") {
        emit({ path: relPath, name: child.name, size: droppedFileSize(child), status: "failed", cause, detail, attempts: 0 });
      } else {
        failSubtree(child.children, `${relPath}/`, detail, cause);
      }
    }
  }

  async function verifyPresent(target: TreeUploadTarget, file: File): Promise<boolean> {
    try {
      const fresh = await io.list(target);
      return fresh.some((e) => e.kind === "file" && e.name === file.name && (e.size === file.size || e.size == null));
    } catch {
      return false;
    }
  }

  async function processFile(
    target: TreeUploadTarget,
    node: DroppedFileNode,
    relPath: string,
    existing: FileEntry | undefined
  ): Promise<void> {
    const size = droppedFileSize(node);
    let overwrite = false;
    if (existing && existing.kind === "file") {
      const choice = policy.resolve({ path: relPath, name: node.name, size, existingSize: existing.size });
      if (choice === "skip") {
        emit({ path: relPath, name: node.name, size, status: "skipped", attempts: 0 });
        return;
      }
      overwrite = true;
    }
    // Materialize the bytes only now that we are actually uploading this file — for a
    // ZIP this decompresses just this entry, so a large archive never sits fully in memory.
    let file: File;
    try {
      file = await materializeDroppedFile(node);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      emit({ path: relPath, name: node.name, size, status: "failed", cause: "betterosf", detail: `Could not read "${node.name}" from the archive: ${detail}`, attempts: 0 });
      return;
    }
    let attempts = 0;
    try {
      await withRetry(
        () => io.uploadFile(target, file, { overwrite }),
        {
          maxAttempts,
          shouldRetry: (e) => classifyUploadError(toClassifyInput(e)).retryable,
          sleep,
          onAttempt: (n) => { attempts = n; },
        }
      );
    } catch (error) {
      const c = classifyUploadError(toClassifyInput(error));
      emit({ path: relPath, name: node.name, size, status: "failed", cause: c.cause, detail: c.message, attempts });
      return;
    }
    // VERIFY by re-list: the file must now exist with matching byte-size.
    const ok = await verifyPresent(target, file);
    if (ok) emit({ path: relPath, name: node.name, size, status: "confirmed", attempts });
    else emit({ path: relPath, name: node.name, size, status: "failed", cause: "unknown", detail: "Upload reported success but verification (re-list) could not confirm the file on OSF.", attempts });
  }

  async function processFolder(
    target: TreeUploadTarget,
    node: Extract<DroppedNode, { kind: "folder" }>,
    relPath: string,
    existing: FileEntry | undefined
  ): Promise<void> {
    let childTarget: TreeUploadTarget;
    if (existing && existing.kind === "folder") {
      childTarget = childTargetFromEntry(existing, target);
    } else {
      try {
        await withRetry(
          () => io.createFolder(target, node.name),
          { maxAttempts, shouldRetry: (e) => classifyUploadError(toClassifyInput(e)).retryable, sleep }
        );
      } catch (error) {
        const c = classifyUploadError(toClassifyInput(error));
        failSubtree(node.children, `${relPath}/`, `Parent folder "${node.name}" could not be created: ${c.message}`, c.cause);
        return;
      }
      // Re-list parent to discover the created folder's links (api.osf.io listingUrl + WB upload links).
      let parentListing: FileEntry[];
      try {
        parentListing = await io.list(target);
      } catch (error) {
        const c = classifyUploadError(toClassifyInput(error));
        failSubtree(node.children, `${relPath}/`, `Parent folder "${node.name}" was created but could not be re-read: ${c.message}`, c.cause);
        return;
      }
      const created = parentListing.find((e) => e.kind === "folder" && e.name === node.name);
      if (!created || created.kind !== "folder") {
        failSubtree(node.children, `${relPath}/`, `Parent folder "${node.name}" could not be confirmed after creation.`, "unknown");
        return;
      }
      childTarget = childTargetFromEntry(created, target);
    }
    await processFolderContents(childTarget, node.children, `${relPath}/`);
  }

  async function processFolderContents(target: TreeUploadTarget, children: DroppedNode[], relBase: string): Promise<void> {
    // Single authoritative listing of this folder (existing names → conflicts + links).
    let listing: FileEntry[];
    try {
      listing = await io.list(target);
    } catch (error) {
      const c = classifyUploadError(toClassifyInput(error));
      failSubtree(children, relBase, `Could not read destination folder: ${c.message}`, c.cause);
      return;
    }
    const byName = new Map(listing.map((e) => [e.name, e]));

    for (const child of children) {
      const relPath = `${relBase}${child.name}`;
      if (child.kind === "file") {
        await processFile(target, child, relPath, byName.get(child.name));
      } else {
        await processFolder(target, child, relPath, byName.get(child.name));
      }
    }
  }

  await processFolderContents(rootTarget, nodes, "");

  const confirmed = outcomes.filter((o) => o.status === "confirmed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  return { outcomes, confirmed, skipped, failed };
}
