/**
 * `/api/osf/children/[guid]` — the components of one node, fetched when a user opens a
 * component in the navigator (nested components).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/osf/nodes", () => ({ getAllChildren: vi.fn() }));

import { GET } from "@/app/api/osf/children/[guid]/route";
import { getAllChildren } from "@/lib/osf/nodes";
import { OsfError } from "@/lib/osf/types";

function call(guid = "abc12") {
  return GET(new Request(`http://localhost:4747/api/osf/children/${guid}`), { params: Promise.resolve({ guid }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/osf/children/[guid]", () => {
  it("returns each child un-indexed, with its own component count when OSF gave one", async () => {
    vi.mocked(getAllChildren).mockResolvedValue([
      { id: "kid01", title: "Study 1", category: "data", public: true, childCount: 2 },
      { id: "kid02", title: "", category: "", public: false },
    ] as never);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.children).toEqual([
      { guid: "kid01", title: "Study 1", category: "data", isPublic: true, skeleton: [], skipped: true, childCount: 2 },
      // Untitled falls back to the guid; an unreported count stays absent (unknown), not 0.
      { guid: "kid02", title: "kid02", category: "", isPublic: false, skeleton: [], skipped: true },
    ]);
  });

  it("rejects an invalid guid without calling OSF", async () => {
    const res = await call("not a guid!");
    expect(res.status).toBe(400);
    expect(getAllChildren).not.toHaveBeenCalled();
  });

  it("passes OSF rate limiting through as 429, not a fake empty list", async () => {
    vi.mocked(getAllChildren).mockRejectedValue(new OsfError(429, "rate_limited", "slow down"));
    const res = await call();
    expect(res.status).toBe(429);
  });

  it("an unexpected failure is a 500 with a message, not an empty list", async () => {
    vi.mocked(getAllChildren).mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/Could not load/);
  });
});
