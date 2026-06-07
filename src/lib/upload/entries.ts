import type { DroppedNode } from "./types";

/** Minimal structural type for the parts of FileSystemEntry we touch (testable). */
export type FsEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FsEntryLike[]) => void, err?: (e: unknown) => void) => void };
};

function readFile(entry: FsEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) return reject(new Error("not a file entry"));
    entry.file(resolve, reject);
  });
}

function readAllDirEntries(entry: FsEntryLike): Promise<FsEntryLike[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) return resolve([]);
    const all: FsEntryLike[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        pump();
      }, reject);
    };
    pump();
  });
}

async function walk(entry: FsEntryLike): Promise<DroppedNode> {
  if (entry.isFile) {
    return { kind: "file", name: entry.name, file: await readFile(entry) };
  }
  const childEntries = await readAllDirEntries(entry);
  const children: DroppedNode[] = [];
  for (const child of childEntries) children.push(await walk(child));
  return { kind: "folder", name: entry.name, children };
}

/** Convert dropped DataTransferItem entries (webkitGetAsEntry results) into a DroppedNode[]. */
export async function readDroppedEntries(entries: Array<FsEntryLike | null>): Promise<DroppedNode[]> {
  const nodes: DroppedNode[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    nodes.push(await walk(entry));
  }
  return nodes;
}

export function countDropped(nodes: DroppedNode[]): { files: number; folders: number } {
  let files = 0, folders = 0;
  for (const node of nodes) {
    if (node.kind === "file") files += 1;
    else {
      folders += 1;
      const sub = countDropped(node.children);
      files += sub.files;
      folders += sub.folders;
    }
  }
  return { files, folders };
}
