import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { fetchAllProjectEntries } from "@/lib/osf/files-recursive";

describe("fetchAllProjectEntries", () => {
  it("walks all folders depth-first and returns a flat list", async () => {
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
            { id: "f1", type: "files", attributes: { name: "top.csv", kind: "file", materialized_path: "/top.csv", size: 10, modified: "" }, links: { download: "https://files.osf.io/v1/resources/p/providers/osfstorage/f1" }, relationships: {} },
            { id: "fold", type: "files", attributes: { name: "sub", kind: "folder", materialized_path: "/sub/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/p/files/osfstorage/fold/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/p/files/osfstorage/fold/", () =>
        HttpResponse.json({
          data: [
            { id: "f2", type: "files", attributes: { name: "deep.txt", kind: "file", materialized_path: "/sub/deep.txt", size: 5, modified: "" }, links: { download: "https://files.osf.io/v1/resources/p/providers/osfstorage/f2" }, relationships: {} },
          ],
          links: { next: null },
        })
      ),
    );

    const all = await fetchAllProjectEntries("p");
    const names = all.map((e) => `${e.provider}:${e.materializedPath}`);
    expect(names).toContain("osfstorage:/top.csv");
    expect(names).toContain("osfstorage:/sub/");
    expect(names).toContain("osfstorage:/sub/deep.txt");
  });

  it("respects maxEntries safety cap", async () => {
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
            id: `f${i}`, type: "files",
            attributes: { name: `f${i}.txt`, kind: "file", materialized_path: `/f${i}.txt`, size: 1, modified: "" },
            links: { download: `https://files.osf.io/v1/resources/big/providers/osfstorage/f${i}` },
            relationships: {},
          })),
          links: { next: null },
        })
      ),
    );
    await expect(fetchAllProjectEntries("big", { maxEntries: 5 })).rejects.toThrow(/maxEntries/);
  });
});
