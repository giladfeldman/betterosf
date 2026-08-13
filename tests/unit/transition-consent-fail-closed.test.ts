// The real fail-closed behaviour of the consent lookup, with the database broken.
//
// Its own file because it must NOT mock @/lib/db/transition-consents — that module's
// try/catch is the thing under test. The route test mocks it, which is right there and
// wrong here.
//
// Why it matters: if a Neon blip made the lookup throw and something upstream read that
// as "no error, carry on", an unconsented user would reach a feature that deposits their
// data to a third party. A database being down must never widen access.

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireDb = vi.fn();
vi.mock("@/lib/db", () => ({
  requireDb: () => requireDb(),
  getDb: () => null,
  _resetDbForTests: () => {},
}));

import { userHasToolkitConsent, listToolkitConsents } from "@/lib/db/transition-consents";

beforeEach(() => {
  requireDb.mockReset();
});

describe("userHasToolkitConsent with a broken database", () => {
  it("returns false when DATABASE_URL is unset", async () => {
    requireDb.mockImplementation(() => {
      throw new Error("DATABASE_URL is not configured.");
    });
    expect(await userHasToolkitConsent("osf1")).toBe(false);
  });

  it("returns false when the query itself throws", async () => {
    requireDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.reject(new Error("connection reset")),
            }),
          }),
        }),
      }),
    });
    expect(await userHasToolkitConsent("osf1")).toBe(false);
  });

  it("returns false — not true — when the user simply has no rows", async () => {
    requireDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }),
        }),
      }),
    });
    expect(await userHasToolkitConsent("osf1")).toBe(false);
  });

  it("propagates the raw error from listToolkitConsents so callers can distinguish", async () => {
    // The swallowing is deliberate ONLY in userHasToolkitConsent, where the answer is a
    // boolean gate. A caller wanting to tell "down" from "not consented" uses this.
    requireDb.mockImplementation(() => {
      throw new Error("DATABASE_URL is not configured.");
    });
    await expect(listToolkitConsents("osf1")).rejects.toThrow(/DATABASE_URL/);
  });
});
