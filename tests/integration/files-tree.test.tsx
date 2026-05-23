import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../msw/server";
import FilesPage from "@/app/[guid]/files/page";

describe("Files tree page", () => {
  it("lists every storage provider as a top-level node", async () => {
    server.use(
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

  it("renders file rows for each file in provider root", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/" } } } } },
          ],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            { id: "f1", type: "files", attributes: { name: "raw.csv", kind: "file", size: 12345, materialized_path: "/raw.csv", modified: "2025-01-01" }, links: { download: "https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/f1" }, relationships: {} },
          ],
          links: { next: null },
        })
      ),
    );
    const ui = await FilesPage({ params: Promise.resolve({ guid: "ezcuj" }) });
    render(ui);
    expect(screen.getByText("raw.csv")).toBeInTheDocument();
  });
});
