import { describe, it, expect } from "vitest";
import { readDroppedEntries, countDropped, type FsEntryLike } from "@/lib/upload/entries";

function fileEntry(name: string, content = "x"): FsEntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(new File([content], name)),
  };
}

function dirEntry(name: string, children: FsEntryLike[]): FsEntryLike {
  let handed = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (entries: FsEntryLike[]) => void) => {
        // First call returns all children, second returns [] (end of dir).
        if (handed) return cb([]);
        handed = true;
        cb(children);
      },
    }),
  };
}

describe("readDroppedEntries", () => {
  it("reads a flat list of files", async () => {
    const nodes = await readDroppedEntries([fileEntry("a.txt"), fileEntry("b.txt")]);
    expect(nodes.map((n) => n.kind)).toEqual(["file", "file"]);
    expect(nodes.map((n) => n.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("reads a nested folder tree", async () => {
    const tree = dirEntry("data", [fileEntry("x.csv"), dirEntry("sub", [fileEntry("y.csv")])]);
    const nodes = await readDroppedEntries([tree]);
    expect(nodes).toHaveLength(1);
    const folder = nodes[0]!;
    expect(folder.kind).toBe("folder");
    if (folder.kind !== "folder") throw new Error("expected folder");
    expect(folder.name).toBe("data");
    expect(folder.children.map((c) => c.name)).toEqual(["x.csv", "sub"]);
  });

  it("ignores null entries (non-file drag items)", async () => {
    const nodes = await readDroppedEntries([null, fileEntry("a.txt")]);
    expect(nodes.map((n) => n.name)).toEqual(["a.txt"]);
  });

  it("countDropped totals files and folders", async () => {
    const tree = dirEntry("data", [fileEntry("x.csv"), dirEntry("sub", [fileEntry("y.csv")])]);
    const nodes = await readDroppedEntries([tree]);
    expect(countDropped(nodes)).toEqual({ files: 2, folders: 2 });
  });
});
