import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { osfGet, osfGetUrl } from "@/lib/osf/client";
import { OsfError } from "@/lib/osf/types";

describe("osfGet", () => {
  it("attaches bearer token and returns parsed JSON", async () => {
    server.use(
      http.get("https://api.osf.io/v2/nodes/abc/", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        return HttpResponse.json({ data: { id: "abc", type: "nodes", attributes: {} } });
      })
    );
    const result = await osfGet("/nodes/abc/");
    expect((result as { data: { id: string } }).data.id).toBe("abc");
  });

  it("maps 404 to OsfError code=not_found", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/xxx/", () => new HttpResponse(null, { status: 404 })));
    await expect(osfGet("/nodes/xxx/")).rejects.toMatchObject({
      name: "OsfError",
      status: 404,
      code: "not_found",
    } satisfies Partial<OsfError>);
  });

  it("maps 403 to forbidden", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/p/", () => new HttpResponse(null, { status: 403 })));
    await expect(osfGet("/nodes/p/")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("maps 429 to rate_limited", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/x/", () => new HttpResponse(null, { status: 429 })));
    await expect(osfGet("/nodes/x/")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps 5xx to upstream", async () => {
    server.use(http.get("https://api.osf.io/v2/nodes/x/", () => new HttpResponse(null, { status: 502 })));
    await expect(osfGet("/nodes/x/")).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("osfGetUrl", () => {
  it("accepts a fully-qualified URL (for paginator next links)", async () => {
    server.use(
      http.get("https://api.osf.io/v2/foo/?page=2", () =>
        HttpResponse.json({ data: [], links: { next: null } })
      )
    );
    const result = await osfGetUrl("https://api.osf.io/v2/foo/?page=2");
    expect(result).toBeDefined();
  });
});
