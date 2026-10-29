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

    const { entries: all, truncated } = await fetchAllProjectEntries("p");
    expect(truncated).toBe(false);
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
    // d-3fadc2: hitting the cap used to THROW, and the search caught that as "[]" — a
    // truncated walk then read as "no files match". It now returns what it walked and says
    // it stopped early.
    const out = await fetchAllProjectEntries("big", { maxEntries: 5 });
    expect(out.entries).toHaveLength(5);
    expect(out.truncated).toBe(true);
  });

  it("lists sibling folders in parallel, bounded (d-bd150b: a serial walk took 8.5 s on 3kmr9)", async () => {
    let inFlight = 0;
    let peak = 0;
    const folder = (n: number) => ({
      id: `d${n}`, type: "files",
      attributes: { name: `d${n}`, kind: "folder", materialized_path: `/d${n}/` },
      relationships: { files: { links: { related: { href: `https://api.osf.io/v2/nodes/par/files/osfstorage/d${n}/` } } } },
    });
    server.use(
      http.get("https://api.osf.io/v2/nodes/par/files/", () =>
        HttpResponse.json({
          data: [{
            id: "osfstorage", type: "files",
            attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/par/files/osfstorage/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/par/files/osfstorage/", () =>
        HttpResponse.json({ data: Array.from({ length: 8 }, (_, i) => folder(i)), links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/par/files/osfstorage/:d/", async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return HttpResponse.json({ data: [], links: { next: null } });
      }),
    );
    const out = await fetchAllProjectEntries("par", { concurrency: 3 });
    expect(out.entries.filter((e) => e.kind === "folder")).toHaveLength(8);
    expect(peak).toBeGreaterThan(1); // parallel, not serial
    expect(peak).toBeLessThanOrEqual(3); // and bounded, so OSF is not flooded
  });
});
