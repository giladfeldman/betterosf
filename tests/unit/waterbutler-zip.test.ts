import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { fetchProviderZip } from "@/lib/waterbutler/zip";

describe("fetchProviderZip", () => {
  it("returns ok with body stream on 200", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/abc/providers/osfstorage/", () =>
        new HttpResponse(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        })
      )
    );
    const result = await fetchProviderZip("abc", "osfstorage");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.body).toBeDefined();
    }
  });

  it("returns error on 403", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/x/providers/dropbox/", () => new HttpResponse(null, { status: 403 }))
    );
    const result = await fetchProviderZip("x", "dropbox");
    expect(result).toMatchObject({ status: "error", code: 403 });
  });

  it("returns error on network failure", async () => {
    server.use(
      http.get("https://files.osf.io/v1/resources/x/providers/github/", () => HttpResponse.error())
    );
    const result = await fetchProviderZip("x", "github");
    expect(result).toMatchObject({ status: "error" });
  });
});
