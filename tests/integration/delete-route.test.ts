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

import { POST as deletePost } from "@/app/api/files/[guid]/delete/route";
import { TERMS_VERSION } from "@/lib/terms";
import { _resetForTests } from "@/lib/limits";

const GUID = "ezcuj";
const NODE_LISTING = `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`;
const REG_LISTING = `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/`;
const WB = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage`;

function item(overrides: Record<string, unknown> = {}) {
  return {
    kind: "file",
    path: "/data.csv",
    name: "data.csv",
    deleteUrl: `${WB}/5f1a`,
    listingUrl: NODE_LISTING,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    provider: "osfstorage",
    items: [item()],
    confirmationPhrase: "data.csv",
    acknowledged: false,
    subject: { mode: "file", name: "data.csv" },
    termsVersion: TERMS_VERSION,
    ...overrides,
  };
}

function request(payload: unknown) {
  return new Request(`http://localhost:3000/api/files/${GUID}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function call(payload: unknown) {
  return deletePost(request(payload), { params: Promise.resolve({ guid: GUID }) });
}

describe("delete route", () => {
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

    // Every upstream DELETE goes through global fetch; spying lets us assert that the
    // rejection paths never reach OSF at all.
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
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
      const res = await call(body({ items: [item({ listingUrl: REG_LISTING })] }));
      const json = await res.json();
      expect(json.results[0].status).toBe("failed");
      expect(json.results[0].message).toMatch(/registration/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses the provider root", async () => {
      const res = await call(
        body({
          items: [item({ kind: "folder", deleteUrl: `${WB}/`, name: "osfstorage" })],
          confirmationPhrase: "delete osfstorage and 1 item permanently",
          acknowledged: true,
          subject: { mode: "folder", name: "osfstorage", itemCount: 1 },
        })
      );
      const json = await res.json();
      expect(json.results[0].status).toBe("failed");
      expect(json.results[0].message).toMatch(/root/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses confirm_delete smuggled onto the root", async () => {
      const res = await call(
        body({
          items: [item({ kind: "folder", deleteUrl: `${WB}/?confirm_delete=1`, name: "osfstorage" })],
          confirmationPhrase: "delete osfstorage and 1 item permanently",
          acknowledged: true,
          subject: { mode: "folder", name: "osfstorage", itemCount: 1 },
        })
      );
      expect((await res.json()).results[0].status).toBe("failed");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a foreign delete host", async () => {
      const res = await call(body({ items: [item({ deleteUrl: "https://evil.example.com/v1/resources/ezcuj/providers/osfstorage/x" })] }));
      expect((await res.json()).results[0].status).toBe("failed");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a non-osfstorage provider at the schema", async () => {
      const res = await call(body({ provider: "dropbox" }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("consent gates", () => {
    it("rejects a mismatched confirmation phrase with zero OSF calls", async () => {
      const res = await call(body({ confirmationPhrase: "data.cs" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/did not match/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a stale terms version", async () => {
      const res = await call(body({ termsVersion: "1999-01-01" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/terms/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("requires the acknowledgement checkbox for bulk deletes", async () => {
      const res = await call(
        body({
          items: [item(), item({ path: "/b.csv", name: "b.csv", deleteUrl: `${WB}/5f1b` })],
          confirmationPhrase: "delete 2 items permanently",
          acknowledged: false,
          subject: { mode: "bulk", itemCount: 2 },
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/acknowledge/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("accepts a bulk delete once acknowledged", async () => {
      const res = await call(
        body({
          items: [item(), item({ path: "/b.csv", name: "b.csv", deleteUrl: `${WB}/5f1b` })],
          confirmationPhrase: "delete 2 items permanently",
          acknowledged: true,
          subject: { mode: "bulk", itemCount: 2 },
        })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).deleted).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does NOT require acknowledgement for a single file", async () => {
      const res = await call(body());
      expect(res.status).toBe(200);
      expect((await res.json()).deleted).toBe(1);
    });
  });

  describe("schema limits", () => {
    it("rejects an empty item list", async () => {
      const res = await call(body({ items: [] }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects more than 100 items", async () => {
      const items = Array.from({ length: 101 }, (_, i) => item({ path: `/f${i}.csv`, name: `f${i}.csv`, deleteUrl: `${WB}/id${i}` }));
      const res = await call(body({ items, confirmationPhrase: "delete 101 items permanently", acknowledged: true, subject: { mode: "bulk", itemCount: 101 } }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a malformed body", async () => {
      const res = await deletePost(
        new Request(`http://localhost:3000/api/files/${GUID}/delete`, { method: "POST", body: "not json" }),
        { params: Promise.resolve({ guid: GUID }) }
      );
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("outgoing request shape", () => {
    it("issues DELETE with no query string", async () => {
      await call(body({ items: [item({ deleteUrl: `${WB}/5f1a?confirm_delete=1` })] }));
      const firstCall = fetchSpy.mock.calls[0]!;
      expect(firstCall[1].method).toBe("DELETE");
      expect(String(firstCall[0])).not.toContain("?");
      expect(String(firstCall[0])).not.toContain("confirm_delete");
    });

    it("sends the bearer token", async () => {
      await call(body());
      expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok");
    });

    it("ends a folder URL with a slash and a file URL without", async () => {
      await call(
        body({
          items: [item({ kind: "folder", deleteUrl: `${WB}/5f1a`, name: "sub" })],
          confirmationPhrase: "delete sub and 3 items permanently",
          acknowledged: true,
          subject: { mode: "folder", name: "sub", itemCount: 3 },
        })
      );
      expect(String(fetchSpy.mock.calls[0]![0]).endsWith("/")).toBe(true);

      fetchSpy.mockClear();
      await call(body({ items: [item({ deleteUrl: `${WB}/5f1a/` })] }));
      expect(String(fetchSpy.mock.calls[0]![0]).endsWith("/")).toBe(false);
    });
  });

  describe("result reporting", () => {
    it("reports 204 as deleted", async () => {
      const res = await call(body());
      expect((await res.json()).results[0].status).toBe("deleted");
    });

    it("reports 404 as already_gone so retries are idempotent", async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
      const res = await call(body());
      const json = await res.json();
      expect(json.results[0].status).toBe("already_gone");
      expect(json.alreadyGone).toBe(1);
      expect(json.ok).toBe(true);
    });

    it("reports a mixed batch per item rather than one opaque status", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response("nope", { status: 403 }));
      const items = [
        item({ path: "/a.csv", name: "a.csv", deleteUrl: `${WB}/a` }),
        item({ path: "/b.csv", name: "b.csv", deleteUrl: `${WB}/b` }),
        item({ path: "/c.csv", name: "c.csv", deleteUrl: `${WB}/c` }),
      ];
      const res = await call(
        body({ items, confirmationPhrase: "delete 3 items permanently", acknowledged: true, subject: { mode: "bulk", itemCount: 3 } })
      );
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.deleted).toBe(1);
      expect(json.alreadyGone).toBe(1);
      expect(json.failed).toBe(1);
      expect(json.results.map((r: { status: string }) => r.status)).toEqual(["deleted", "already_gone", "failed"]);
    });

    it("keeps going after a mid-batch failure so the report is complete", async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response("boom", { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      const items = [
        item({ path: "/a.csv", name: "a.csv", deleteUrl: `${WB}/a` }),
        item({ path: "/b.csv", name: "b.csv", deleteUrl: `${WB}/b` }),
      ];
      const res = await call(
        body({ items, confirmationPhrase: "delete 2 items permanently", acknowledged: true, subject: { mode: "bulk", itemCount: 2 } })
      );
      const json = await res.json();
      expect(json.results).toHaveLength(2);
      expect(json.deleted).toBe(1);
      expect(json.failed).toBe(1);
    });

    it("surfaces a network error as failed, not silently deleted", async () => {
      fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
      const res = await call(body());
      const json = await res.json();
      expect(json.results[0].status).toBe("failed");
      expect(json.results[0].message).toMatch(/NOT deleted/i);
    });
  });

  describe("consent record", () => {
    it("writes the consent row BEFORE the first delete", async () => {
      const { logEventAwaited } = await import("@/lib/logger");
      const order: string[] = [];
      (logEventAwaited as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_l: string, _t: string, msg: string) => {
        order.push(msg.startsWith("delete requested") ? "consent" : "summary");
        return true;
      });
      fetchSpy.mockImplementation(async () => {
        order.push("delete");
        return new Response(null, { status: 204 });
      });
      await call(body());
      expect(order[0]).toBe("consent");
      expect(order).toContain("delete");
    });

    it("records the typed phrase and terms version", async () => {
      const { logEventAwaited } = await import("@/lib/logger");
      await call(body());
      const consentCall = (logEventAwaited as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[2]).startsWith("delete requested")
      );
      expect(consentCall?.[3]).toMatchObject({
        confirmationPhrase: "data.csv",
        termsVersion: TERMS_VERSION,
        itemCount: 1,
      });
    });
  });
});
