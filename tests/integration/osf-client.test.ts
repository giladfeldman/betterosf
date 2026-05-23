import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { osfGet, osfGetUrl } from "@/lib/osf/client";
import { OsfError } from "@/lib/osf/types";
import { getCurrentUser, getMyProjects } from "@/lib/osf/users";

describe("osfGet", () => {
  it("attaches bearer token and returns parsed JSON", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/abc/", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        return HttpResponse.json({ data: { id: "abc", type: "nodes", attributes: {} } });
      })
    );
    const result = await osfGet("/nodes/abc/");
    expect((result as { data: { id: string } }).data.id).toBe("abc");
  });

  it("maps 404 to OsfError code=not_found", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/xxx/", () => new HttpResponse(null, { status: 404 })));
    await expect(osfGet("/nodes/xxx/")).rejects.toMatchObject({
      name: "OsfError",
      status: 404,
      code: "not_found",
    } satisfies Partial<OsfError>);
  });

  it("maps 403 to forbidden", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/p/", () => new HttpResponse(null, { status: 403 })));
    await expect(osfGet("/nodes/p/")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("maps 429 to rate_limited", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/x/", () => new HttpResponse(null, { status: 429 })));
    await expect(osfGet("/nodes/x/")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps 5xx to upstream", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/x/", () => new HttpResponse(null, { status: 502 })));
    await expect(osfGet("/nodes/x/")).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("osfGetUrl", () => {
  it("accepts a fully-qualified URL (for paginator next links)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/foo/?page=2", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      )
    );
    const result = await osfGetUrl("https://api.osf.io/v2/foo/?page=2");
    expect(result).toBeDefined();
  });
});

import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";

describe("getNode", () => {
  it("fetches and parses a node", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/", () =>
        HttpResponse.json({
          data: {
            id: "ezcuj",
            type: "nodes",
            attributes: { title: "Many Labs 2", public: true, tags: [], category: "project" },
            relationships: {},
          },
        })
      )
    );
    const node = await getNode("ezcuj");
    expect(node.id).toBe("ezcuj");
    expect(node.title).toBe("Many Labs 2");
  });
});

describe("getAllChildren", () => {
  it("follows pagination to return every child", async () => {
    const page1 = {
      data: [{ id: "c1", type: "nodes", attributes: { title: "Study 1", public: true, tags: [], category: "project" }, relationships: {} }],
      links: { next: "https://api.osf.io/v2/nodes/ezcuj/children/?page=2" },
    };
    const page2 = {
      data: [{ id: "c2", type: "nodes", attributes: { title: "Study 2", public: true, tags: [], category: "project" }, relationships: {} }],
      links: { next: null },
    };
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/children/", ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json(url.searchParams.has("page") ? page2 : page1);
      })
    );
    const children = await getAllChildren("ezcuj");
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("getAllLinkedNodes", () => {
  it("returns all linked nodes (single page)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/linked_nodes/", () =>
        HttpResponse.json({
          data: [{ id: "ln1", type: "nodes", attributes: { title: "Linked", public: true, tags: [], category: "project" }, relationships: {} }],
          links: { next: null },
        })
      )
    );
    const ln = await getAllLinkedNodes("ezcuj");
    expect(ln).toHaveLength(1);
    expect(ln[0]?.id).toBe("ln1");
  });
});

import { getNodeRegistrations } from "@/lib/osf/registrations";

describe("getNodeRegistrations", () => {
  it("returns all registrations of a node", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/registrations/", () =>
        HttpResponse.json({
          data: [
            {
              id: "reg1",
              type: "registrations",
              attributes: {
                title: "Pre-registration",
                date_registered: "2018-01-01T00:00:00Z",
                public: true,
                category: "project",
                tags: [],
              },
              relationships: {},
              links: { html: "https://osf.io/reg1/" },
            },
          ],
          links: { next: null },
        })
      )
    );
    const regs = await getNodeRegistrations("ezcuj");
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ id: "reg1", title: "Pre-registration", dateRegistered: "2018-01-01T00:00:00Z" });
  });
});

import { getProviderRoots, getFolderContents } from "@/lib/osf/files";

describe("getProviderRoots", () => {
  it("returns one entry per storage provider, with the root listing URL", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/", () =>
        HttpResponse.json({
          data: [
            {
              id: "osfstorage",
              type: "files",
              attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/" } } } },
            },
            {
              id: "googledrive",
              type: "files",
              attributes: { name: "googledrive", provider: "googledrive", kind: "folder", path: "/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/googledrive/" } } } },
            },
          ],
          links: { next: null },
        })
      )
    );
    const roots = await getProviderRoots("ezcuj");
    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({ provider: "osfstorage", listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/" });
    expect(roots[1]?.provider).toBe("googledrive");
  });
});

describe("getFolderContents", () => {
  it("lists files and folders at a given listing URL", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            {
              id: "f1",
              type: "files",
              attributes: { name: "raw.csv", kind: "file", size: 12345, materialized_path: "/raw.csv", modified: "2025-01-01T00:00:00Z" },
              links: { download: "https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/f1" },
              relationships: {},
            },
            {
              id: "fold1",
              type: "files",
              attributes: { name: "analysis", kind: "folder", materialized_path: "/analysis/" },
              relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/fold1/" } } } },
            },
          ],
          links: { next: null },
        })
      )
    );
    const contents = await getFolderContents("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", "ezcuj");
    expect(contents).toHaveLength(2);
    expect(contents[0]).toMatchObject({
      kind: "file",
      name: "raw.csv",
      size: 12345,
      downloadUrl: "https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/f1",
    });
    expect(contents[1]).toMatchObject({
      kind: "folder",
      name: "analysis",
      listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/fold1/",
    });
  });
});

describe("getCurrentUser", () => {
  it("returns parsed user from /users/me/", async () => {
    server.use(
      http.get("https://api.osf.io/v2/users/me/", () =>
        HttpResponse.json({
          data: {
            id: "abc12",
            type: "users",
            attributes: { full_name: "Ada", given_name: "Ada", family_name: "L" },
            links: { html: "https://osf.io/abc12/" },
          },
        })
      )
    );
    const user = await getCurrentUser();
    expect(user).toMatchObject({ id: "abc12", fullName: "Ada", osfUrl: "https://osf.io/abc12/" });
  });
});

describe("getMyProjects", () => {
  it("returns all nodes from /users/me/nodes/ (paginated)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/users/me/nodes/", () =>
        HttpResponse.json({
          data: [
            { id: "p1", type: "nodes", attributes: { title: "Project 1", public: true, tags: [], category: "project" }, relationships: {} },
            { id: "p2", type: "nodes", attributes: { title: "Project 2", public: false, tags: [], category: "project" }, relationships: {} },
          ],
          links: { next: null },
        })
      )
    );
    const projects = await getMyProjects();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(projects.map((p) => p.public)).toEqual([true, false]);
  });
});
