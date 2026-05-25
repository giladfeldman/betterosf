import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";

describe("collectFolderSkeleton", () => {
  it("walks all providers' folder-only structure depth-first", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/p/files/", () =>
        HttpResponse.json({
          data: [{
            id: "osfstorage", type: "files",
            attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/p/files/osfstorage/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/p/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            { id: "f1", type: "files", attributes: { name: "data.csv", kind: "file", materialized_path: "/data.csv", size: 10, modified: "" }, links: { download: "x" }, relationships: {} },
            { id: "fold", type: "files", attributes: { name: "sub", kind: "folder", materialized_path: "/sub/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/p/files/osfstorage/fold/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/p/files/osfstorage/fold/", () =>
        HttpResponse.json({
          data: [
            { id: "g1", type: "files", attributes: { name: "deeper", kind: "folder", materialized_path: "/sub/deeper/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/p/files/osfstorage/fold/deeper/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/p/files/osfstorage/fold/deeper/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );

    const skeleton = await collectFolderSkeleton("p");
    expect(skeleton).toHaveLength(1);
    expect(skeleton[0]?.name).toBe("osfstorage");
    expect(skeleton[0]?.children).toHaveLength(1); // 'sub' folder, NOT 'data.csv' file
    expect(skeleton[0]?.children?.[0]?.name).toBe("sub");
    expect(skeleton[0]?.children?.[0]?.children?.[0]?.name).toBe("deeper");
  });

  it("respects maxFolders cap", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/big/files/", () =>
        HttpResponse.json({
          data: [{
            id: "osfstorage", type: "files",
            attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/big/files/osfstorage/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/big/files/osfstorage/", () =>
        HttpResponse.json({
          data: Array.from({ length: 10 }).map((_, i) => ({
            id: `fold${i}`, type: "files",
            attributes: { name: `f${i}`, kind: "folder", materialized_path: `/f${i}/` },
            relationships: { files: { links: { related: { href: `https://api.osf.io/v2/nodes/big/files/osfstorage/fold${i}/` } } } },
          })),
          links: { next: null },
        })
      ),
      ...Array.from({ length: 10 }).map((_, i) =>
        http.get(`https://api.osf.io/v2/nodes/big/files/osfstorage/fold${i}/`, () =>
          HttpResponse.json({ data: [], links: { next: null } })
        )
      ),
    );

    await expect(collectFolderSkeleton("big", { maxFolders: 5 })).rejects.toThrow(/maxFolders/);
  });
});
