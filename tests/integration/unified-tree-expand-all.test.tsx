import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

function leaf(provider: string, name: string, path: string, children: SkeletonNode[] = []): SkeletonNode {
  return { provider, name, materializedPath: path, listingUrl: `https://api.osf.io/x/${name}/`, children };
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
