/**
 * Regression: Next.js 15 catch-all segments arrive URL-ENCODED (e.g.
 * "PCIRR%20Stage%201") but the OSF API returns names DECODED
 * ("PCIRR Stage 1"). Every deep file/folder URL with a space (or any
 * %-encoded character) silently 404'd with "Folder not found" because the
 * server-side walk did `entries.find(e => e.name === seg)` against the
 * raw encoded segment.
 *
 * The fix: `decodeURIComponent` each path segment before string-matching.
 * These tests pin that behavior so the bug can't be reintroduced.
 *
 * We don't render the full page here (Next.js server-component rendering in
 * vitest is heavy); instead we extract the small walk function and test it
 * directly against MSW-stubbed OSF responses, mirroring the real code path.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";

// Mirrors the walk loop in /<guid>/files/view/[...path]/page.tsx so it stays
// in lockstep with the production code path. If page.tsx changes its walking
// shape, this helper must be updated too.
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

async function walkPath(guid: string, rawSegments: string[]): Promise<
  | { kind: "ok"; finalEntries: FileEntry[]; file?: FileEntry & { kind: "file" } }
  | { kind: "fail"; reason: "wrong-provider" | "missing-folder" | "missing-file" }
> {
  const decoded = rawSegments.map(safeDecode).filter((s) => s.length > 0);
  const [provider, ...rest] = decoded;
  const filename = rest[rest.length - 1] ?? "";
  const folderSegments = rest.slice(0, -1);

  const providers = await getProviderRoots(guid, { kind: "node" });
  const providerMatch = providers.find((p) => p.provider === provider);
  if (!providerMatch) return { kind: "fail", reason: "wrong-provider" };

  let listingUrl = providerMatch.listingUrl;
  let entries = await getFolderContents(listingUrl, guid);
  for (const seg of folderSegments) {
    const next = entries.find((e) => e.kind === "folder" && e.name === seg);
    if (!next || next.kind !== "folder") return { kind: "fail", reason: "missing-folder" };
    listingUrl = next.listingUrl;
    entries = await getFolderContents(listingUrl, guid);
  }
  if (!filename) return { kind: "ok", finalEntries: entries };
  const f = entries.find((e) => e.kind === "file" && e.name === filename);
  if (!f || f.kind !== "file") return { kind: "fail", reason: "missing-file" };
  return { kind: "ok", finalEntries: entries, file: f };
}

describe("path-segment URL decoding (Next.js 15 catch-all regression)", () => {
  function setupOsf() {
    server.use(
      http.get("https://api.osf.io/v2/nodes/3kmr9/files/", () =>
        HttpResponse.json({
          data: [
            {
              id: "3kmr9:osfstorage",
              type: "files",
              attributes: { kind: "folder", name: "osfstorage", provider: "osfstorage", path: "/" },
              relationships: {
                files: { links: { related: { href: "https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/" } } },
              },
            },
          ],
          links: { next: null },
        })
      ),
      // osfstorage root has two folders, both with literal spaces in name
      http.get("https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            {
              id: "stage1",
              type: "files",
              attributes: { kind: "folder", name: "PCIRR Stage 1", materialized_path: "/PCIRR Stage 1/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/stage1id/" } } } },
            },
            {
              id: "stage2",
              type: "files",
              attributes: { kind: "folder", name: "PCIRR Stage 2", materialized_path: "/PCIRR Stage 2/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/stage2id/" } } } },
            },
          ],
          links: { next: null },
        })
      ),
      // PCIRR Stage 1 has a Materials sub-folder
      http.get("https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/stage1id/", () =>
        HttpResponse.json({
          data: [
            {
              id: "mat",
              type: "files",
              attributes: { kind: "folder", name: "Materials", materialized_path: "/PCIRR Stage 1/Materials/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/matid/" } } } },
            },
          ],
          links: { next: null },
        })
      ),
      // Materials contains the file
      http.get("https://api.osf.io/v2/nodes/3kmr9/files/osfstorage/matid/", () =>
        HttpResponse.json({
          data: [
            {
              id: "f1",
              type: "files",
              attributes: { kind: "file", name: "Newman_et_al_2011_RE_Studies_12.pdf", size: 1000, modified: "", materialized_path: "/PCIRR Stage 1/Materials/Newman_et_al_2011_RE_Studies_12.pdf" },
              links: { download: "https://files.osf.io/d1" },
            },
          ],
          links: { next: null },
        })
      ),
    );
  }

  it("walks a deep file path whose segments arrive %20-encoded (the user's reported URL)", async () => {
    setupOsf();
    const out = await walkPath("3kmr9", [
      "osfstorage",
      "PCIRR%20Stage%201",
      "Materials",
      "Newman_et_al_2011_RE_Studies_12.pdf",
    ]);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.file?.kind).toBe("file");
      expect(out.file?.name).toBe("Newman_et_al_2011_RE_Studies_12.pdf");
    }
  });

  // Walks ALL segments as folders (mirrors the /<guid>/files/[...path] deep
  // folder route — no leaf filename).
  async function walkFolderPath(guid: string, rawSegments: string[]) {
    const decoded = rawSegments.map(safeDecode).filter((s) => s.length > 0);
    const [provider, ...folderSegments] = decoded;
    const providers = await getProviderRoots(guid, { kind: "node" });
    const providerMatch = providers.find((p) => p.provider === provider);
    if (!providerMatch) return { kind: "fail" as const, reason: "wrong-provider" as const };
    let listingUrl = providerMatch.listingUrl;
    let entries = await getFolderContents(listingUrl, guid);
    for (const seg of folderSegments) {
      const next = entries.find((e) => e.kind === "folder" && e.name === seg);
      if (!next || next.kind !== "folder") return { kind: "fail" as const, reason: "missing-folder" as const };
      listingUrl = next.listingUrl;
      entries = await getFolderContents(listingUrl, guid);
    }
    return { kind: "ok" as const, entries };
  }

  it("walks a deep folder path whose segments arrive %20-encoded", async () => {
    setupOsf();
    const out = await walkFolderPath("3kmr9", [
      "osfstorage",
      "PCIRR%20Stage%201",
      "Materials",
    ]);
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.entries.find((e) => e.name === "Newman_et_al_2011_RE_Studies_12.pdf")?.kind).toBe("file");
    }
  });

  it("works for paths with NO encoded segments (regression-free for the simple case)", async () => {
    setupOsf();
    const out = await walkPath("3kmr9", [
      "osfstorage",
      "PCIRR Stage 1",
      "Materials",
      "Newman_et_al_2011_RE_Studies_12.pdf",
    ]);
    expect(out.kind).toBe("ok");
  });

  it("fails with missing-folder (not wrong-provider) when an interior segment doesn't exist", async () => {
    setupOsf();
    const out = await walkPath("3kmr9", ["osfstorage", "PCIRR%20Stage%201", "DoesNotExist", "x.pdf"]);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.reason).toBe("missing-folder");
  });

  it("fails with missing-file when the leaf doesn't exist (even if folders all match)", async () => {
    setupOsf();
    const out = await walkPath("3kmr9", ["osfstorage", "PCIRR%20Stage%201", "Materials", "ghost.pdf"]);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.reason).toBe("missing-file");
  });

  it("fails with wrong-provider when the provider doesn't exist", async () => {
    setupOsf();
    const out = await walkPath("3kmr9", ["googledrive", "anything"]);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.reason).toBe("wrong-provider");
  });
});
