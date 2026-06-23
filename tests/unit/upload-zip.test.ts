import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { zipToDroppedNodes } from "@/lib/upload/zip";
import type { DroppedNode, DroppedFileNode } from "@/lib/upload/types";
import { materializeDroppedFile } from "@/lib/upload/types";

async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array" });
}

function folder(nodes: DroppedNode[], name: string): DroppedNode[] {
  const f = nodes.find((n) => n.kind === "folder" && n.name === name);
  if (!f || f.kind !== "folder") throw new Error(`folder ${name} not found`);
  return f.children;
}

describe("zipToDroppedNodes", () => {
  it("rebuilds the nested folder hierarchy from entry paths", async () => {
    const bytes = await makeZip({
      "readme.txt": "top",
      "data/raw.csv": "a,b,c",
      "data/sub/deep.txt": "deep",
    });
    const { nodes, totalFiles } = await zipToDroppedNodes(bytes);
    expect(totalFiles).toBe(3);
    expect(nodes.some((n) => n.kind === "file" && n.name === "readme.txt")).toBe(true);
    const data = folder(nodes, "data");
    expect(data.some((n) => n.kind === "file" && n.name === "raw.csv")).toBe(true);
    const sub = folder(data, "sub");
    expect(sub.some((n) => n.kind === "file" && n.name === "deep.txt")).toBe(true);
  });

  it("lazily materializes a File with the right name and content", async () => {
    const bytes = await makeZip({ "data/raw.csv": "hello,world" });
    const { nodes } = await zipToDroppedNodes(bytes);
    const fileNode = folder(nodes, "data").find((n) => n.kind === "file") as DroppedFileNode;
    const file = await materializeDroppedFile(fileNode);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("raw.csv");
    expect(await file.text()).toBe("hello,world");
  });

  it("reports uncompressed totals for the preview", async () => {
    const bytes = await makeZip({ "a.txt": "12345", "b.txt": "678" });
    const { totalFiles, totalBytes } = await zipToDroppedNodes(bytes);
    expect(totalFiles).toBe(2);
    expect(totalBytes).toBe(8);
  });

  it("filters macOS/Windows junk entries", async () => {
    const bytes = await makeZip({
      "keep.txt": "x",
      "__MACOSX/keep.txt": "junk",
      ".DS_Store": "junk",
      "data/._raw.csv": "junk",
      "data/Thumbs.db": "junk",
    });
    const { nodes, totalFiles, skipped } = await zipToDroppedNodes(bytes);
    expect(totalFiles).toBe(1);
    expect(nodes.some((n) => n.kind === "file" && n.name === "keep.txt")).toBe(true);
    expect(skipped.length).toBe(4);
  });

  it("rejects unsafe names and never escapes the extraction root", async () => {
    const zip = new JSZip();
    zip.file("ok.txt", "fine");
    zip.file("bad\\name.txt", "x");      // backslash segment — rejected by our cleanName guard
    zip.file("data/../escape.txt", "x"); // jszip itself resolves "../", so it lands safely at root
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const { nodes, skipped } = await zipToDroppedNodes(bytes);
    expect(nodes.some((n) => n.kind === "file" && n.name === "ok.txt")).toBe(true);
    expect(skipped).toContain("bad\\name.txt");
    // The traversal cannot escape: jszip normalizes it to a plain root file.
    expect(nodes.some((n) => n.kind === "file" && n.name === "escape.txt")).toBe(true);
    expect(nodes.every((n) => n.name !== "..")).toBe(true);
  });

  it("ignores explicit directory entries", async () => {
    const zip = new JSZip();
    zip.folder("emptyish")!.file("f.txt", "x");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const { totalFiles } = await zipToDroppedNodes(bytes);
    expect(totalFiles).toBe(1);
  });
});
