import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { searchNodes, searchFiles, searchRegistrations, searchUsers, searchFilesInProjectScope } from "@/lib/osf/search";

describe("searchNodes", () => {
  it("returns parsed nodes + total + hasMore", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("filter[title]")).toBe("replication");
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("page[size]")).toBe("20");
        return HttpResponse.json({
          data: [
            { id: "p1", type: "nodes", attributes: { title: "Replication study", public: true, tags: [], category: "project" }, relationships: {}, links: { html: "https://osf.io/p1/" } },
          ],
          links: { next: "https://api.osf.io/v2/nodes/?page=3" },
          meta: { total: 47, per_page: 20 },
        });
      })
    );
    const out = await searchNodes("replication", { page: 2 });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.id).toBe("p1");
    expect(out.total).toBe(47);
    expect(out.hasMore).toBe(true);
  });

  it("returns empty + hasMore false when no results", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/", () =>
        HttpResponse.json({ data: [], links: { next: null }, meta: { total: 0 } })
      )
    );
    const out = await searchNodes("xyzqq");
    expect(out.results).toHaveLength(0);
    expect(out.total).toBe(0);
    expect(out.hasMore).toBe(false);
  });
});

describe("searchFiles", () => {
  it("uses /v2/search/files/?q= (filter[name]= was 404'ing for nearly all queries)", async () => {
    // Regression: OSF's /v2/files/?filter[name]= returns 404 for almost every
    // query (including common ones like "raw" or ".qsf"), so we use the
    // dedicated /v2/search/files/?q= endpoint instead. If this test starts
    // hitting /v2/files/ again, we've reintroduced the bug.
    server.use(
      http.get("https://api.osf.io/v2/search/files/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("raw.csv");
        return HttpResponse.json({
          data: [
            {
              id: "f1", type: "files",
              attributes: { name: "raw.csv", kind: "file", size: 1024, materialized_path: "/data/raw.csv", date_modified: "2024-01-01" },
              links: { download: "https://files.osf.io/v1/resources/p1/providers/osfstorage/f1" },
              relationships: { target: { data: { id: "p1", type: "nodes" } } },
            },
          ],
          links: { next: null },
          meta: { total: 1 },
        });
      })
    );
    const out = await searchFiles("raw.csv");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.name).toBe("raw.csv");
    expect(out.results[0]?.nodeId).toBe("p1");
    expect(out.results[0]?.downloadUrl).toContain("files.osf.io");
  });

  it("handles dotted/extension-style queries like .qsf without 404ing", async () => {
    server.use(
      http.get("https://api.osf.io/v2/search/files/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe(".qsf");
        return HttpResponse.json({
          data: [
            {
              id: "q1", type: "files",
              attributes: { name: "Study1.qsf", kind: "file", size: 2048, materialized_path: "/Study1.qsf", date_modified: "2025-06-01" },
              links: { download: "https://files.osf.io/v1/resources/abc/providers/osfstorage/q1" },
              relationships: { target: { data: { id: "abc", type: "nodes" } } },
            },
          ],
          links: { next: null },
          meta: { total: 1 },
        });
      })
    );
    const out = await searchFiles(".qsf");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.name).toBe("Study1.qsf");
  });

  it("normalizes extension quick searches like MP4 OR MP3 to dotted lowercase terms", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.osf.io/v2/search/files/", ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.searchParams.get("q") ?? "");
        const q = url.searchParams.get("q");
        return HttpResponse.json({
          data: q === ".mp4"
            ? [{
                id: "v1", type: "files",
                attributes: { name: "lecture.MP4", kind: "file", size: 10, materialized_path: "/lecture.MP4", date_modified: "2026-01-01" },
                links: { download: "https://files.osf.io/v1/resources/p1/providers/osfstorage/v1" },
                relationships: { target: { data: { id: "p1", type: "nodes" } } },
              }]
            : [{
                id: "a1", type: "files",
                attributes: { name: "audio.mp3", kind: "file", size: 10, materialized_path: "/audio.mp3", date_modified: "2026-01-01" },
                links: { download: "https://files.osf.io/v1/resources/p1/providers/osfstorage/a1" },
                relationships: { target: { data: { id: "p1", type: "nodes" } } },
              }],
          links: { next: null },
          meta: { total: 1 },
        });
      })
    );

    const out = await searchFiles("MP4 or MP3");
    expect(seen).toEqual([".mp4", ".mp3"]);
    expect(out.results.map((f) => f.name).sort()).toEqual(["audio.mp3", "lecture.MP4"]);
  });
});

describe("searchRegistrations", () => {
  it("returns registrations with title + date_registered", async () => {
    server.use(
      http.get("https://api.osf.io/v2/registrations/", () =>
        HttpResponse.json({
          data: [
            { id: "r1", type: "registrations", attributes: { title: "Pre-reg", date_registered: "2020-01-01T00:00:00Z", public: true }, links: { html: "https://osf.io/r1/" } },
          ],
          links: { next: null },
          meta: { total: 1 },
        })
      )
    );
    const out = await searchRegistrations("pre");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.title).toBe("Pre-reg");
    expect(out.results[0]?.dateRegistered).toBe("2020-01-01T00:00:00Z");
  });
});

describe("searchUsers", () => {
  it("returns users with full_name + id", async () => {
    server.use(
      http.get("https://api.osf.io/v2/users/", () =>
        HttpResponse.json({
          data: [
            { id: "u1", type: "users", attributes: { full_name: "Ada Lovelace" }, links: { html: "https://osf.io/u1/" } },
          ],
          links: { next: null },
          meta: { total: 1 },
        })
      )
    );
    const out = await searchUsers("ada");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ id: "u1", fullName: "Ada Lovelace", osfUrl: "https://osf.io/u1/" });
  });
});

