/**
 * d-24370c: when OSF's licence list cannot be read, the apply route answered a flat 502 and
 * threw the error away, so nine such answers in production could not be explained. Pinned:
 * OSF's own status reaches the user, and the log row keeps the cause.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OsfError } from "@/lib/osf/types";
import { auth } from "@/auth";

const listOsfLicences = vi.fn();
vi.mock("@/lib/osf/licences", () => ({
  listOsfLicences: (...a: unknown[]) => listOsfLicences(...a),
  applyLicence: vi.fn(),
}));
const warn = vi.fn();
vi.mock("@/lib/logger", async (orig) => ({
  ...(await orig<typeof import("@/lib/logger")>()),
  logWarn: (...a: unknown[]) => warn(...a),
}));

import { POST } from "@/app/api/licences/apply/route";

const authMock = vi.mocked(auth);
const call = () =>
  POST(new Request("http://localhost:4747/api/licences/apply", {
    method: "POST",
    body: JSON.stringify({ guids: ["abc12"], licenceId: "lic1", copyrightHolders: ["A"], year: "2026" }),
  }));

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00Z"), toFake: ["Date"] });
  listOsfLicences.mockReset();
  warn.mockClear();
  authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } } as never);
});

describe("licence apply: OSF licence list failure", () => {
  it("an OSF 429 reaches the user as 429, not a flat 502", async () => {
    listOsfLicences.mockRejectedValue(new OsfError(429, "rate_limited", "slow down"));
    const res = await call();
    expect(res.status).toBe(429);
  });

  it("an unknown failure is a 502 whose log row keeps the cause", async () => {
    listOsfLicences.mockRejectedValue(new Error("socket hang up"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("licence_list_failed");
    const ctx = warn.mock.calls.find((c) => String(c[1]).startsWith("licence_list_failed"))?.[2] as Record<string, unknown>;
    expect(JSON.stringify(ctx?.cause ?? null)).toContain("socket hang up");
  });
});
