/**
 * The plan route must hand the browser a URL the browser can fetch.
 *
 * This is the seam the 2026-08-14 failure lived in. `waterbutlerDownloadUrl` can be
 * perfectly correct and fully unit-tested while the route keeps passing OSF's
 * `links.download` straight through — which is exactly what happened, and every file in a
 * 79-file export failed with "NetworkError when attempting to fetch resource".
 *
 * So this asserts the value that actually reaches the client, not the helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/transition/guard", () => ({
  requireTransitionActor: vi.fn(),
  guardResponse: (r: { status: number; error: string }) =>
    Response.json({ error: r.error }, { status: r.status }),
}));
vi.mock("@/lib/osf/nodes", () => ({
  getNode: vi.fn(),
  // The plan covers components since v1.12. Both default to empty here so these tests keep
  // testing the one thing they are about: the URL handed to the browser.
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
    { name: "osfstorage", listingUrl: "https://api.osf.io/v2/nodes/gf8rc/files/osfstorage/" },
  ] as never);
});

describe("GET /api/transition/plan/[guid] — the download URL", () => {
  it("gives the browser a Waterbutler ?direct= URL, never osf.io/download", async () => {
    vi.mocked(getFolderContents).mockResolvedValue([
      {
        kind: "file",
        id: "f1",
        name: "data.csv",
        size: 10,
        modified: "",
        materializedPath: "/data.csv",
        // What OSF actually returns — and what the code used to pass straight through.
        downloadUrl: "https://osf.io/download/bq7z2/",
        provider: "osfstorage",
        providerPath: "/659f816ef2240f03a732e177",
        md5: "a".repeat(32),
        sha256: "b".repeat(64),
      },
    ] as never);

    const body = await (await call()).json();
    const url: string = body.files[0].downloadUrl;

    expect(url).toBe(
      "https://files.osf.io/v1/resources/gf8rc/providers/osfstorage/659f816ef2240f03a732e177?direct=",
    );
    // The specific thing that broke every export.
    expect(url).not.toContain("osf.io/download");
  });

  it("keeps the provider, so add-on files are not fetched as osfstorage", async () => {
    vi.mocked(getFolderContents).mockResolvedValue([
      {
        kind: "file",
        id: "f2",
        name: "remote.txt",
        size: 5,
        modified: "",
        materializedPath: "/remote.txt",
        downloadUrl: "https://osf.io/download/zzz/",
        provider: "dropbox",
        providerPath: "/remote.txt",
        md5: null,
        sha256: null,
      },
    ] as never);

    const body = await (await call()).json();
    expect(body.files[0].downloadUrl).toContain("/providers/dropbox/");
  });

  it("plans a file OSF gave no provider for with an EMPTY url, so it fails loudly", async () => {
    // Dropping it would produce an export that looks complete and is not. An empty URL is
    // refused by stageFile with a message naming the cause, and reconcile() counts it.
    vi.mocked(getFolderContents).mockResolvedValue([
      {
        kind: "file",
        id: "f3",
        name: "mystery.bin",
        size: 5,
        modified: "",
        materializedPath: "/mystery.bin",
        downloadUrl: "https://osf.io/download/zzz/",
        md5: null,
        sha256: null,
      },
    ] as never);

    const body = await (await call()).json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].downloadUrl).toBe("");
  });
});
