import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET } from "@/app/api/zip/[guid]/route";

function nodeRow(id: string, title: string) {
  return {
    data: {
      id,
      type: "nodes",
      attributes: { title, public: true, tags: [], category: "project" },
      relationships: {
        children: { links: { related: { href: `https://api.osf.io/v2/nodes/${id}/children/` } } },
        linked_nodes: { links: { related: { href: `https://api.osf.io/v2/nodes/${id}/linked_nodes/` } } },
      },
      links: { html: `https://osf.io/${id}/` },
    },
  };
}

function emptyCollection() {
  return HttpResponse.json({ data: [], links: { next: null } });
}

describe("whole-tree ZIP route", () => {
  it("returns 400 for invalid guid", async () => {
    const req = new Request("http://localhost:4747/api/zip/!!!");
    const res = await GET(req, { params: Promise.resolve({ guid: "!!!" }) });
    expect(res.status).toBe(400);
  });

  it("streams a ZIP for a single-node project with one provider", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/solo/", () => HttpResponse.json(nodeRow("solo", "Solo"))),
      http.get("https://api.osf.io/v2/nodes/solo/children/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/solo/linked_nodes/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/solo/files/", () =>
        HttpResponse.json({
          data: [{
            id: "osfstorage", type: "files",
            attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" },
            relationships: {},
          }],
          links: { next: null },
        })
      ),
      http.get("https://files.osf.io/v1/resources/solo/providers/osfstorage/", () =>
        new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), {
          status: 200, headers: { "Content-Type": "application/zip" },
        })
      ),
    );
    const req = new Request("http://localhost:4747/api/zip/solo");
    const res = await GET(req, { params: Promise.resolve({ guid: "solo" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("solo.zip");
    const buf = new Uint8Array(await res.arrayBuffer());
    // Outer archive must begin with ZIP magic
    expect(buf.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(buf.byteLength).toBeGreaterThan(50);
  });

  it("includes _BETTEROSF_ERRORS.txt when a provider fails", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/halfbad/", () => HttpResponse.json(nodeRow("halfbad", "HalfBad"))),
      http.get("https://api.osf.io/v2/nodes/halfbad/children/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/halfbad/linked_nodes/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/halfbad/files/", () =>
        HttpResponse.json({
          data: [
            { id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: {} },
            { id: "dropbox", type: "files", attributes: { name: "dropbox", provider: "dropbox", kind: "folder", path: "/" }, relationships: {} },
          ],
          links: { next: null },
        })
      ),
      http.get("https://files.osf.io/v1/resources/halfbad/providers/osfstorage/", () =>
        new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), { status: 200 })
      ),
      http.get("https://files.osf.io/v1/resources/halfbad/providers/dropbox/", () =>
        new HttpResponse(null, { status: 403 })
      ),
    );
    const req = new Request("http://localhost:4747/api/zip/halfbad");
    const res = await GET(req, { params: Promise.resolve({ guid: "halfbad" }) });
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    // Round-trip through disk: adm-zip's Buffer constructor doesn't parse
    // correctly inside Vitest's jsdom env, but file mode is reliable.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpPath = path.join(os.tmpdir(), `betterosf-test-${Date.now()}.zip`);
    fs.writeFileSync(tmpPath, Buffer.from(buf));
    const unzipper = await import("adm-zip");
    const zip = new unzipper.default(tmpPath);
    const entries = zip.getEntries().map((e) => e.entryName);
    fs.unlinkSync(tmpPath);
    expect(entries.some((n) => n.endsWith("_BETTEROSF_ERRORS.txt"))).toBe(true);
  });
});
