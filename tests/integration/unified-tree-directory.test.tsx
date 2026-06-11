import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { UnifiedTree } from "@/components/UnifiedTree";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";

// Render all virtualized rows in jsdom.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }).map((_, i) => ({ index: i, start: i * 28, size: 28, key: i })),
    measureElement: () => {},
  }),
}));

beforeEach(() => {
  // The osfstorage provider root contains one subfolder ("data") and one file
  // ("readme.txt").
  server.use(
    http.get("*/api/files/:guid/folder", ({ request }) => {
      // Only the provider root has contents; the "data" subfolder is empty (so
      // the fixture can't recurse into itself).
      const listingUrl = new URL(request.url).searchParams.get("listingUrl") ?? "";
      if (listingUrl.includes("/osfstorage/data/")) return HttpResponse.json({ entries: [] });
      return HttpResponse.json({
        entries: [
          {
            id: "f1",
            kind: "folder",
            name: "data",
            materializedPath: "/data/",
            listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/data/",
            uploadUrl: "",
            newFolderUrl: "",
            size: null,
            modified: null,
            downloadUrl: "",
          },
          {
            id: "f2",
            kind: "file",
            name: "readme.txt",
            materializedPath: "/readme.txt",
            listingUrl: "",
            uploadUrl: "",
            newFolderUrl: "",
            size: 10,
            modified: null,
            downloadUrl: "https://files.osf.io/x",
          },
        ],
      });
    })
  );
  // Reset the per-project filesHidden pref so each test starts at the default.
  try {
    window.localStorage.clear();
  } catch {
    /* no-op */
  }
});

function providerRoot(): SkeletonNode {
  return {
    provider: "osfstorage",
    name: "osfstorage",
    materializedPath: "/",
    listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/",
    uploadUrl: "",
    newFolderUrl: "",
    children: [],
    fileCount: 1,
  };
}

function renderTree() {
  return render(
    <UnifiedTree
      guid="ezcuj"
      rootTitle="Test Project"
      skeleton={[providerRoot()]}
      components={[]}
      linkedNodes={[]}
      registrations={[]}
      componentTrees={[]}
      registrationTrees={[]}
      linkedTrees={[]}
    />
  );
}

describe("UnifiedTree directory view", () => {
  it("defaults to Directory: folders are shown, files are hidden", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());
    expect(screen.queryByText("readme.txt")).not.toBeInTheDocument();
  });

  it("Expand all reveals files; Directory hides them again", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Expand all$/i }));
    await waitFor(() => expect(screen.getByText("readme.txt")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Directory$/i }));
    await waitFor(() => expect(screen.queryByText("readme.txt")).not.toBeInTheDocument());
    // Folders remain visible in Directory view.
    expect(screen.getByText("data")).toBeInTheDocument();
  });

  it("Collapse all collapses provider roots but keeps them visible", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Collapse all$/i }));
    // The provider root stays visible...
    expect(screen.getByText("osfstorage")).toBeInTheDocument();
    // ...but its contents collapse away.
    await waitFor(() => expect(screen.queryByText("data")).not.toBeInTheDocument());
  });
});
