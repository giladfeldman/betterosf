import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { searchNodes, searchFiles, searchRegistrations, searchUsers } from "@/lib/osf/search";

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
  it("filters by name and returns file entries with download URLs", async () => {
    server.use(
      http.get("https://api.osf.io/v2/files/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("filter[name]")).toBe("raw.csv");
        return HttpResponse.json({
          data: [
            {
              id: "f1", type: "files",
              attributes: { name: "raw.csv", kind: "file", size: 1024, materialized_path: "/data/raw.csv", modified: "2024-01-01" },
              links: { download: "https://files.osf.io/v1/resources/p1/providers/osfstorage/f1" },
              relationships: { node: { data: { id: "p1", type: "nodes" } } },
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
