import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { POST } from "@/app/api/zip/[guid]/selection/route";

describe("selected-items ZIP route", () => {
  it("rejects unknown providers", async () => {
    const res = await POST(
      new Request("http://localhost/api/zip/abcde/selection", {
        method: "POST",
        body: JSON.stringify({
          items: [{ kind: "folder", guid: "abcde", provider: "badprovider", path: "/", name: "bad" }],
        }),
      }),
      { params: Promise.resolve({ guid: "abcde" }) }
    );
    expect(res.status).toBe(400);
  });

  it("streams a selected file into a zip", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/abcde/providers/osfstorage/file.txt", () =>
        new HttpResponse("hello", { status: 200 })
      )
    );
    const res = await POST(
      new Request("http://localhost/api/zip/abcde/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            kind: "file",
            guid: "abcde",
            provider: "osfstorage",
            path: "/file.txt",
            name: "file.txt",
            downloadUrl: "https://files.osf.io/v1/resources/abcde/providers/osfstorage/file.txt",
          }],
        }),
      }),
      { params: Promise.resolve({ guid: "abcde" }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
