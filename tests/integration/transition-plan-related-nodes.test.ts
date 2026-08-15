/**
 * The plan route across MORE THAN ONE node.
 *
 * An export used to cover the root project and nothing else, silently — a project with six
 * components exported as a copy of a seventh of itself, and `reconcile()` called it
 * complete because it reconciles against a plan that never mentioned them.
 *
 * The two things that must never regress:
 *   1. A failed lookup is `null`, never `[]`. "We could not find out whether this project
 *      has components" and "this project has no components" are different statements, and
 *      the second one is the dangerous one to make by accident.
 *   2. A guid the caller asked for that is not on this project is REFUSED, not walked.
 *      Otherwise the plan endpoint is a way to bundle arbitrary OSF nodes into somebody
 *      else's deposit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/transition/guard", () => ({
  requireTransitionActor: vi.fn(),
  guardResponse: (r: { status: number; error: string }) =>
    Response.json({ error: r.error }, { status: r.status }),
}));
vi.mock("@/lib/osf/nodes", () => ({
  getNode: vi.fn(),
  getAllChildren: vi.fn(),
  getAllLinkedNodes: vi.fn(),
}));
vi.mock("@/lib/osf/files", () => ({ getProviderRoots: vi.fn(), getFolderContents: vi.fn() }));
vi.mock("@/lib/osf/wikis", () => ({ getNodeWikis: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/osf/contributors", () => ({ getNodeContributors: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/osf/registrations", () => ({ getNodeRegistrations: vi.fn() }));
vi.mock("@/lib/osf/project-extras", () => ({
  getNodeIdentifiers: vi.fn().mockResolvedValue([]),
  findDoi: () => null,
  getNodeAddons: vi.fn().mockResolvedValue([]),
  getNodeLicense: vi.fn().mockResolvedValue(null),
}));

import { GET } from "@/app/api/transition/plan/[guid]/route";
import { requireTransitionActor } from "@/lib/transition/guard";
import { getProviderRoots, getFolderContents } from "@/lib/osf/files";
import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";

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

/** One file per node, named after the node, so paths are traceable in assertions. */
function fileFor(guid: string) {
  return {
    kind: "file" as const,
    id: `file-${guid}`,
    name: `${guid}.csv`,
    size: 10,
    modified: "",
    materializedPath: `/${guid}.csv`,
    downloadUrl: "https://osf.io/download/x/",
    provider: "osfstorage",
    providerPath: `/prov-${guid}`,
    md5: "a".repeat(32),
    sha256: "b".repeat(64),
    listingUrl: "",
  };
}

function call(query = "") {
  return GET(new Request(`http://localhost:4747/api/transition/plan/gf8rc${query}`), {
    params: Promise.resolve({ guid: "gf8rc" }),
  });
}

beforeEach(() => {
  vi.mocked(requireTransitionActor).mockResolvedValue({
    ok: true,
    actor: { userId: "u1", osfUserId: "osf1" },
  });
  vi.mocked(getNode).mockResolvedValue(node);
  // Root has one child, which itself has one child — components nest.
  vi.mocked(getAllChildren).mockImplementation(async (guid: string) => {
    if (guid === "gf8rc") return [{ id: "kid01", title: "Analysis" }] as never;
    if (guid === "kid01") return [{ id: "kid02", title: "Deep / nested" }] as never;
    return [] as never;
  });
  vi.mocked(getAllLinkedNodes).mockResolvedValue([{ id: "lnk01", title: "Someone else" }] as never);
  vi.mocked(getNodeRegistrations).mockResolvedValue([
    { id: "reg01", title: "Preregistration", dateRegistered: "2025-05-05T00:00:00", public: true, osfUrl: "" },
  ] as never);
  vi.mocked(getProviderRoots).mockImplementation(
    async (guid: string) =>
      [{ name: "osfstorage", listingUrl: `listing:${guid}` }] as never,
  );
  vi.mocked(getFolderContents).mockImplementation(async (listingUrl: string) => {
    const guid = listingUrl.replace("listing:", "");
    return [fileFor(guid)] as never;
  });
});

