// @vitest-environment node
/**
 * d-f2a1e2 — Move a file or folder to another folder in the same project's OSF Storage.
 *
 * Waterbutler behaviour this pins, measured on a throwaway OSF project on 2026-10-29:
 *   - `{"action":"move","path":"/<folder-id>/","conflict":"warn"}` answers 201 and the item
 *     keeps its id (a move, not a copy-and-delete);
 *   - a same-named item already in the destination answers 409 "already exists" and NOTHING
 *     is moved — which is why `conflict` is always "warn", never "replace" (replace would
 *     overwrite someone's file with no trash to recover it from);
 *   - moving a folder into itself or into its own subfolder answers 500 — OSF refuses, but
 *     with an unhelpful error, so we refuse first with a clear one.
 * Destinations are named by their API listing URL and the provider path is derived from it
 * server-side, pinned to the SAME node and to osfstorage. A registration is never a source
 * or a destination.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/require-user", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logEventAwaited: vi.fn().mockResolvedValue(true),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { POST as movePost } from "@/app/api/files/[guid]/move/route";
import { _resetForTests } from "@/lib/limits";

const GUID = "ezcuj";
const ROOT_LISTING = `https://api.osf.io/v2/nodes/${GUID}/files/osfstorage/`;
const A_ID = "6ae355737974290be5957be1";
const B_ID = "6ae355748680c4a19a69c380";
const A_LISTING = `${ROOT_LISTING}${A_ID}/`;
const B_LISTING = `${ROOT_LISTING}${B_ID}/`;
const REG_LISTING = `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/`;
const WB = `https://files.osf.io/v1/resources/${GUID}/providers/osfstorage`;

function body(overrides: Record<string, unknown> = {}) {
  return {
    provider: "osfstorage",
    kind: "file",
    path: "/data.csv",
    name: "data.csv",
    moveUrl: `${WB}/6ae355786a10287dfa957bc0`,
    listingUrl: ROOT_LISTING,
    destListingUrl: A_LISTING,
    destPath: "/A/",
    ...overrides,
  };
}

function call(payload: unknown) {
  return movePost(
    new Request(`http://localhost:4747/api/files/${GUID}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ guid: GUID }) },
  );
}

describe("move route", () => {
  let authMock: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    _resetForTests();
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
    authMock.mockReset();
    authMock.mockResolvedValue({ accessToken: "tok", osfCanWrite: true, osfUserId: "osf-user-1" });
    const { requireAppUser } = await import("@/lib/db/require-user");
    (requireAppUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, userId: "u1", osfUserId: "osf-user-1" });
    fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("gates reject before any OSF call", () => {
    it("refuses anonymous requests", async () => {
      authMock.mockResolvedValue(null);
      const res = await call(body());
      expect(res.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses read-only sessions", async () => {
      authMock.mockResolvedValue({ accessToken: "tok", osfCanWrite: false });
      expect((await call(body())).status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a registration as the source", async () => {
      const json = await (await call(body({ listingUrl: REG_LISTING }))).json();
      expect(json.result.status).toBe("failed");
      expect(json.result.message).toMatch(/registration/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["a registration folder", `https://api.osf.io/v2/registrations/${GUID}/files/osfstorage/${A_ID}/`],
      ["another project's folder", `https://api.osf.io/v2/nodes/zzzzz/files/osfstorage/${A_ID}/`],
      ["another provider", `https://api.osf.io/v2/nodes/${GUID}/files/dropbox/${A_ID}/`],
      ["a foreign host", `https://evil.example.com/v2/nodes/${GUID}/files/osfstorage/${A_ID}/`],
      ["a path that is not a folder id", `${ROOT_LISTING}..%2F..%2F/`],
      ["a query string", `${A_LISTING}?confirm_delete=1`],
    ])("refuses %s as the destination", async (_label, dest) => {
      const res = await call(body({ destListingUrl: dest }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses moving an item to the folder it is already in", async () => {
      const res = await call(body({ destListingUrl: ROOT_LISTING, destPath: "/" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/already in that folder/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["into itself", A_LISTING, "/A/"],
      ["into its own subfolder", B_LISTING, "/A/B/"],
    ])("refuses moving a folder %s", async (_label, dest, destPath) => {
      const res = await call(
        body({ kind: "folder", path: "/A/", name: "A", moveUrl: `${WB}/${A_ID}/`, destListingUrl: dest, destPath }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/inside itself/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("the OSF call", () => {
    it("moves with conflict=warn to the provider path derived from the destination", async () => {
      const res = await call(body());
      const json = await res.json();
      expect(json).toMatchObject({ ok: true, result: { status: "moved" } });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe(`${WB}/6ae355786a10287dfa957bc0`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ action: "move", path: `/${A_ID}/`, conflict: "warn" });
    });

    it("the project root is a valid destination", async () => {
      await call(body({ path: "/A/data.csv", listingUrl: A_LISTING, destListingUrl: ROOT_LISTING, destPath: "/" }));
      const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
      expect(JSON.parse(String(init.body)).path).toBe("/");
    });

    it("a name clash (409) says nothing was moved and never retries with replace", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ message: 'Cannot complete action: file or folder "data.csv" already exists in this location' }), { status: 409 }),
      );
      const json = await (await call(body())).json();
      expect(json.ok).toBe(false);
      expect(json.result).toMatchObject({ status: "failed", code: "conflict" });
      expect(json.result.message).toMatch(/already/i);
      expect(json.result.message).toMatch(/nothing was moved/i);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
        expect(String(init.body)).not.toMatch(/replace/);
      }
    });

    it("an OSF failure is a failed result, never a success", async () => {
      fetchSpy.mockResolvedValue(new Response("{}", { status: 500 }));
      const json = await (await call(body())).json();
      expect(json.ok).toBe(false);
      expect(json.result.status).toBe("failed");
    });
  });
});
