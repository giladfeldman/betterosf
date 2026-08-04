/**
 * Backlog item (todo.md, 2026-08-04): "Audit remaining `unauthorized` gaps.
 * `classifyWalkFailure` + `osfBackpressureKind` cover the deep-path routes and
 * the five backpressure-aware pages. Other OSF callers (API routes under
 * `src/app/api/`) still map 401 ad hoc; worth a sweep for consistency."
 *
 * The audit found a real defect: `/api/files/[guid]/folder` — the endpoint the
 * file tree calls on EVERY folder expand — mapped an OSF 401 to a generic
 * **500 "Could not load this folder. Please try again later."**
 *
 * That is wrong twice over. It misreports a client-credential problem as a
 * server fault, and "try again later" is unactionable advice for a state that
 * will never fix itself: the user's OSF token is expired and retrying forever
 * cannot renew it. The tree renders the route's message verbatim, so the user
 * saw an infinite-retry message with no route to recovery.
 *
 * Same root cause as the deep-path 401 bug fixed earlier in v1.7.0, in a
 * different layer — and equally invisible to anonymous QA, because an anonymous
 * request sends no bearer token and can never produce a 401.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OsfError } from "@/lib/osf/types";

const getFolderContents = vi.fn();
vi.mock("@/lib/osf/files", () => ({
  getFolderContents: (...a: unknown[]) => getFolderContents(...a),
}));

const LISTING = "https://api.osf.io/v2/nodes/ezcuj/files/osfstorage/";

function req(): Request {
  return new Request(
    `http://localhost:4747/api/files/ezcuj/folder?listingUrl=${encodeURIComponent(LISTING)}`,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("/api/files/[guid]/folder maps OSF failures honestly", () => {
  it("returns 401 (not 500) when the OSF token is expired — THE regression", async () => {
    getFolderContents.mockRejectedValue(
      new OsfError(401, "unauthorized", "OSF authentication required"),
    );
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });

    expect(res.status).toBe(401);
    const body = await res.text();
    // Must point at the actual remedy, not "try again later" — retrying cannot
    // renew an expired token.
    expect(body).toMatch(/reconnect/i);
    expect(body).not.toMatch(/try again later/i);
  });

  it("returns 403 for a genuinely forbidden folder, distinct from expired auth", async () => {
    getFolderContents.mockRejectedValue(new OsfError(403, "forbidden", "forbidden"));
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(403);
  });

  it("returns 429 with Retry-After when OSF rate-limits us", async () => {
    getFolderContents.mockRejectedValue(new OsfError(429, "rate_limited", "slow down"));
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 502 for an OSF upstream failure — ours vs theirs stays distinguishable", async () => {
    getFolderContents.mockRejectedValue(new OsfError(503, "upstream", "osf down"));
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(502);
  });

  it("still 404s a missing folder", async () => {
    getFolderContents.mockRejectedValue(new OsfError(404, "not_found", "gone"));
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(404);
  });

  it("still 500s a genuine unexpected error (a real bug must not be disguised)", async () => {
    getFolderContents.mockRejectedValue(new TypeError("x is not a function"));
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(500);
  });

  it("succeeds normally when OSF is healthy", async () => {
    getFolderContents.mockResolvedValue([{ kind: "file", name: "a.txt" }]);
    const { GET } = await import("@/app/api/files/[guid]/folder/route");
    const res = await GET(req(), { params: Promise.resolve({ guid: "ezcuj" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });
});
