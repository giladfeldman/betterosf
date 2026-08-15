/**
 * OSF names a filesystem cannot write.
 *
 * Measured 2026-08-14 on a throwaway private project. OSF **rejects** the traversal cases —
 * `..` and `../escape.txt` as file names, and `..`, `a\b`, `we<ird>` as FOLDER names, all
 * 400 — so a path segment can never be poisoned and a Zenodo draft cannot be bricked that
 * way. Saying otherwise was the overstatement an earlier writeup made.
 *
 * But these were all accepted with **201** and listed back verbatim as FILE names:
 *
 *   a\b.txt      a backslash — becomes folder `a` + file `b.txt` on Windows extraction
 *   CON          a reserved device name — Windows cannot create the file at all
 *   we<ird>.txt  characters Windows forbids
 *   trailing.    OSF strips the trailing space; Windows then drops the dot
 *
 * Passed through untouched, the report says `verified` for a file the researcher's computer
 * cannot actually write. The fix renames — never drops — and records the original, because a
 * silent rename makes `osf_path` a false statement about where the file came from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/transition/guard", () => ({
  requireTransitionActor: vi.fn(),
  guardResponse: (r: { status: number; error: string }) =>
    Response.json({ error: r.error }, { status: r.status }),
}));
vi.mock("@/lib/osf/nodes", () => ({
  getNode: vi.fn(),
  getAllChildren: vi.fn().mockResolvedValue([]),
  getAllLinkedNodes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/osf/registrations", () => ({ getNodeRegistrations: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/osf/files", () => ({ getProviderRoots: vi.fn(), getFolderContents: vi.fn() }));
vi.mock("@/lib/osf/wikis", () => ({ getNodeWikis: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/osf/contributors", () => ({ getNodeContributors: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/osf/project-extras", () => ({
  getNodeIdentifiers: vi.fn().mockResolvedValue([]),
  findDoi: () => null,
  getNodeAddons: vi.fn().mockResolvedValue([]),
  getNodeLicense: vi.fn().mockResolvedValue(null),
}));

import { GET } from "@/app/api/transition/plan/[guid]/route";
import { requireTransitionActor } from "@/lib/transition/guard";
import { getProviderRoots, getFolderContents } from "@/lib/osf/files";
import { getNode } from "@/lib/osf/nodes";

const node = {
  id: "gf8rc",
  title: "A project",
  description: "",
  category: "project",
  public: true,
  tags: [],
  dateCreated: "2026-01-01T00:00:00",
  dateModified: "2026-01-02T00:00:00",
  osfUrl: "https://osf.io/gf8rc/",
  parentId: null,
  related: {} as never,
};

/** The names OSF really accepted, verbatim. */
const HOSTILE = ["a\\b.txt", "CON", "we<ird>.txt", "trailing.", "ordinary.csv"];

function entry(name: string, i: number) {
  return {
    kind: "file" as const,
    id: `f${i}`,
    name,
    size: 10,
    modified: "",
    materializedPath: `/${name}`,
    downloadUrl: "https://osf.io/download/x/",
    provider: "osfstorage",
    providerPath: `/prov${i}`,
    md5: "a".repeat(32),
    sha256: "b".repeat(64),
    listingUrl: "",
  };
}

function call() {
  return GET(new Request("http://localhost:4747/api/transition/plan/gf8rc"), {
    params: Promise.resolve({ guid: "gf8rc" }),
  });
}

beforeEach(() => {
  vi.mocked(requireTransitionActor).mockResolvedValue({
    ok: true,
    actor: { userId: "u1", osfUserId: "osf1" },
  });
  vi.mocked(getNode).mockResolvedValue(node);
  vi.mocked(getProviderRoots).mockResolvedValue([
    { name: "osfstorage", listingUrl: "listing" },
  ] as never);
  vi.mocked(getFolderContents).mockResolvedValue(HOSTILE.map(entry) as never);
});

describe("the plan never emits a path a filesystem cannot write", () => {
  it("rewrites the names OSF accepts but a filesystem rejects", async () => {
    const body = await (await call()).json();
    const byId = Object.fromEntries(
      body.files.map((f: { osfFileId: string; path: string }) => [f.osfFileId, f.path]),
    );

    // A backslash would become a folder separator on Windows, splitting one file into a
    // directory and silently restructuring the archive.
    expect(byId.f0).toBe("osfstorage/a-b.txt");
    expect(byId.f0).not.toContain("\\");
    // A reserved device name cannot be created on Windows at any path.
    expect(byId.f1).toBe("osfstorage/_CON");
    // Characters Windows forbids outright.
    expect(byId.f2).toBe("osfstorage/we-ird-.txt");
    expect(byId.f2).not.toMatch(/[<>]/);
    // A trailing dot is dropped silently by the filesystem, renaming the file behind the
    // researcher's back.
    expect(byId.f3).toBe("osfstorage/trailing");
  });

  it("leaves an ordinary name completely alone", async () => {
    const body = await (await call()).json();
    const ordinary = body.files.find((f: { osfFileId: string }) => f.osfFileId === "f4");
    expect(ordinary.path).toBe("osfstorage/ordinary.csv");
    // No osfPath key at all: absent means "used unchanged", which is what the report reads.
    expect(ordinary.osfPath).toBeUndefined();
  });

  it("records OSF's original name for every file it renamed, so nothing is silent", async () => {
    const body = await (await call()).json();
    const renamed = body.files.filter((f: { osfPath?: string }) => f.osfPath);

    expect(renamed.map((f: { osfPath: string }) => f.osfPath).sort()).toEqual(
      [
        "osfstorage/CON",
        "osfstorage/a\\b.txt",
        "osfstorage/trailing.",
        "osfstorage/we<ird>.txt",
      ].sort(),
    );
  });

  it("keeps every file — renaming, never dropping", async () => {
    const body = await (await call()).json();
    expect(body.files).toHaveLength(HOSTILE.length);
    expect(body.files.every((f: { path: string }) => f.path.length > 0)).toBe(true);
  });
});
