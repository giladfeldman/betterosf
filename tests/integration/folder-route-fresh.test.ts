// @vitest-environment node
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET as folderGet } from "@/app/api/files/[guid]/folder/route";

const listingUrl = "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/data/";

describe("folder route fresh listing", () => {
  it("returns entries for a fresh=1 request with no-store cache header", async () => {
    server.use(
      http.get(listingUrl, () =>
        HttpResponse.json({ data: [
          { id: "f1", type: "files", attributes: { name: "x.csv", kind: "file", materialized_path: "/data/x.csv", size: 9, modified: "" }, links: { download: "https://d" } },
        ], links: { next: null } })
      )
    );
    const req = new Request(`http://localhost:4747/api/files/ezcuj/folder?fresh=1&listingUrl=${encodeURIComponent(listingUrl)}`);
    const res = await folderGet(req, { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(["x.csv"]);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
