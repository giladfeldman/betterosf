// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/require-user", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logEventAwaited: vi.fn().mockResolvedValue(true),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { POST as renamePost } from "@/app/api/files/[guid]/rename/route";
import { _resetForTests } from "@/lib/limits";

const GUID = "ezcuj";
const NODE_LISTING = `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`;
const REG_LISTING = `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/`;
const WB = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage`;

function body(overrides: Record<string, unknown> = {}) {
  return {
    provider: "osfstorage",
    kind: "file",
    path: "/data.csv",
    name: "data.csv",
    newName: "renamed.csv",
    moveUrl: `${WB}/5f1a`,
    listingUrl: NODE_LISTING,
    ...overrides,
  };
}

function request(payload: unknown) {
  return new Request(`http://localhost:4747/api/files/${GUID}/rename`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function call(payload: unknown) {
  return renamePost(request(payload), { params: Promise.resolve({ guid: GUID }) });
}

describe("rename route", () => {
  let authMock: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    _resetForTests();
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
    authMock.mockReset();
    authMock.mockResolvedValue({ accessToken: "tok", osfCanWrite: true, osfUserId: "osf-user-1" });

    const { requireAppUser } = await import("@/lib/db/require-user");
    (requireAppUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      userId: "app-user-1",
      osfUserId: "osf-user-1",
    });

    // Every upstream POST goes through global fetch; spying lets us assert that the
    // rejection paths never reach OSF at all.
    fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("auth gates reject before any OSF call", () => {
    it("refuses anonymous requests", async () => {
      authMock.mockResolvedValue(null);
      const res = await call(body());
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthorized" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses read-only sessions", async () => {
      authMock.mockResolvedValue({ accessToken: "tok", osfCanWrite: false });
      const res = await call(body());
      expect(res.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a session needing reconnect", async () => {
      authMock.mockResolvedValue({ accessToken: "tok", osfCanWrite: true, osfAuthError: "RefreshAccessTokenError" });
      const res = await call(body());
      expect(res.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("target gates reject before any OSF call", () => {
    it("refuses a registration listing URL", async () => {
      // The single most important check: registration and node Waterbutler URLs are
      // origin-identical, so only the listingUrl pin distinguishes them.
      const res = await call(body({ listingUrl: REG_LISTING }));
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.result.status).toBe("failed");
      expect(json.result.message).toMatch(/registration/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses the provider root", async () => {
      const res = await call(body({ kind: "folder", moveUrl: `${WB}/`, name: "osfstorage" }));
      const json = await res.json();
      expect(json.result.status).toBe("failed");
      expect(json.result.message).toMatch(/root/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a foreign move host", async () => {
      const res = await call(body({ moveUrl: `https://evil.example.com/v1/resources/${GUID}/providers/osfstorage/x` }));
      expect((await res.json()).result.status).toBe("failed");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a non-osfstorage provider at the schema", async () => {
      const res = await call(body({ provider: "dropbox" }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("new-name validation rejects before any OSF call", () => {
    for (const bad of ["a/b", "a\\b", ".", "..", "   "]) {
      it(`rejects ${JSON.stringify(bad)}`, async () => {
        const res = await call(body({ newName: bad }));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "invalid" });
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }

    it("rejects an unchanged name", async () => {
      const res = await call(body({ newName: "data.csv" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/same/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a name over 1024 chars at the schema", async () => {
      const res = await call(body({ newName: "x".repeat(1025) }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a malformed body", async () => {
      const res = await renamePost(
        new Request(`http://localhost:4747/api/files/${GUID}/rename`, { method: "POST", body: "not json" }),
        { params: Promise.resolve({ guid: GUID }) }
      );
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("outgoing request shape", () => {
    it("issues POST with the Waterbutler rename body and no query string", async () => {
      await call(body({ moveUrl: `${WB}/5f1a?foo=1` }));
      const firstCall = fetchSpy.mock.calls[0]!;
      expect(firstCall[1].method).toBe("POST");
      expect(String(firstCall[0])).not.toContain("?");
      expect(JSON.parse(firstCall[1].body)).toEqual({ action: "rename", rename: "renamed.csv" });
    });

    it("sends the bearer token", async () => {
      await call(body());
      expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok");
    });

    it("trims the new name before sending it", async () => {
      await call(body({ newName: "  spaced.csv  " }));
      expect(JSON.parse(fetchSpy.mock.calls[0]![1].body)).toEqual({ action: "rename", rename: "spaced.csv" });
    });

    it("ends a folder URL with a slash and a file URL without", async () => {
      await call(body({ kind: "folder", moveUrl: `${WB}/5f1a`, name: "sub", newName: "sub2" }));
      expect(String(fetchSpy.mock.calls[0]![0]).endsWith("/")).toBe(true);

      fetchSpy.mockClear();
      await call(body({ moveUrl: `${WB}/5f1a/` }));
      expect(String(fetchSpy.mock.calls[0]![0]).endsWith("/")).toBe(false);
    });
  });

  describe("result reporting", () => {
    it("reports 200 as renamed", async () => {
      const res = await call(body());
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.result.status).toBe("renamed");
      expect(json.result.newName).toBe("renamed.csv");
    });

    it("reports 201 as renamed", async () => {
      fetchSpy.mockResolvedValue(new Response("{}", { status: 201 }));
      const res = await call(body());
      expect((await res.json()).result.status).toBe("renamed");
    });

    it("reports 404 as FAILED — a missing item is not a successful rename", async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
      const res = await call(body());
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.result.status).toBe("failed");
      expect(json.result.message).toMatch(/no longer exists/i);
    });

    it("reports 409 as a name conflict", async () => {
      fetchSpy.mockResolvedValue(new Response("{}", { status: 409 }));
      const res = await call(body());
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.result.code).toBe("conflict");
    });

    it("surfaces a network error as failed, not silently renamed", async () => {
      fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
      const res = await call(body());
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.result.status).toBe("failed");
      expect(json.result.message).toMatch(/NOT renamed/i);
    });
  });

  describe("audit trail", () => {
    it("writes the intent row BEFORE the OSF call and a summary after", async () => {
      const { logEventAwaited } = await import("@/lib/logger");
      const order: string[] = [];
      (logEventAwaited as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_l: string, _t: string, msg: string) => {
        order.push(msg.startsWith("rename requested") ? "intent" : "summary");
        return true;
      });
      fetchSpy.mockImplementation(async () => {
        order.push("rename");
        return new Response("{}", { status: 200 });
      });
      await call(body());
      expect(order).toEqual(["intent", "rename", "summary"]);
    });

    it("logs the failure summary at warn level", async () => {
      const { logEventAwaited } = await import("@/lib/logger");
      fetchSpy.mockResolvedValue(new Response("nope", { status: 403 }));
      await call(body());
      const summaryCall = (logEventAwaited as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[2]).startsWith("rename finished")
      );
      expect(summaryCall?.[0]).toBe("warn");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after 60 renames in a minute, without calling OSF", async () => {
      for (let i = 0; i < 60; i += 1) {
        const res = await call(body());
        expect(res.status).toBe(200);
      }
      fetchSpy.mockClear();
      const res = await call(body());
      expect(res.status).toBe(429);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
