import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { UnifiedTree } from "@/components/UnifiedTree";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";

// Render every virtualized row in jsdom so depth-gating is observable.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }).map((_, i) => ({ index: i, start: i * 28, size: 28, key: i })),
    measureElement: () => {},
  }),
}));

beforeEach(() => {
  // Empty folder listings by default; individual tests override.
  server.use(http.get("*/api/files/:guid/folder", () => HttpResponse.json({ entries: [] })));
  // Each test starts from default prefs (level 1, no saved expansion).
  try {
    window.localStorage.clear();
  } catch {
    /* no-op */
  }
});

function leaf(name: string, path: string, children: SkeletonNode[] = [], listingUrl?: string): SkeletonNode {
  return {
    provider: "osfstorage",
    name,
    materializedPath: path,
    listingUrl: listingUrl ?? `https://api.osf.io/x/${name}/`,
    children,
    fileCount: 0,
  };
}

// A 3-deep static skeleton: osfstorage → a(/a/) → b(/a/b/) → c(/a/b/c/).
function deepSkeleton(): SkeletonNode[] {
  return [leaf("osfstorage", "/", [leaf("a", "/a/", [leaf("b", "/a/b/", [leaf("c", "/a/b/c/")])])])];
}

function renderDeep(guid = "depth-root") {
  return render(
    <UnifiedTree
      guid={guid}
      rootTitle="Root"
      skeleton={deepSkeleton()}
      components={[]}
      linkedNodes={[]}
      registrations={[]}
    />
  );
}