describe("GET /api/transition/plan/[guid] — components and registrations", () => {
  it("includes every component by default, and nothing else", async () => {
    const body = await (await call()).json();

    expect(body.included.map((i: { guid: string }) => i.guid).sort()).toEqual(["kid01", "kid02"]);
    expect(body.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "components/kid01-Analysis/osfstorage/kid01.csv",
      "components/kid02-Deep - nested/osfstorage/kid02.csv",
      "osfstorage/gf8rc.csv",
    ]);
    // Registrations and linked projects are OFFERED, not taken.
    expect(body.registrations.map((r: { guid: string }) => r.guid)).toEqual(["reg01"]);
    expect(body.linkedProjects.map((l: { guid: string }) => l.guid)).toEqual(["lnk01"]);
    expect(body.rootFileCount).toBe(1);
  });

  it("treats an EMPTY include as 'root only', not as 'first load'", async () => {
    const body = await (await call("?include=")).json();
    expect(body.included).toEqual([]);
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(["osfstorage/gf8rc.csv"]);
    expect(body.rootFileCount).toBe(1);
  });

  it("reads a registration through the registration endpoint, never the node one", async () => {
    const body = await (await call("?include=reg01")).json();

    expect(vi.mocked(getProviderRoots)).toHaveBeenCalledWith("reg01", { kind: "registration" });
    expect(body.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "osfstorage/gf8rc.csv",
      "registrations/reg01-Preregistration/osfstorage/reg01.csv",
    ]);
  });

  it("stamps each file with the node it actually came from", async () => {
    const body = await (await call("?include=kid01")).json();
    const byPath = Object.fromEntries(
      body.files.map((f: { path: string; sourceGuid: string }) => [f.path, f.sourceGuid]),
    );
    expect(byPath["osfstorage/gf8rc.csv"]).toBe("gf8rc");
    expect(byPath["components/kid01-Analysis/osfstorage/kid01.csv"]).toBe("kid01");
  });

  it("refuses a guid that is not on this project instead of walking it", async () => {
    const body = await (await call("?include=zzzzz")).json();
    expect(body.unknownNodes).toEqual(["zzzzz"]);
    expect(body.included).toEqual([]);
    expect(vi.mocked(getProviderRoots)).not.toHaveBeenCalledWith("zzzzz", expect.anything());
  });

  it("reports a node it could not read rather than dropping it", async () => {
    vi.mocked(getProviderRoots).mockImplementation(async (guid: string) => {
      if (guid === "kid01") throw new Error("OSF said 403");
      return [{ name: "osfstorage", listingUrl: `listing:${guid}` }] as never;
    });
    const body = await (await call("?include=kid01")).json();

    expect(body.included).toHaveLength(1);
    expect(body.included[0].error).toMatch(/403/);
    expect(body.included[0].fileCount).toBe(0);
  });

  it("says null, not empty, when the component lookup itself failed", async () => {
    vi.mocked(getAllChildren).mockRejectedValue(new Error("OSF is down"));
    const body = await (await call()).json();

    // `[]` here would tell a researcher this project has no components. It does.
    expect(body.components).toBeNull();
    expect(body.included).toEqual([]);
  });

  it("keeps a component's files from colliding with the root's", async () => {
    // Both nodes serve a file with the SAME name — the case where a flat merge would have
    // one silently overwrite the other in the archive and on Zenodo.
    vi.mocked(getFolderContents).mockResolvedValue([
      { ...fileFor("same"), id: "shared", name: "data.csv" },
    ] as never);
    const body = await (await call("?include=kid01")).json();

    const paths = body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(["components/kid01-Analysis/osfstorage/data.csv", "osfstorage/data.csv"]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
