// End-to-end-ish test of the NEW upload path: runUploadPlan driving the REAL
// uploadFileDirect (browser→OSF PUT) over a 2-level folder tree, with OSF mocked.
// This is the check the unit tests couldn't give us — it exercises the exact
// "create folder on the server, then PUT files into it directly" composition that
// the user saw fail ("folders created, every file failed").

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runUploadPlan, type UploadIO } from "@/lib/upload/orchestrate";
import { uploadFileDirect, clearUploadToken } from "@/lib/upload/direct";
import type { DroppedNode, TreeUploadTarget } from "@/lib/upload/types";
import type { FileEntry } from "@/lib/osf/files";

const GUID = "ezcuj";
const ROOT: TreeUploadTarget = {
  guid: GUID,
  provider: "osfstorage",
  path: "/",
  name: "OSF Storage",
  listingUrl: `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`,
  uploadUrl: `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage/`,
  newFolderUrl: `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage/`,
};

function fileNode(name: string): DroppedNode {
  return { kind: "file", name, file: new File(["data"], name) };
}

/** In-memory OSF: server-side list/createFolder + REAL direct-PUT for uploadFile. */
function makeStoreIO(): UploadIO {
  const store: Record<string, FileEntry[]> = { [ROOT.listingUrl]: [] };
  return {
    list: async (t) => store[t.listingUrl] ?? [],
    createFolder: async (t, name) => {
      const childListing = `${t.listingUrl}${name}/`;
      const childWb = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage/${name}/`;
      (store[t.listingUrl] ??= []).push({
        kind: "folder", id: name, name,
        materializedPath: `${t.path}${name}/`,
        listingUrl: childListing, uploadUrl: childWb, newFolderUrl: childWb,
      });
      store[childListing] = [];
    },
    uploadFile: async (t, file, opts) => {
      await uploadFileDirect(t, file, opts); // real browser→OSF PUT (fetch mocked below)
      // Mirror OSF so the orchestrator's verify (re-list) finds the file.
      (store[t.listingUrl] ??= []).push({
        kind: "file", id: file.name, name: file.name, size: file.size,
        modified: "", materializedPath: `${t.path}${file.name}`, downloadUrl: "", md5: null, sha256: null,
      });
    },
  };
}

function mockOsfFetch(puts: string[], putStatus: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/osf/upload-token")) return Response.json({ token: "user-token", expiresAt: null });
    if (url.includes("files.osf.io")) { if (init?.method === "PUT") puts.push(url); return putStatus(); }
    if (url.includes("/api/files/")) return Response.json({ entries: [] }); // should NOT be hit (skipDuplicateCheck)
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

describe("nested-folder directory upload via the direct path", () => {
  beforeEach(() => { clearUploadToken(); vi.unstubAllGlobals(); });

  it("creates folders AND uploads every file (the regression the user hit)", async () => {
    const puts: string[] = [];
    mockOsfFetch(puts, () => Response.json({ data: { id: "f" } }));
    // Test 1/{a.txt, Test 4/{b.txt}} — mirrors the user's 2-level structure.
    const tree: DroppedNode = {
      kind: "folder", name: "Test 1",
      children: [fileNode("a.txt"), { kind: "folder", name: "Test 4", children: [fileNode("b.txt")] }],
    };
    const result = await runUploadPlan(ROOT, [tree], { resolve: () => "new_version" }, makeStoreIO());

    expect(result.failed).toBe(0);
    expect(result.confirmed).toBe(2);
    // Both files PUT directly to OSF, each into its OWN folder's Waterbutler upload URL
    // (OSF keys these by folder id, which the stub mirrors with the folder name).
    expect(puts.length).toBe(2);
    expect(puts.some((u) => u.includes("/osfstorage/Test%201/") && u.includes("name=a.txt"))).toBe(true);
    expect(puts.some((u) => u.includes("/osfstorage/Test%204/") && u.includes("name=b.txt"))).toBe(true);
  });

  it("does NOT issue a redundant per-file folder list (skipDuplicateCheck)", async () => {
    const puts: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/osf/upload-token")) return Response.json({ token: "t", expiresAt: null });
      if (url.includes("files.osf.io")) { if (init?.method === "PUT") puts.push(url); return Response.json({ data: {} }); }
      throw new Error(`unexpected fetch (a redundant list?): ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const tree: DroppedNode = { kind: "folder", name: "data", children: [fileNode("x.csv"), fileNode("y.csv")] };
    const result = await runUploadPlan(ROOT, [tree], { resolve: () => "new_version" }, makeStoreIO());
    expect(result.confirmed).toBe(2);
    // No /api/files/.../folder calls from direct.ts — only token + PUTs.
    expect(fetchSpy.mock.calls.every((c) => !String(c[0]).includes("/folder"))).toBe(true);
  });

  it("surfaces a real rate-limit body and retry-after when OSF 429s the PUT", async () => {
    const puts: string[] = [];
    let n = 0;
    mockOsfFetch(puts, () => {
      n += 1;
      return n === 1
        ? new Response("Too many requests. Please wait and try again.", { status: 429, headers: { "Retry-After": "1" } })
        : Response.json({ data: {} });
    });
    const result = await runUploadPlan(ROOT, [fileNode("c.txt")], { resolve: () => "new_version" }, makeStoreIO(), { sleep: async () => {} });
    // It self-recovers: first PUT 429s, retry honors Retry-After and succeeds.
    expect(result.confirmed).toBe(1);
    expect(result.failed).toBe(0);
    expect(puts.length).toBe(2);
  });
});
