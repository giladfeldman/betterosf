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

const emptyCollection = () => HttpResponse.json({ data: [], links: { next: null } });

describe("whole-tree ZIP — partial failure inside a child component", () => {
  it("root provider succeeds but child component's provider listing fails: ZIP still streams + errors entry present", async () => {
    server.use(
      // Root project
      http.get("https://api.osf.io/v2/nodes/proj/", () => HttpResponse.json(nodeRow("proj", "Proj"))),
      http.get("https://api.osf.io/v2/nodes/proj/children/", () =>
        HttpResponse.json({ data: [nodeRow("kid", "Kid").data], links: { next: null } })
      ),
      http.get("https://api.osf.io/v2/nodes/proj/linked_nodes/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/proj/files/", () =>
        HttpResponse.json({
          data: [{ id: "osfstorage", type: "files", attributes: { name: "osfstorage", provider: "osfstorage", kind: "folder", path: "/" }, relationships: {} }],
          links: { next: null },
        })
      ),
      http.get("https://files.osf.io/v1/resources/proj/providers/osfstorage/", () =>
        new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        })
      ),
      // Child node — provider listing fails (500)
      http.get("https://api.osf.io/v2/nodes/kid/", () => HttpResponse.json(nodeRow("kid", "Kid"))),
      http.get("https://api.osf.io/v2/nodes/kid/children/", () => emptyCollection()),
      http.get("https://api.osf.io/v2/nodes/kid/files/", () => HttpResponse.json({ errors: [{ detail: "boom" }] }, { status: 500 })),
    );

    const req = new Request("http://localhost:4747/api/zip/proj");
    const res = await GET(req, { params: Promise.resolve({ guid: "proj" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");

    const buf = await res.arrayBuffer();
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpPath = path.join(os.tmpdir(), `betterosf-childfail-${Date.now()}.zip`);
    fs.writeFileSync(tmpPath, Buffer.from(buf));
    const unzipper = await import("adm-zip");
    const zip = new unzipper.default(tmpPath);
    const entries = zip.getEntries().map((e) => e.entryName);
    fs.unlinkSync(tmpPath);

    // The error-log entry is present (content readability inside Vitest+adm-zip is
    // unreliable for stream-appended entries, so we check presence only).
    expect(entries.some((n) => n.endsWith("_BETTEROSF_ERRORS.txt"))).toBe(true);
    // The root provider zip was still appended successfully despite the child failure.
    expect(entries.some((n) => n.endsWith("osfstorage.zip"))).toBe(true);
  });
});
