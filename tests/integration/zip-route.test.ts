import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET } from "@/app/api/zip/[guid]/[provider]/[[...path]]/route";

describe("ZIP folder route", () => {
  it("proxies WaterButler ?zip= and streams body back", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/data/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.has("zip")).toBe(true);
        return new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="data.zip"' },
        });
      })
    );
    const req = new Request("http://localhost:4747/api/zip/ezcuj/osfstorage/data");
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj", provider: "osfstorage", path: ["data"] }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  it("returns 404 when WaterButler returns 404", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/missing/", () =>
        new HttpResponse(null, { status: 404 })
      )
    );
    const req = new Request("http://localhost:4747/api/zip/ezcuj/osfstorage/missing");
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj", provider: "osfstorage", path: ["missing"] }) });
    expect(res.status).toBe(404);
  });

  it("handles provider root (no path) by hitting the provider root with ?zip=", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/", () =>
        new HttpResponse(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        })
      )
    );
    const req = new Request("http://localhost:4747/api/zip/ezcuj/osfstorage");
    const res = await GET(req, { params: Promise.resolve({ guid: "ezcuj", provider: "osfstorage", path: undefined }) });
    expect(res.status).toBe(200);
  });

  it("rejects invalid guid", async () => {
    const req = new Request("http://localhost:4747/api/zip/!!!/osfstorage");
    const res = await GET(req, { params: Promise.resolve({ guid: "!!!", provider: "osfstorage", path: undefined }) });
    expect(res.status).toBe(400);
  });
});
