/**
 * d-ff4462 (2026-11-18): an anonymous visitor must never be served with an app-owned OSF
 * token. The account behind the old OSF_APP_TOKEN was a contributor on 104 private
 * projects, so every route that "fell back to the app token" for a signed-out visitor
 * could hand that visitor private files. tests/setup.ts still sets OSF_APP_TOKEN to
 * "test-token" as a canary: no request may ever carry it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

let authMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  const { auth } = await import("@/auth");
  authMock = auth as unknown as ReturnType<typeof vi.fn>;
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

describe("userTokenOrAnonymous", () => {
  it("is empty for an anonymous visitor, never the app token", async () => {
    const { userTokenOrAnonymous } = await import("@/lib/osf/tokens");
    expect(await userTokenOrAnonymous()).toBe("");
  });

  it("returns the signed-in user's own token", async () => {
    authMock.mockResolvedValue({ accessToken: "user-osf-token", osfUserId: "u1" });
    const { userTokenOrAnonymous } = await import("@/lib/osf/tokens");
    expect(await userTokenOrAnonymous()).toBe("user-osf-token");
  });

  it("is empty for a session without a token, or whose refresh failed", async () => {
    const { userTokenOrAnonymous } = await import("@/lib/osf/tokens");
    authMock.mockResolvedValue({ osfUserId: "u1" });
    expect(await userTokenOrAnonymous()).toBe("");
    authMock.mockResolvedValue({ accessToken: "stale", osfAuthError: "RefreshFailed" });
    expect(await userTokenOrAnonymous()).toBe("");
  });

  it("is empty when auth() throws", async () => {
    authMock.mockRejectedValue(new Error("no request context"));
    const { userTokenOrAnonymous } = await import("@/lib/osf/tokens");
    expect(await userTokenOrAnonymous()).toBe("");
  });
});

describe("every anonymous OSF request goes out with no Authorization header", () => {
  function recordAuth(url: string, body: () => Response) {
    const seen: (string | null)[] = [];
    server.use(
      http.get(url, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return body();
      }),
    );
    return seen;
  }

  it("download proxy", async () => {
    const seen = recordAuth("https://files.osf.io/v1/resources/abcde/providers/osfstorage/f1", () => new HttpResponse("x"));
    const { GET } = await import("@/app/api/files/[guid]/download/route");
    const u = encodeURIComponent("https://files.osf.io/v1/resources/abcde/providers/osfstorage/f1");
    await GET(new Request(`http://localhost:4747/api/files/abcde/download?u=${u}`), { params: Promise.resolve({ guid: "abcde" }) });
    expect(seen).toEqual([null]);
  });

  it("single-provider ZIP route", async () => {
    const seen = recordAuth("https://files.osf.io/v1/resources/abcde/providers/osfstorage/", () => new HttpResponse("zip"));
    const { GET } = await import("@/app/api/zip/[guid]/[provider]/[[...path]]/route");
    await GET(new Request("http://localhost:4747/api/zip/abcde/osfstorage"), { params: Promise.resolve({ guid: "abcde", provider: "osfstorage" }) });
    expect(seen).toEqual([null]);
  });

  it("ZIP helper used by the whole-project and selection ZIPs", async () => {
    const seen = recordAuth("https://files.osf.io/v1/resources/abcde/providers/osfstorage/", () => new HttpResponse("zip"));
    const { fetchProviderZip } = await import("@/lib/waterbutler/zip");
    await fetchProviderZip("abcde", "osfstorage", "/");
    expect(seen).toEqual([null]);
  });

  it("OSF API client", async () => {
    const seen = recordAuth("https://api.osf.io/v2/nodes/abcde/", () => HttpResponse.json({ data: { id: "abcde" } }));
    const { osfGet } = await import("@/lib/osf/client");
    await osfGet("/nodes/abcde/");
    expect(seen).toEqual([null]);
  });
});

describe("no source file reads an app-owned OSF token", () => {
  it("OSF_APP_TOKEN appears nowhere in src/ except the comment recording its removal", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) {
          readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            if (line.includes("OSF_APP_TOKEN") && !line.trim().startsWith("//")) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
