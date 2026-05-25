import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { collectFullTree } from "@/lib/osf/full-tree";

function childNodeRow(id: string, title: string) {
  return {
    id,
    type: "nodes",
    attributes: { title, description: "", category: "project", public: true, tags: [], date_created: "", date_modified: "" },
    relationships: { children: { links: { related: { href: `https://api.osf.io/v2/nodes/${id}/children/` } } } },
    links: { html: `https://osf.io/${id}/` },
  };
}

function noFilesHandlers(guid: string) {
  return [
    http.get(`https://api.osf.io/v2/nodes/${guid}/files/`, () => HttpResponse.json({ data: [], links: { next: null } })),
  ];
}

describe("collectFullTree", () => {
  it("recurses up to maxComponentsToRecurse components, marks rest as skipped with empty skeleton", async () => {
    const childGuids = Array.from({ length: 5 }).map((_, i) => `cmp${i}`);
    server.use(
      http.get("https://api.osf.io/v2/nodes/root/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/root/children/", () =>
        HttpResponse.json({
          data: childGuids.map((g) => childNodeRow(g, `T-${g}`)),
          links: { next: null },
        })
      ),
      ...childGuids.flatMap((g) => noFilesHandlers(g)),
    );

    const tree = await collectFullTree("root", { maxComponentsToRecurse: 2 });
    expect(tree.totalComponents).toBe(5);
    expect(tree.components).toHaveLength(5);

    const notSkipped = tree.components.filter((c) => !c.skipped);
    const skipped = tree.components.filter((c) => c.skipped);
    expect(notSkipped).toHaveLength(2);
    expect(skipped).toHaveLength(3);

    // skipped components have an empty skeleton + skipped=true
    for (const c of skipped) {
      expect(c.skeleton).toEqual([]);
      expect(c.skipped).toBe(true);
    }
    // non-skipped components keep their title + category + isPublic + are not skipped
    for (const c of notSkipped) {
      expect(c.skipped).toBe(false);
      expect(c.category).toBe("project");
      expect(c.isPublic).toBe(true);
      expect(c.title.startsWith("T-")).toBe(true);
    }
  });

  it("default maxComponentsToRecurse=30 — all 3 components are recursed below the cap", async () => {
    const childGuids = ["a", "b", "c"];
    server.use(
      http.get("https://api.osf.io/v2/nodes/r/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/r/children/", () =>
        HttpResponse.json({
          data: childGuids.map((g) => childNodeRow(g, `T-${g}`)),
          links: { next: null },
        })
      ),
      ...childGuids.flatMap((g) => noFilesHandlers(g)),
    );
    const tree = await collectFullTree("r");
    expect(tree.components.every((c) => !c.skipped)).toBe(true);
    expect(tree.totalComponents).toBe(3);
  });

  it("survives partial failure: bad child skeleton fetch returns empty skeleton, doesn't crash", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/proj/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/proj/children/", () =>
        HttpResponse.json({ data: [childNodeRow("good", "Good"), childNodeRow("bad", "Bad")], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/good/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/bad/files/", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const tree = await collectFullTree("proj");
    expect(tree.components).toHaveLength(2);
    // both treated as non-skipped (the cap-skip is unrelated to fetch failure)
    const bad = tree.components.find((c) => c.guid === "bad")!;
    expect(bad.skeleton).toEqual([]);
    expect(bad.skipped).toBe(false);
  });
});
