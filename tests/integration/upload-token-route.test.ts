// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { GET as uploadToken } from "@/app/api/osf/upload-token/route";

describe("GET /api/osf/upload-token", () => {
  let authMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
    authMock.mockReset();
  });

  it("refuses anonymous callers", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await uploadToken();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses read-only sessions", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: false });
    const res = await uploadToken();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("refuses sessions whose token needs reconnect", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: true, osfAuthError: "RefreshAccessTokenError" });
    const res = await uploadToken();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("returns the access token (no-store) for a write-capable session", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", osfCanWrite: true, osfAccessTokenExpires: 1234 });
    const res = await uploadToken();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "user-token", expiresAt: 1234 });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("never leaks the refresh token", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-token", refreshToken: "secret-refresh", osfCanWrite: true });
    const res = await uploadToken();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("secret-refresh");
  });
});