describe("UnifiedTree depth (Levels) control", () => {
  it("defaults to level 1: direct children of the provider root show, deeper folders are hidden", async () => {
    renderDeep();
    // Level 1 (direct child of osfstorage) is visible.
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    // Levels 2 and 3 are gated away by the default ceiling of 1.
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
    // The stepper reads "1".
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("'+' reveals the next level and '−' hides it again", async () => {
    renderDeep();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.queryByText("b")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    // Now at level 2 — "b" appears, "c" still hidden.
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());
    expect(screen.queryByText("c")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show fewer levels/i }));
    // Back to level 1 — "b" gone, "a" stays.
    await waitFor(() => expect(screen.queryByText("b")).not.toBeInTheDocument());
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("does NOT fetch OSF listings for folders below the depth ceiling (the call-burn fix)", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      // Distinct listingUrls per level so we can assert which got fetched.
      const sk: SkeletonNode[] = [
        leaf("osfstorage", "/", [
          leaf("a", "/a/", [leaf("b", "/a/b/", [], "https://api.osf.io/LEVEL2/")], "https://api.osf.io/LEVEL1/"),
        ], "https://api.osf.io/ROOT/"),
      ];
      render(
        <UnifiedTree guid="burn" rootTitle="Root" skeleton={sk} components={[]} linkedNodes={[]} registrations={[]} />
      );
      // Let the auto-load effect settle. The provider root + level-1 folder are
      // fetched (the ceiling level's own listing IS fetched), but the level-2
      // folder's listing must never be requested at the default ceiling of 1.
      await waitFor(() =>
        expect(calls.some((u) => u.includes("listingUrl=") && u.includes("LEVEL1"))).toBe(true)
      );
      expect(calls.some((u) => u.includes("LEVEL2"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("shows files of the deepest allowed, open folder", async () => {
    // osfstorage → data(/data/), where data contains a file. At level 1, data is
    // the ceiling folder; its files must still render (only deeper FOLDERS gate).
    server.use(
      http.get("*/api/files/:guid/folder", ({ request }) => {
        const listingUrl = new URL(request.url).searchParams.get("listingUrl") ?? "";
        if (listingUrl.includes("/data/")) {
          return HttpResponse.json({
            entries: [
              { id: "file1", kind: "file", name: "inside.csv", materializedPath: "/data/inside.csv", listingUrl: "", size: 5, modified: null, downloadUrl: "https://files.osf.io/x" },
            ],
          });
        }
        return HttpResponse.json({ entries: [] });
      })
    );
    const sk: SkeletonNode[] = [
      leaf("osfstorage", "/", [leaf("data", "/data/", [], "https://api.osf.io/v2/data/")]),
    ];
    render(
      <UnifiedTree guid="files-at-limit" rootTitle="Root" skeleton={sk} components={[]} linkedNodes={[]} registrations={[]} />
    );
    // Reveal files (default is folders-only "Directory" view).
    fireEvent.click(screen.getByRole("button", { name: /^show files$/i }));
    await waitFor(() => expect(screen.getByText("inside.csv")).toBeInTheDocument());
    // The deeper FOLDER ceiling still holds — data is level 1 and shown.
    expect(screen.getByText("data")).toBeInTheDocument();
  });

  it("manual drill opens just one branch past the ceiling; 'Expand all' clears the override", async () => {
    renderDeep();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.queryByText("b")).not.toBeInTheDocument();

    // A depth-limited folder with hidden child folders renders collapsed (▶), so
    // its toggle reads "Expand". Click it to drill just this branch one level.
    const aRow = screen.getByText("a").closest('[role="treeitem"]') as HTMLElement;
    fireEvent.click(within(aRow).getByRole("button", { name: /expand/i }));
    await waitFor(() => expect(screen.getByText("b")).toBeInTheDocument());
    // The global level did NOT change — stepper still reads 1.
    expect(screen.getByText("1")).toBeInTheDocument();
    // ...and the level past the drilled branch is still gated.
    expect(screen.queryByText("c")).not.toBeInTheDocument();

    // Expand all jumps to "All" and clears overrides — everything visible.
    fireEvent.click(screen.getByRole("button", { name: /^expand all$/i }));
    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("'Expand all' sets the level to 'All' and reveals the deepest leaf", async () => {
    renderDeep();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^expand all$/i }));
    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("persists the level per project and round-trips the 'All' sentinel", async () => {
    const { unmount } = renderDeep("persist-guid");
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());

    // Raise to level 3 (two '+' presses: 1 → 2 → 3).
    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    expect(window.localStorage.getItem("betterosf:tree.maxDepth.persist-guid")).toBe("3");

    // Remount the same project — level 3 is restored from prefs.
    unmount();
    renderDeep("persist-guid");
    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();

    // Now go past the numeric cap to "All": 3 → 4 → 5 → All.
    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    fireEvent.click(screen.getByRole("button", { name: /show more levels/i }));
    await waitFor(() => expect(screen.getByText("All")).toBeInTheDocument());
    // Persisted as the string "all" (Infinity is not JSON-serializable).
    expect(window.localStorage.getItem("betterosf:tree.maxDepth.persist-guid")).toBe('"all"');
  });

  it("caps the numeric stepper at 5 then 'All'; '−' is disabled at level 1", async () => {
    renderDeep();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());

    const minus = screen.getByRole("button", { name: /show fewer levels/i });
    const plus = screen.getByRole("button", { name: /show more levels/i });
    // At level 1, '−' is disabled.
    expect(minus).toBeDisabled();

    // Step up to 5.
    for (let i = 0; i < 4; i++) fireEvent.click(plus);
    expect(screen.getByText("5")).toBeInTheDocument();
    // One more press → "All".
    fireEvent.click(plus);
    expect(screen.getByText("All")).toBeInTheDocument();
    // At "All", '+' is disabled and '−' drops back to 5.
    expect(plus).toBeDisabled();
    fireEvent.click(minus);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("the Show files / Hide files toggle flips files and persists", async () => {
    server.use(
      http.get("*/api/files/:guid/folder", ({ request }) => {
        const listingUrl = new URL(request.url).searchParams.get("listingUrl") ?? "";
        if (listingUrl.includes("/data/")) return HttpResponse.json({ entries: [] });
        return HttpResponse.json({
          entries: [
            { id: "ff", kind: "file", name: "top.txt", materializedPath: "/top.txt", listingUrl: "", size: 1, modified: null, downloadUrl: "https://files.osf.io/y" },
          ],
        });
      })
    );
    const sk: SkeletonNode[] = [leaf("osfstorage", "/", [])];
    render(
      <UnifiedTree guid="files-toggle" rootTitle="Root" skeleton={sk} components={[]} linkedNodes={[]} registrations={[]} />
    );
    // Default folders-only: the top-level file is hidden, button says "Show files".
    await waitFor(() => expect(screen.getByText("osfstorage")).toBeInTheDocument());
    expect(screen.queryByText("top.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^show files$/i }));
    await waitFor(() => expect(screen.getByText("top.txt")).toBeInTheDocument());
    expect(window.localStorage.getItem("betterosf:tree.filesHidden.files-toggle")).toBe("false");

    // Toggle back to hide files.
    fireEvent.click(screen.getByRole("button", { name: /^hide files$/i }));
    await waitFor(() => expect(screen.queryByText("top.txt")).not.toBeInTheDocument());
  });

  it("shows a 'N loaded' counter reflecting fetched folder listings", async () => {
    // Provider root returns one folder; that's one loaded listing (root) at least.
    renderDeep("counter-guid");
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    // The counter appears once at least one listing has been fetched.
    await waitFor(() => expect(screen.getByText(/\d+ loaded/)).toBeInTheDocument());
  });
});
