import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { UnifiedTree } from "@/components/UnifiedTree";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";
import type { ComponentTree } from "@/lib/osf/full-tree";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }).map((_, i) => ({ index: i, start: i * 28, size: 28, key: i })),
  }),
}));

beforeEach(() => {
  server.use(
    http.get("*/api/files/:guid/folder", () =>
      HttpResponse.json({ entries: [] })
    )
  );
});

function leaf(provider: string, name: string, path: string, children: SkeletonNode[] = []): SkeletonNode {
  return { provider, name, materializedPath: path, listingUrl: `https://api.osf.io/x/${name}/`, children, fileCount: 0 };
}

describe("UnifiedTree expand-all / collapse-all", () => {
  it("expandAll recursively expands every nested folder and every component sub-tree in one click", () => {
    const deep: SkeletonNode[] = [
      leaf("osfstorage", "osfstorage", "/", [
        leaf("osfstorage", "a", "/a/", [
          leaf("osfstorage", "b", "/a/b/", [leaf("osfstorage", "c", "/a/b/c/")]),
        ]),
      ]),
    ];
    const componentTrees: ComponentTree[] = [
      {
        guid: "cmp1",
        title: "Component 1",
        category: "project",
        isPublic: true,
        skipped: false,
        skeleton: [
          leaf("osfstorage", "osfstorage", "/", [
            leaf("osfstorage", "deeper", "/deeper/", [leaf("osfstorage", "deepest", "/deeper/deepest/")]),
          ]),
        ],
      },
    ];
    render(
      <UnifiedTree
        guid="root"
        rootTitle="Root"
        skeleton={deep}
        components={[{ id: "cmp1", title: "Component 1", description: "", category: "project", public: true, tags: [], dateCreated: "", dateModified: "" }] as never}
        componentTrees={componentTrees}
        linkedNodes={[]}
        registrations={[]}
      />
    );
    // Collapse first to start from a known state, then Expand all.
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    // After collapseAll, only the un-children-having top-level structure remains.
    expect(screen.queryByText("c")).not.toBeInTheDocument();
    expect(screen.queryByText("deepest")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    // Every deepest leaf is now visible
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("deepest")).toBeInTheDocument();
    // And every mid-level folder
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("deeper")).toBeInTheDocument();
  });

  it("auto-fetches files for every initially-expanded folder (no click-collapse-expand required)", async () => {
    // Regression test for user-reported bug: initial render shows folders as
    // expanded (▼) but no files appear inside — users had to click to collapse,
    // then click again to expand, which finally triggered the per-folder fetch.
    // The fix: a useEffect in UnifiedTree iterates every expanded folder and
    // calls fetchFiles, with in-flight + loaded de-dupe.
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      return new Response(JSON.stringify({ entries: [{ kind: "file", id: `f-${u}`, name: "x.csv", size: 1, modified: "", materializedPath: "/x.csv", downloadUrl: "" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const sk: SkeletonNode[] = [
        leaf("osfstorage", "osfstorage", "/", [leaf("osfstorage", "sub", "/sub/")]),
      ];
      render(
        <UnifiedTree
          guid="r1"
          rootTitle="Root"
          skeleton={sk}
          components={[]}
          linkedNodes={[]}
          registrations={[]}
        />
      );

      // Wait a tick for useEffect to run
      await new Promise((r) => setTimeout(r, 50));

      // Expect at least one call to /api/files/r1/folder for the auto-expanded sub-folder.
      // (Provider root + sub-folder = 2 separate fetches.)
      expect(calls.some((u) => u.includes("/api/files/r1/folder"))).toBe(true);
      expect(calls.filter((u) => u.includes("/api/files/r1/folder")).length).toBeGreaterThanOrEqual(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps lazily fetched subfolders visible when the server skeleton is shallow", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      const entries = u.includes("listingUrl=child")
        ? [{ kind: "folder", id: "deep", name: "deep", materializedPath: "/child/deep/", listingUrl: "deep-url" }]
        : [];
      return new Response(JSON.stringify({ entries }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const sk: SkeletonNode[] = [
        leaf("osfstorage", "osfstorage", "/", [
          { provider: "osfstorage", name: "child", materializedPath: "/child/", listingUrl: "child-url", children: [], fileCount: 0 },
        ]),
      ];
      render(
        <UnifiedTree
          guid="lazy"
          rootTitle="Root"
          skeleton={sk}
          components={[]}
          linkedNodes={[]}
          registrations={[]}
        />
      );

      await screen.findByText("deep");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders file-count badge for folders that have files", () => {
    // Regression test for user-reported bug: folders with files didn't surface
    // that fact in the tree — users couldn't tell which folders were worth
    // expanding. The fix: SkeletonNode.fileCount + UnifiedTreeNode "(N)" badge.
    const sk: SkeletonNode[] = [
      { provider: "osfstorage", name: "osfstorage", materializedPath: "/", listingUrl: "x", children: [
        { provider: "osfstorage", name: "data", materializedPath: "/data/", listingUrl: "y", children: [], fileCount: 7 },
      ], fileCount: 2 },
    ];
    render(
      <UnifiedTree
        guid="r2"
        rootTitle="Root"
        skeleton={sk}
        components={[]}
        linkedNodes={[]}
        registrations={[]}
      />
    );
    expect(screen.getByText("(7)")).toBeInTheDocument();
    // Provider-root also gets a count
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("folder ZIP action does not toggle the row", () => {
    const sk: SkeletonNode[] = [
      leaf("osfstorage", "osfstorage", "/", [leaf("osfstorage", "sub", "/sub/")]),
    ];
    render(
      <UnifiedTree
        guid="root"
        rootTitle="Root"
        skeleton={sk}
        components={[]}
        linkedNodes={[]}
        registrations={[]}
      />
    );
    expect(screen.getByText("sub")).toBeInTheDocument();
    const link = screen.getByLabelText(/Download osfstorage as ZIP/i);
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(screen.getByText("sub")).toBeInTheDocument();
  });

  it("select mode exposes checkboxes for folders", () => {
    const sk: SkeletonNode[] = [
      leaf("osfstorage", "osfstorage", "/", [leaf("osfstorage", "sub", "/sub/")]),
    ];
    render(
      <UnifiedTree
        guid="root"
        rootTitle="Root"
        skeleton={sk}
        components={[]}
        linkedNodes={[]}
        registrations={[]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const checkbox = screen.getByLabelText("Select sub");
    fireEvent.click(checkbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("collapseAll clears every expansion so all nested folders disappear", () => {
    const sk: SkeletonNode[] = [
      leaf("osfstorage", "osfstorage", "/", [leaf("osfstorage", "sub", "/sub/")]),
    ];
    render(
      <UnifiedTree
        guid="root"
        rootTitle="Root"
        skeleton={sk}
        components={[]}
        linkedNodes={[]}
        registrations={[]}
      />
    );
    // Initially expanded by default, so 'sub' is visible
    expect(screen.getByText("sub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(screen.queryByText("sub")).not.toBeInTheDocument();
  });
});