describe("searchFilesInProjectScope", () => {
  it("recursively walks root project and child components", async () => {
    server.use(
      // Root project children (components)
      http.get("https://api.osf.io/v2/nodes/root1/children/", () =>
        HttpResponse.json({
          data: [
            { id: "comp1", type: "nodes", attributes: { title: "Sub Component 1", category: "project", public: true } }
          ],
          links: { next: null }
        })
      ),
      // Root project files provider root
      http.get("https://api.osf.io/v2/nodes/root1/files/", () =>
        HttpResponse.json({
          data: [
            { id: "prov1", type: "files", attributes: { name: "osfstorage", kind: "folder", materialized_path: "/", provider: "osfstorage" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/root1/files/osfstorage/" } } } } }
          ],
          links: { next: null }
        })
      ),
      // Root project folder contents (prov1 has a matching file)
      http.get("https://api.osf.io/v2/nodes/root1/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            { id: "f_root", type: "files", attributes: { name: "root_video.mp4", kind: "file", materialized_path: "/root_video.mp4" }, links: { download: "https://files.osf.io/v1/root_video" } }
          ],
          links: { next: null }
        })
      ),
      // Component files provider root
      http.get("https://api.osf.io/v2/nodes/comp1/files/", () =>
        HttpResponse.json({
          data: [
            { id: "prov2", type: "files", attributes: { name: "osfstorage", kind: "folder", materialized_path: "/", provider: "osfstorage" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/comp1/files/osfstorage/" } } } } }
          ],
          links: { next: null }
        })
      ),
      // Component folder contents (has a matching mp4 file)
      http.get("https://api.osf.io/v2/nodes/comp1/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            { id: "f_comp", type: "files", attributes: { name: "comp_lecture.mp4", kind: "file", materialized_path: "/comp_lecture.mp4" }, links: { download: "https://files.osf.io/v1/comp_lecture" } }
          ],
          links: { next: null }
        })
      )
    );

    const result = await searchFilesInProjectScope("root1", "mp4");
    expect(result.coverage.complete).toBe(true);
    const out = result.files;
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({
      id: "root1:osfstorage:/root_video.mp4",
      name: "root_video.mp4",
      kind: "file",
      size: null,
      materializedPath: "/root_video.mp4",
      modified: "",
      downloadUrl: "https://files.osf.io/v1/root_video",
      nodeId: "root1"
    });
    expect(out).toContainEqual({
      id: "comp1:osfstorage:/comp_lecture.mp4",
      name: "comp_lecture.mp4",
      kind: "file",
      size: null,
      materializedPath: "/comp_lecture.mp4",
      modified: "",
      downloadUrl: "https://files.osf.io/v1/comp_lecture",
      nodeId: "comp1"
    });
  });
});

// d-3fadc2 / d-f8599c: a search that did not look everywhere must never read as complete.
describe("searchFilesInProjectScope coverage", () => {
  const providerRoot = (guid: string) =>
    http.get(`https://api.osf.io/v2/nodes/${guid}/files/`, () =>
      HttpResponse.json({
        data: [{ id: "p", type: "files", attributes: { name: "osfstorage", kind: "folder", materialized_path: "/", provider: "osfstorage" }, relationships: { files: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/files/osfstorage/` } } } } }],
        links: { next: null },
      }),
    );
  const files = (guid: string, n: number) =>
    http.get(`https://api.osf.io/v2/nodes/${guid}/files/osfstorage/`, () =>
      HttpResponse.json({
        data: Array.from({ length: n }, (_, i) => ({ id: `${guid}${i}`, type: "files", attributes: { name: `x${i}.csv`, kind: "file", materialized_path: `/x${i}.csv` }, links: { download: "https://files.osf.io/v1/x" } })),
        links: { next: null },
      }),
    );

  it("a walk that hit the cap is reported as truncated, naming the node", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/tr1/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      providerRoot("tr1"),
      files("tr1", 10),
    );
    const r = await searchFilesInProjectScope("tr1", "csv", { maxEntries: 4 });
    expect(r.coverage.complete).toBe(false);
    expect(r.coverage.truncated).toEqual(["tr1"]);
    expect(r.coverage.maxEntries).toBe(4);
    expect(r.files.length).toBeLessThanOrEqual(4);
  });

  it("a component whose walk FAILED is reported, not silently counted as 'no matches'", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/tr2/children/", () =>
        HttpResponse.json({ data: [{ id: "bad1", type: "nodes", attributes: { title: "Broken", category: "project", public: true } }], links: { next: null } }),
      ),
      providerRoot("tr2"),
      files("tr2", 1),
      http.get("https://api.osf.io/v2/nodes/bad1/files/", () => new HttpResponse(null, { status: 403 })),
    );
    const r = await searchFilesInProjectScope("tr2", "csv");
    expect(r.coverage.complete).toBe(false);
    expect(r.coverage.failed).toEqual(["bad1"]);
  });

  it("a component list that could not be read means only the root was searched — said so", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/tr3/children/", () => new HttpResponse(null, { status: 404 })),
      providerRoot("tr3"),
      files("tr3", 1),
    );
    const r = await searchFilesInProjectScope("tr3", "csv");
    expect(r.coverage.complete).toBe(false);
    expect(r.coverage.componentsUnknown).toBe(true);
  });
});
