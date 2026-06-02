// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { POST as uploadPost } from "@/app/api/files/[guid]/upload/route";
import { POST as folderPost } from "@/app/api/files/[guid]/folder-create/route";

describe("OSF Storage write routes", () => {
  let authMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
    authMock.mockReset();
  });

  function uploadRequest(fields: Record<string, string>, file = new File(["hello"], "hello.txt", { type: "text/plain" })) {
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request("http://localhost:3000/api/files/ezcuj/upload", { method: "POST", body: form });
  }

  const validFields = {
    provider: "osfstorage",
    path: "/Data With Spaces/",
    listingUrl: "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/data/",
  };

  it("refuses anonymous uploads before calling OSF", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await uploadPost(uploadRequest(validFields), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  it("refuses read-only sessions", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: false });
    const res = await uploadPost(uploadRequest(validFields), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("rejects non-OSF Storage providers", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: true });
    const res = await uploadPost(uploadRequest({ ...validFields, provider: "dropbox" }), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid" });
  });

  it("rejects registration listing URLs", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: true });
    const res = await uploadPost(uploadRequest({
      ...validFields,
      listingUrl: "https://api.osf.io/v2/registrations/abc12/files/osfstorage/",
    }), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid" });
  });

  it("rejects encoded slashes in upload paths and names", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    const badPath = await uploadPost(uploadRequest({ ...validFields, path: "/Data%2FLeak/" }), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(badPath.status).toBe(400);
    expect(await badPath.json()).toMatchObject({ code: "invalid" });

    const badName = await uploadPost(
      uploadRequest(validFields, new File(["hello"], "bad%2Fname.txt", { type: "text/plain" })),
      { params: Promise.resolve({ guid: "ezcuj" }) }
    );
    expect(badName.status).toBe(400);
    expect(await badName.json()).toMatchObject({ code: "invalid" });
  });

  it("returns 409 when the target folder already has that name", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    server.use(
      http.get(validFields.listingUrl, () =>
        HttpResponse.json({
          data: [
            { id: "f1", type: "files", attributes: { name: "hello.txt", kind: "file", materialized_path: "/Data With Spaces/hello.txt", size: 5, modified: "" }, links: { download: "https://x" } },
          ],
          links: { next: null },
        })
      )
    );
    const res = await uploadPost(uploadRequest(validFields), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict" });
  });

  it("uploads to WaterButler with the signed-in user token", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    const seenAuth: string[] = [];
    server.use(
      http.get(validFields.listingUrl, () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.put("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/Data%20With%20Spaces/", ({ request }) => {
        seenAuth.push(request.headers.get("authorization") ?? "");
        const url = new URL(request.url);
        expect(url.searchParams.get("kind")).toBe("file");
        expect(url.searchParams.get("name")).toBe("hello.txt");
        return HttpResponse.json({ data: { id: "new-file" } });
      })
    );
    const res = await uploadPost(uploadRequest(validFields), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(200);
    expect(seenAuth).toEqual(["Bearer user-token"]);
  });

  it("prefers OSF's canonical folder upload link when present", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    const canonicalUrl = "https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/abc123folder";
    const seenUrls: string[] = [];
    server.use(
      http.get(validFields.listingUrl, () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.put(canonicalUrl, ({ request }) => {
        seenUrls.push(request.url);
        const url = new URL(request.url);
        expect(url.searchParams.get("kind")).toBe("file");
        expect(url.searchParams.get("name")).toBe("hello.txt");
        return HttpResponse.json({ data: { id: "new-file" } });
      })
    );
    const res = await uploadPost(
      uploadRequest({ ...validFields, uploadUrl: canonicalUrl }),
      { params: Promise.resolve({ guid: "ezcuj" }) }
    );
    expect(res.status).toBe(200);
    expect(seenUrls[0]).toContain(canonicalUrl);
  });

  it("maps upstream HTML upload failures to a readable error", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    server.use(
      http.get(validFields.listingUrl, () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.put("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/Data%20With%20Spaces/", () =>
        new HttpResponse("<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );
    const res = await uploadPost(uploadRequest(validFields), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: "upstream",
      error: "OSF returned an HTML error page: 502 Bad Gateway",
    });
  });

  it("creates folders through the write helper", async () => {
    authMock.mockResolvedValue({ accessToken: "user-token", osfCanWrite: true });
    server.use(
      http.get(validFields.listingUrl, () =>
        HttpResponse.json({ data: [], links: { next: null } })
      ),
      http.put("https://files.osf.io/v1/resources/ezcuj/providers/osfstorage/Data%20With%20Spaces/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("kind")).toBe("folder");
        expect(url.searchParams.get("name")).toBe("New Folder");
        return HttpResponse.json({ data: { id: "new-folder" } });
      })
    );
    const req = new Request("http://localhost:3000/api/files/ezcuj/folder-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validFields, name: "New Folder" }),
    });
    const res = await folderPost(req, { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(200);
  });
});
