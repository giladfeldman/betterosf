import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import FilesPage from "@/app/[guid]/files/page";

// Stub useVirtualizer so virtualized list renders all items in jsdom
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 28,
    getVirtualItems: () =>
      Array.from({ length: opts.count }).map((_, i) => ({ index: i, start: i * 28, size: 28, key: i })),
    measureElement: () => {},
  }),
}));

function nodeResponse(guid: string, title: string) {
  return {
    data: {
      id: guid,
      type: "nodes",
      attributes: { title, description: "", category: "project", public: true, tags: [], date_created: "", date_modified: "" },
      links: { html: `https://osf.io/${guid}/` },
      relationships: {
        children: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/children/` } } },
        linked_nodes: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/linked_nodes/` } } },
        registrations: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/registrations/` } } },
        files: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/files/` } } },
        contributors: { links: { related: { href: `https://api.osf.io/v2/nodes/${guid}/contributors/` } } },
      },
    },
  };
}

describe("Files tree page", () => {
  it("lists every storage provider as a top-level node", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/", () => HttpResponse.json(nodeResponse("ezcuj", "Test"))),
      http.get("https://api.osf.io/v2/nodes/ezcuj/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/linked_nodes/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/registrations/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/" } } } } },
            { id: "googledrive", type: "files", attributes: { name: "googledrive", provider: "googledrive", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/googledrive/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/googledrive/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );
    const ui = await FilesPage({ params: Promise.resolve({ guid: "ezcuj" }) });
    render(ui);
    expect(screen.getByText("osfstorage")).toBeInTheDocument();
    expect(screen.getByText("googledrive")).toBeInTheDocument();
  });

  it("renders the project title as the root label", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/", () => HttpResponse.json(nodeResponse("ezcuj", "My Project"))),
      http.get("https://api.osf.io/v2/nodes/ezcuj/children/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/linked_nodes/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/registrations/", () => HttpResponse.json({ data: [], links: { next: null } })),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );
    const ui = await FilesPage({ params: Promise.resolve({ guid: "ezcuj" }) });
    render(ui);
    // The breadcrumb shows the project title
    expect(screen.getAllByText("My Project").length).toBeGreaterThan(0);
  });
});
