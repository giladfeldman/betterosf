/**
 * d-e058e3 (unknown-is-not-zero): a file OSF lists WITHOUT a size.
 *
 * The plan used to write `size: entry.size ?? 0`, so an unknown size became a declared
 * empty file. Downstream, staging compared the bytes it received against that 0 and
 * failed the file with "Staged N bytes but OSF declared 0. The download is incomplete." —
 * a false reason — and the report, crosswalk and RO-Crate printed 0 as its size.
 *
 * The plan now never emits an invented size: such a file is listed in `unsizedFiles`, and
 * `fetchExtras` turns each one into a reconcile() blocker that names it, so the run reads
 * INCOMPLETE for the true reason and the file is never described as 0 bytes.
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
import { fetchExtras } from "@/components/transition/plan-extras";
import type { PlanResponse } from "@/components/transition/plan-types";

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

const sizes: (number | null)[] = [null, 12];

function entry(size: number | null, i: number) {
  return {
    kind: "file" as const,
    id: `f${i}`,
    name: `file${i}.csv`,
    size,
    modified: "",
    materializedPath: `/file${i}.csv`,
    downloadUrl: "https://osf.io/download/x/",
    provider: "googledrive",
    providerPath: `/prov${i}`,
    md5: null,
    sha256: null,
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
    { name: "googledrive", listingUrl: "listing" },
  ] as never);
  vi.mocked(getFolderContents).mockResolvedValue(sizes.map(entry) as never);
});

describe("a file OSF reports no size for is never planned as a 0-byte file (d-e058e3)", () => {
  it("does not put an invented size of 0 in the plan", async () => {
    const body = await (await call()).json();
    const unknown = body.files.find((f: { osfFileId: string }) => f.osfFileId === "f0");
    // Either absent from the transferable files, or present with a non-zero-claiming size —
    // never `0`, which every consumer reads as "declared empty".
    expect(unknown?.size).not.toBe(0);
    expect(body.unsizedFiles).toEqual([{ osfFileId: "f0", path: "googledrive/file0.csv" }]);
  });

  it("control: a file with a real size is planned with that size", async () => {
    const body = await (await call()).json();
    const known = body.files.find((f: { osfFileId: string }) => f.osfFileId === "f1");
    expect(known.size).toBe(12);
  });

  it("each unsized file becomes a blocker naming it, so the run cannot reconcile complete", async () => {
    const plan = { guid: "gf8rc", wikis: [], contributors: [], unsizedFiles: [{ osfFileId: "f0", path: "googledrive/file0.csv" }] };
    const { missing } = await fetchExtras(plan as unknown as PlanResponse);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/googledrive\/file0\.csv/);
    expect(missing[0]).toMatch(/did not report a size/i);
  });

  it("control: no unsized files, no blocker", async () => {
    const { missing } = await fetchExtras({ guid: "gf8rc", wikis: [], contributors: [] } as unknown as PlanResponse);
    expect(missing).toEqual([]);
  });
});
