import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET } from "@/app/api/files/[guid]/skeleton/route";

describe("/api/files/[guid]/skeleton", () => {
  it("returns 400 for an invalid guid", async () => {
    const req = new Request("http://localhost:3000/api/files/!!!/skeleton");
    const res = await GET(req, { params: Promise.resolve({ guid: "!!!" }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid/i);
  });

  it("returns 404 when OSF says project not found", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/missing/files/", () =>
        HttpResponse.json({ errors: [{ detail: "Not found." }] }, { status: 404 })
      )
    );
    const req = new Request("http://localhost:3000/api/files/missing/skeleton");
    const res = await GET(req, { params: Promise.resolve({ guid: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns a JSON skeleton on the happy path without shared caching", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/happy/files/", () =>
        HttpResponse.json({
          data: [{
            id: "osfstorage", type: "files",
            attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
            relationships: { files: { links: { related: { href: "https://api.osf.io/v2/nodes/happy/files/osfstorage/" } } } },
          }],
          links: { next: null },
        })
      ),
      http.get("https://api.osf.io/v2/nodes/happy/files/osfstorage/", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
    );
    const req = new Request("http://localhost:3000/api/files/happy/skeleton");
    const res = await GET(req, { params: Promise.resolve({ guid: "happy" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.skeleton).toBeInstanceOf(Array);
    expect(body.skeleton[0]).toMatchObject({ provider: "osfstorage", name: "osfstorage" });
  });
});
