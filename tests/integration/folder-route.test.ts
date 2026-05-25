import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET } from "@/app/api/files/[guid]/folder/route";

describe("/api/files/[guid]/folder", () => {
  it("returns 400 for an invalid guid", async () => {
    const req = new Request("http://localhost:3000/api/files/!!!/folder?listingUrl=https://api.osf.io/v2/nodes/x/files/osfstorage/");
    const res = await GET(req, { params: Promise.resolve({ guid: "!!!" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when listingUrl query param is missing", async () => {
    const req = new Request("http://localhost:3000/api/files/ezcuj/folder");
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/listingUrl/i);
  });

  it("rejects non-OSF listingUrls (SSRF guard)", async () => {
    const req = new Request("http://localhost:3000/api/files/ezcuj/folder?listingUrl=https://evil.example/x/");
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid/i);
  });

  it("happy path returns the entries JSON with cache header", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/", () =>
        HttpResponse.json({
          data: [
            { id: "f1", type: "files", attributes: { name: "a.csv", kind: "file", materialized_path: "/a.csv", size: 100, modified: "" }, links: { download: "https://x" }, relationships: {} },
            { id: "fold", type: "files", attributes: { name: "sub", kind: "folder", materialized_path: "/sub/" }, relationships: { files: { links: { related: { href: "https://api.osf.io/v2/x" } } } } },
          ],
          links: { next: null },
        })
      ),
    );
    const req = new Request("http://localhost:3000/api/files/ezcuj/folder?listingUrl=" + encodeURIComponent("https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/"));
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.find((e: { name: string }) => e.name === "a.csv")?.kind).toBe("file");
    expect(body.entries.find((e: { name: string }) => e.name === "sub")?.kind).toBe("folder");
  });
});
