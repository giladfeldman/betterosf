import { describe, it, expect, vi } from "vitest";
import { runUploadPlan, type UploadIO } from "@/lib/upload/orchestrate";
import type { DroppedNode, TreeUploadTarget } from "@/lib/upload/types";

const ROOT: TreeUploadTarget = {
  guid: "ezcuj", provider: "osfstorage", path: "/", name: "OSF Storage",
  listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/",
};

function fileNode(name: string, size = 5): DroppedNode {
  return { kind: "file", name, file: new File(["x".repeat(size)], name) };
}

/** Fake IO backed by an in-memory tree keyed by listingUrl. */
function makeIO(seed: Record<string, { name: string; size: number; kind: "file" | "folder" }[]> = {}) {
  const store: Record<string, { name: string; size: number; kind: "file" | "folder" }[]> = { [ROOT.listingUrl]: [], ...seed };
  const childUrl = (parent: string, name: string) => `${parent}${name}/`;
  const io: UploadIO = {
    list: vi.fn(async (t) => (store[t.listingUrl] ?? []).map((e) =>
      e.kind === "folder"
        ? { kind: "folder" as const, id: e.name, name: e.name, materializedPath: `${t.path}${e.name}/`, listingUrl: childUrl(t.listingUrl, e.name), uploadUrl: `wb:${e.name}`, newFolderUrl: `wbnf:${e.name}` }
        : { kind: "file" as const, id: e.name, name: e.name, size: e.size, modified: "", materializedPath: `${t.path}${e.name}`, downloadUrl: "" }
    )),
    createFolder: vi.fn(async (t, name) => {
      (store[t.listingUrl] ??= []).push({ name, size: 0, kind: "folder" });
      store[childUrl(t.listingUrl, name)] = [];
    }),
    uploadFile: vi.fn(async (t, file) => {
      (store[t.listingUrl] ??= []).push({ name: file.name, size: file.size, kind: "file" });
    }),
  };
  return { io, store };
}

describe("runUploadPlan", () => {
  it("uploads flat files and confirms each by re-list", async () => {
    const { io } = makeIO();
    const result = await runUploadPlan(ROOT, [fileNode("a.txt"), fileNode("b.txt")], { resolve: () => "new_version" }, io);
    expect(result.confirmed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.outcomes.every((o) => o.status === "confirmed")).toBe(true);
  });

  it("creates missing folders and uploads nested files", async () => {
    const { io, store } = makeIO();
    const tree: DroppedNode = { kind: "folder", name: "data", children: [fileNode("x.csv"), { kind: "folder", name: "sub", children: [fileNode("y.csv")] }] };
    const result = await runUploadPlan(ROOT, [tree], { resolve: () => "new_version" }, io);
    expect(result.confirmed).toBe(2);
    expect(io.createFolder).toHaveBeenCalledTimes(2); // data, sub
    expect(store["https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/data/"]!.map((e) => e.name)).toContain("x.csv");
  });

  it("merges into an existing folder instead of recreating it", async () => {
    const { io } = makeIO({ "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/": [{ name: "data", size: 0, kind: "folder" }] });
    const tree: DroppedNode = { kind: "folder", name: "data", children: [fileNode("x.csv")] };
    const result = await runUploadPlan(ROOT, [tree], { resolve: () => "new_version" }, io);
    expect(io.createFolder).not.toHaveBeenCalled();
    expect(result.confirmed).toBe(1);
  });

  it("skips a conflicting file when the policy says skip", async () => {
    const { io } = makeIO({ "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/": [{ name: "a.txt", size: 5, kind: "file" }] });
    const result = await runUploadPlan(ROOT, [fileNode("a.txt")], { resolve: () => "skip" }, io);
    expect(result.skipped).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(io.uploadFile).not.toHaveBeenCalled();
  });

  it("overwrites a conflicting file (new version) when the policy says new_version", async () => {
    const { io } = makeIO({ "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/": [{ name: "a.txt", size: 5, kind: "file" }] });
    const result = await runUploadPlan(ROOT, [fileNode("a.txt")], { resolve: () => "new_version" }, io);
    expect(io.uploadFile).toHaveBeenCalledWith(expect.anything(), expect.anything(), { overwrite: true });
    expect(result.confirmed).toBe(1);
  });

  it("marks a file FAILED when verification cannot find it after upload", async () => {
    const { io } = makeIO();
    // uploadFile succeeds but does NOT add to the store → verification fails.
    io.uploadFile = vi.fn(async () => {});
    const result = await runUploadPlan(ROOT, [fileNode("ghost.txt")], { resolve: () => "new_version" }, io);
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]!.status).toBe("failed");
    expect(result.outcomes[0]!.detail).toMatch(/verif/i);
  });

  it("retries a transient upload error then confirms", async () => {
    const { io } = makeIO();
    const real = io.uploadFile;
    let calls = 0;
    io.uploadFile = vi.fn(async (t, f, o) => {
      calls += 1;
      if (calls === 1) { const e = new Error("503"); (e as { status?: number }).status = 503; throw e; }
      return real(t, f, o);
    });
    const result = await runUploadPlan(ROOT, [fileNode("a.txt")], { resolve: () => "new_version" }, io, { sleep: async () => {} });
    expect(result.confirmed).toBe(1);
    expect(io.uploadFile).toHaveBeenCalledTimes(2);
  });

  it("marks descendants FAILED when their parent folder cannot be created", async () => {
    const { io } = makeIO();
    io.createFolder = vi.fn(async () => { const e = new Error("403"); (e as { status?: number }).status = 403; throw e; });
    const tree: DroppedNode = { kind: "folder", name: "data", children: [fileNode("x.csv"), fileNode("y.csv")] };
    const result = await runUploadPlan(ROOT, [tree], { resolve: () => "new_version" }, io, { sleep: async () => {} });
    expect(result.failed).toBe(2);
    expect(result.outcomes.every((o) => /parent folder/i.test(o.detail ?? ""))).toBe(true);
  });
});
