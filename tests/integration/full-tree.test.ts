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

  it("default maxComponentsToRecurse=5 — projects with more components than that mark the excess as skipped (regression: pre-2026-05-25 default of 30 caused /<guid> to time out on Many Labs 2)", async () => {
    const childGuids = Array.from({ length: 8 }).map((_, i) => `cap${i}`);
    server.use(
      http.get("https://api.osf.io/v2/nodes/cap-root/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/cap-root/children/", () =>
        HttpResponse.json({
          data: childGuids.map((g) => childNodeRow(g, `T-${g}`)),
          links: { next: null },
        })
      ),
      ...childGuids.flatMap((g) => noFilesHandlers(g)),
    );
    const tree = await collectFullTree("cap-root");
    expect(tree.totalComponents).toBe(8);
    const notSkipped = tree.components.filter((c) => !c.skipped);
    const skipped = tree.components.filter((c) => c.skipped);
    expect(notSkipped).toHaveLength(5);
    expect(skipped).toHaveLength(3);
  });

  it("per-component skeleton fetch races a timeout — slow components get empty skeleton, don't sink the page (regression: 2026-05-25 multi-component timeout fix)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/timeout-root/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/timeout-root/children/", () =>
        HttpResponse.json({ data: [childNodeRow("slow", "Slow Child")], links: { next: null } })
      ),
      // Slow child: handler delays 1s longer than our 100ms timeout below
      http.get("https://api.osf.io/v2/nodes/slow/files/", async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({ data: [], links: { next: null } });
      }),
    );
    const t0 = Date.now();
    const tree = await collectFullTree("timeout-root", { componentTimeoutMs: 100, rootTimeoutMs: 100 });
    const elapsed = Date.now() - t0;

    expect(tree.components).toHaveLength(1);
    const slow = tree.components[0]!;
    expect(slow.skeleton).toEqual([]); // timed out → empty
    expect(slow.skipped).toBe(false); // skipped=false; "timeout" is a different concept from cap-skip
    // total elapsed should be far less than the 1s the slow child wants
    expect(elapsed).toBeLessThan(500);
  });

  it("redundant — kept for back-compat assertion that 3 components below the cap all recurse", async () => {
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
    expect(tree.parentTree).toBeNull();
  });

  it("resolves parentTree as skipped metadata when parentId is set (hydrate on expand)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/v3m95/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/v3m95/children/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/df9tj/", () =>
        HttpResponse.json({
          data: {
            id: "df9tj",
            type: "nodes",
            attributes: {
              title: "Parent Project",
              description: "",
              category: "project",
              public: true,
              tags: [],
              date_created: "",
              date_modified: "",
            },
            relationships: {},
            links: { html: "https://osf.io/df9tj/" },
          },
        })
      ),
    );
    const tree = await collectFullTree("v3m95", { parentId: "df9tj" });
    expect(tree.parentTree).toMatchObject({
      guid: "df9tj",
      title: "Parent Project",
      skipped: true,
      skeleton: [],
    });
  });

  it("leaves parentTree null when parentId is omitted", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/rootonly/files/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/rootonly/children/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );
    const tree = await collectFullTree("rootonly");
    expect(tree.parentTree).toBeNull();
  });
});
