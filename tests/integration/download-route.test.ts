import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { GET } from "@/app/api/files/[guid]/download/route";

describe("/api/files/[guid]/download", () => {
  it("retries anonymously when OSF rejects the bearer token for a public file", async () => {
    const seenAuthHeaders: (string | null)[] = [];
    server.use(
      http.get("https://files.osf.io/v1/resources/m3p49/providers/osfstorage/html", ({ request }) => {
        const authHeader = request.headers.get("authorization");
        seenAuthHeaders.push(authHeader);
        if (authHeader) return new HttpResponse("auth rejected", { status: 401 });
        return new HttpResponse("<!doctype html><h1>Loaded</h1>", {
          headers: { "content-type": "application/octet-stream" },
        });
      }),
    );

    const target = encodeURIComponent("https://files.osf.io/v1/resources/m3p49/providers/osfstorage/html");
    const req = new Request(`http://localhost:3000/api/files/m3p49/download?u=${target}&name=preregistration.html`);
    const res = await GET(req, { params: Promise.resolve({ guid: "m3p49" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Loaded");
    expect(seenAuthHeaders).toEqual(["Bearer test-token", null]);
  });
});
