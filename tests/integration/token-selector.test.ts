import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

describe("selectToken", () => {
  let authMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
    authMock.mockReset();
  });

  it("returns app token when no session", async () => {
    authMock.mockResolvedValueOnce(null);
    const { selectToken } = await import("@/lib/osf/tokens");
    const t = await selectToken();
    expect(t).toBe("test-token"); // from tests/setup.ts
  });

  it("returns session.accessToken when signed in", async () => {
    authMock.mockResolvedValueOnce({ accessToken: "user-osf-token", osfUserId: "u1" });
    const { selectToken } = await import("@/lib/osf/tokens");
    const t = await selectToken();
    expect(t).toBe("user-osf-token");
  });

  it("falls back to app token when session has no accessToken", async () => {
    authMock.mockResolvedValueOnce({ osfUserId: "u1" });
    const { selectToken } = await import("@/lib/osf/tokens");
    const t = await selectToken();
    expect(t).toBe("test-token");
  });
});
