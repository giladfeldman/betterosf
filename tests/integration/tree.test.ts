import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { collectNodeTree } from "@/lib/osf/tree";

function nodeRow(id: string, title: string, childrenHref = `https://api.osf.io/v2/nodes/${id}/children/`, linkedHref = `https://api.osf.io/v2/nodes/${id}/linked_nodes/`) {
  return {
    data: {
      id,
      type: "nodes",
      attributes: { title, public: true, tags: [], category: "project" },
      relationships: {
        children: { links: { related: { href: childrenHref } } },
        linked_nodes: { links: { related: { href: linkedHref } } },
      },
      links: { html: `https://osf.io/${id}/` },
    },
  };
}

describe("collectNodeTree", () => {
  it("returns root + children + grandchildren in DFS order", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/root/", () => HttpResponse.json(nodeRow("root", "Root"))),
      http.get("https://api.osf.io/v2/nodes/root/children/", () =>
        HttpResponse.json({
          data: [nodeRow("c1", "Child 1").data, nodeRow("c2", "Child 2").data],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/root/linked_nodes/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/c1/", () => HttpResponse.json(nodeRow("c1", "Child 1"))),
      http.get("https://api.osf.io/v2/nodes/c1/children/", () =>
        HttpResponse.json({ data: [nodeRow("g1", "Grandchild").data], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/c2/", () => HttpResponse.json(nodeRow("c2", "Child 2"))),
      http.get("https://api.osf.io/v2/nodes/c2/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/g1/", () => HttpResponse.json(nodeRow("g1", "Grandchild"))),
      http.get("https://api.osf.io/v2/nodes/g1/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
    );

    const tree = await collectNodeTree("root");
    expect(tree.map((n) => n.guid)).toEqual(["root", "c1", "g1", "c2"]);
    expect(tree.find((n) => n.guid === "g1")?.depth).toBe(2);
    expect(tree.find((n) => n.guid === "g1")?.parentPath).toBe("Root/Child 1");
  });

  it("includes linked nodes (root only, not transitively) with linked: true flag", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/root/", () => HttpResponse.json(nodeRow("root", "Root"))),
      http.get("https://api.osf.io/v2/nodes/root/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/root/linked_nodes/", () =>
        HttpResponse.json({ data: [nodeRow("ln1", "Linked").data], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/ln1/", () => HttpResponse.json(nodeRow("ln1", "Linked"))),
    );
    const tree = await collectNodeTree("root");
    expect(tree).toHaveLength(2);
    expect(tree[1]).toMatchObject({ guid: "ln1", linked: true });
  });

  it("respects maxNodes safety cap", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/loop/", () => HttpResponse.json(nodeRow("loop", "Loop"))),
      http.get("https://api.osf.io/v2/nodes/loop/children/", () =>
        HttpResponse.json({
          data: [
            nodeRow("a", "A").data,
            nodeRow("b", "B").data,
            nodeRow("c", "C").data,
            nodeRow("d", "D").data,
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/loop/linked_nodes/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/a/", () => HttpResponse.json(nodeRow("a", "A"))),
      http.get("https://api.osf.io/v2/nodes/a/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/b/", () => HttpResponse.json(nodeRow("b", "B"))),
      http.get("https://api.osf.io/v2/nodes/b/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/c/", () => HttpResponse.json(nodeRow("c", "C"))),
      http.get("https://api.osf.io/v2/nodes/c/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/d/", () => HttpResponse.json(nodeRow("d", "D"))),
      http.get("https://api.osf.io/v2/nodes/d/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
    );
    await expect(collectNodeTree("loop", { maxNodes: 3 })).rejects.toThrow(/maxNodes/);
  });
});
