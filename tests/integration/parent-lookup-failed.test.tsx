import { beforeEach, describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, within } from "@testing-library/react";
import { server } from "../msw/server";
import { collectFullTree } from "@/lib/osf/full-tree";
import ProjectPage from "@/app/[guid]/page";
import FileViewerPage from "@/app/[guid]/files/view/[...path]/page";

/**
 * d-628841 (and its class: a failed parent lookup read as "no parent").
 *
 * The file viewer caught a failed title/parent lookup as `{ title: "", parentId: null }`,
 * and collectFullTree's getParentNode turned a failed parent fetch into `null` — the same
 * value a top-level project has. Either way the breadcrumb silently dropped the parent,
 * a true-looking state built from an unknown. A failed lookup must say it failed.
 */
const empty = () => HttpResponse.json({ data: [], links: { next: null } });

function nodeRow(id: string, title: string, parentId: string | null) {
  return {
    data: {
      id,
      type: "nodes",
      attributes: { title, description: "", category: "project", public: true, tags: [], date_created: "", date_modified: "" },
      relationships: parentId
        ? { parent: { data: { id: parentId, type: "nodes" }, links: { related: { href: `https://api.osf.io/v2/nodes/${parentId}/` } } } }
        : {},
      links: { html: `https://osf.io/${id}/` },
    },
  };
}

beforeEach(() => {
  server.use(
    http.get("https://api.osf.io/v2/nodes/:guid/files/", empty),
    http.get("https://api.osf.io/v2/nodes/:guid/children/", empty),
    http.get("https://api.osf.io/v2/nodes/:guid/linked_nodes/", empty),
    http.get("https://api.osf.io/v2/nodes/:guid/registrations/", empty),
  );
});

function crumbs() {
  return within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByText(/./).map((n) => n.textContent ?? "");
}

describe("a failed parent lookup is 'could not load', never 'no parent'", () => {
  it("collectFullTree marks parentFailed when the parent fetch fails", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/parx1/", () => new HttpResponse(null, { status: 403 })));
    const tree = await collectFullTree("chld1", { parentId: "parx1" });
    expect(tree.parentTree).toBeNull();
    expect(tree.parentFailed).toBe(true);
  });

  it("control: a top-level project (no parentId) is not parentFailed", async () => {
    const tree = await collectFullTree("topl1");
    expect(tree.parentTree).toBeNull();
    expect(tree.parentFailed).toBe(false);
  });

  it("file viewer: a failed title/parent lookup shows a 'could not load' crumb", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/vfai1/", () => new HttpResponse(null, { status: 403 })));
    render(
      await FileViewerPage({
        params: Promise.resolve({ guid: "vfai1", path: ["osfstorage", "a.bin"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(crumbs().some((c) => /could not load/i.test(c))).toBe(true);
  });

  it("control: file viewer of a top-level project shows no parent crumb", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/vtop1/", () => HttpResponse.json(nodeRow("vtop1", "Top", null))));
    render(
      await FileViewerPage({
        params: Promise.resolve({ guid: "vtop1", path: ["osfstorage", "a.bin"] }),
        searchParams: Promise.resolve({}),
      }),
    );
    const c = crumbs();
    expect(c.some((x) => /could not load/i.test(x))).toBe(false);
    expect(c).toContain("Top");
  });

  it("project overview: a failed parent fetch shows a 'could not load' crumb", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/pchd1/", () => HttpResponse.json(nodeRow("pchd1", "Child", "ppar1"))),
      http.get("https://api.osf.io/v2/nodes/ppar1/", () => new HttpResponse(null, { status: 403 })),
    );
    render(await ProjectPage({ params: Promise.resolve({ guid: "pchd1" }), searchParams: Promise.resolve({}) }));
    expect(crumbs().some((c) => /could not load/i.test(c))).toBe(true);
  });
});
