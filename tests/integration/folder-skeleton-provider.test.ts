import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";

/**
 * Regression: prior to commit 83cd360, `provider` was only set on first-level
 * SkeletonNodes (via .map at the caller). Grandchildren + deeper were left with
 * provider="". This caused tree-row keys + icons + viewer hrefs deeper than the
 * provider root to misbehave.
 */
describe("collectFolderSkeleton — provider propagation", () => {
  it("sets node.provider on grandchildren and great-grandchildren", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/deep/files/", () =>
        HttpResponse.json({
          data: [{
            id: "googledrive", type: "files",
            attributes: { name: "googledrive", provider: "googledrive", kind: "folder", path: "/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deep/files/googledrive/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deep/files/googledrive/", () =>
        HttpResponse.json({
          data: [{
            id: "L1", type: "files",
            attributes: { name: "l1", kind: "folder", materialized_path: "/l1/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deep/files/googledrive/L1/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deep/files/googledrive/L1/", () =>
        HttpResponse.json({
          data: [{
            id: "L2", type: "files",
            attributes: { name: "l2", kind: "folder", materialized_path: "/l1/l2/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deep/files/googledrive/L1/L2/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deep/files/googledrive/L1/L2/", () =>
        HttpResponse.json({
          data: [{
            id: "L3", type: "files",
            attributes: { name: "l3", kind: "folder", materialized_path: "/l1/l2/l3/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deep/files/googledrive/L1/L2/L3/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deep/files/googledrive/L1/L2/L3/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );

    const skeleton = await collectFolderSkeleton("deep", { maxDepth: 8 });
    expect(skeleton).toHaveLength(1);
    const root = skeleton[0]!;
    expect(root.provider).toBe("googledrive");
    const l1 = root.children[0]!;
    expect(l1.name).toBe("l1");
    expect(l1.provider).toBe("googledrive");
    const l2 = l1.children[0]!;
    expect(l2.name).toBe("l2");
    expect(l2.provider).toBe("googledrive");
    const l3 = l2.children[0]!;
    expect(l3.name).toBe("l3");
    expect(l3.provider).toBe("googledrive");
  });

  it("one provider's listing 404 does not blank the whole skeleton (regression: c97pd github addon 404)", async () => {
    // Real-world repro: registration c97pd exposes an osfstorage provider with
    // two PDFs AND a github provider whose listing 404s (deauthorized/empty
    // addon). Before the fix, the github 404 threw out of the provider loop and
    // collectResourceTree's `.catch(() => [])` blanked the ENTIRE tree, so the
    // valid osfstorage files vanished too.
    server.use(
      http.get("https://api.osf.io/v2/registrations/c97pd/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/registrations/c97pd/files/osfstorage/" } } } } },
            { id: "github", type: "files", attributes: { name: "github", provider: "github", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/registrations/c97pd/files/github/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/registrations/c97pd/files/osfstorage/", () =>
        HttpResponse.json({
          data: [{ id: "P", type: "files", attributes: { name: "ML2_-_Protocol.pdf", kind: "file", size: 659858, materialized_path: "/ML2_-_Protocol.pdf" }, links: { download: "https://x/download" } }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/registrations/c97pd/files/github/", () =>
        HttpResponse.json({ errors: [{ detail: "Not found." }] }, { status: 404 })
      ),
    );

    const skeleton = await collectFolderSkeleton("c97pd", { kind: "registration" });
    const os = skeleton.find((s) => s.provider === "osfstorage");
    expect(os).toBeDefined();
    expect(os!.fileCount).toBe(1);
    // The broken github provider must not have aborted the walk.
    expect(skeleton.some((s) => s.provider === "osfstorage")).toBe(true);
  });

  it("a deep subfolder listing 404 yields an empty folder, not a lost provider", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/deepfail/files/", () =>
        HttpResponse.json({
          data: [{ id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deepfail/files/osfstorage/" } } } } }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deepfail/files/osfstorage/", () =>
        HttpResponse.json({
          data: [{ id: "Sub", type: "files", attributes: { name: "broken", kind: "folder", materialized_path: "/broken/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/deepfail/files/osfstorage/Sub/" } } } } }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/deepfail/files/osfstorage/Sub/", () =>
        HttpResponse.json({ errors: [{ detail: "Not found." }] }, { status: 404 })
      ),
    );

    const skeleton = await collectFolderSkeleton("deepfail", { maxDepth: 4 });
    expect(skeleton).toHaveLength(1);
    expect(skeleton[0]!.provider).toBe("osfstorage");
    const broken = skeleton[0]!.children.find((c) => c.name === "broken");
    expect(broken).toBeDefined();
    expect(broken!.children).toEqual([]);
  });

  it("each provider's subtree carries its own provider name (no leakage between providers)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/mix/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/mix/files/osfstorage/" } } } } },
            { id: "github", type: "files", attributes: { name: "github", provider: "github", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/mix/files/github/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/mix/files/osfstorage/", () =>
        HttpResponse.json({
          data: [{ id: "Os", type: "files", attributes: { name: "deep-os", kind: "folder", materialized_path: "/deep-os/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/mix/files/osfstorage/Os/" } } } } }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/mix/files/osfstorage/Os/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/mix/files/github/", () =>
        HttpResponse.json({
          data: [{ id: "Gh", type: "files", attributes: { name: "deep-gh", kind: "folder", materialized_path: "/deep-gh/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/mix/files/github/Gh/" } } } } }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/mix/files/github/Gh/", () => HttpResponse.json({ data: [], links: { next: null } })),
    );

    const skeleton = await collectFolderSkeleton("mix");
    const os = skeleton.find((s) => s.provider === "osfstorage")!;
    const gh = skeleton.find((s) => s.provider === "github")!;
    expect(os.children[0]?.provider).toBe("osfstorage");
    expect(gh.children[0]?.provider).toBe("github");
  });
});
