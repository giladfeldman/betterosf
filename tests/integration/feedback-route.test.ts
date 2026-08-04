/**
 * Contract tests for the bug-report endpoints (feature added 2026-08-04).
 *
 * Two failure modes matter here and neither is cosmetic:
 *  1. Telling a user "thanks, received!" when the report was NOT stored. A
 *     dropped bug report is invisible to everyone — the user thinks they helped,
 *     the maintainer never hears about it. The route must fail loudly instead.
 *  2. Letting a non-admin read or mutate the inbox, which contains reporters'
 *     email addresses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertBugReport = vi.fn();
const requireAdmin = vi.fn();
const setBugReportStatus = vi.fn();

vi.mock("@/lib/db/bug-reports", () => ({
  insertBugReport: (...a: unknown[]) => insertBugReport(...a),
  setBugReportStatus: (...a: unknown[]) => setBugReportStatus(...a),
}));
vi.mock("@/lib/admin", () => ({
  requireAdmin: () => requireAdmin(),
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/db/users", () => ({ findUserByOsfId: async () => null }));
vi.mock("@/lib/limits", () => ({ incrementWindow: async () => 1 }));
vi.mock("@/lib/logger", () => ({
  logInfo: () => {},
  logError: () => {},
  errorDetails: () => ({}),
}));

function postReq(body: unknown): Request {
  return new Request("http://localhost:4747/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // No ADMIN_NOTIFY_EMAIL => notifyAdmin short-circuits, so these tests never
  // touch SES.
  delete process.env.ADMIN_NOTIFY_EMAIL;
});

describe("POST /api/feedback", () => {
  it("stores a valid report and returns its id", async () => {
    insertBugReport.mockResolvedValue("report-1");
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(postReq({ message: "The file tree will not expand on 3kmr9." }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe("report-1");
    expect(insertBugReport).toHaveBeenCalledOnce();
  });

  it("records the app version so every report names the build it came from", async () => {
    insertBugReport.mockResolvedValue("report-2");
    const { POST } = await import("@/app/api/feedback/route");
    await POST(postReq({ message: "something is broken here" }));
    const arg = insertBugReport.mock.calls[0]![0] as { appVersion: string };
    expect(arg.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("does NOT claim success when the database is unavailable (THE key rule)", async () => {
    insertBugReport.mockResolvedValue(null); // no DB configured
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(postReq({ message: "a genuine bug report here" }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string; ok?: boolean };
    expect(body.ok).toBeUndefined();
    // Must tell the user where else to send it, not just fail.
    expect(body.error).toMatch(/betterosf@scimeto\.app/);
  });

  it("does NOT claim success when the insert throws", async () => {
    insertBugReport.mockRejectedValue(new Error("connection reset"));
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(postReq({ message: "a genuine bug report here" }));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBeUndefined();
  });

  it("rejects a too-short message without touching the database", async () => {
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(postReq({ message: "hi" }));
    expect(res.status).toBe(400);
    expect(insertBugReport).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(postReq("not json at all"));
    expect(res.status).toBe(400);
    expect(insertBugReport).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/feedback/[id]", () => {
  const ID = "db1d9336-0504-4244-95e3-d9ade0689ed1";

  function patchReq(body: unknown): Request {
    return new Request(`http://localhost:4747/api/admin/feedback/${ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses an anonymous caller", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "resolved" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(401);
    expect(setBugReportStatus).not.toHaveBeenCalled();
  });

  it("refuses a signed-in non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "resolved" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
    expect(setBugReportStatus).not.toHaveBeenCalled();
  });

  it("rejects a status outside the allowed set", async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { osfUserId: "m4kfe" } });
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "deleted" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(400);
    expect(setBugReportStatus).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid id before it reaches the query layer", async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { osfUserId: "m4kfe" } });
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "resolved" }), {
      params: Promise.resolve({ id: "'; DROP TABLE bug_reports; --" }),
    });
    expect(res.status).toBe(400);
    expect(setBugReportStatus).not.toHaveBeenCalled();
  });

  it("updates the status for a real admin", async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { osfUserId: "m4kfe" } });
    setBugReportStatus.mockResolvedValue(true);
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "resolved" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(setBugReportStatus).toHaveBeenCalledWith(ID, "resolved");
  });

  it("404s when the report does not exist", async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { osfUserId: "m4kfe" } });
    setBugReportStatus.mockResolvedValue(false);
    const { PATCH } = await import("@/app/api/admin/feedback/[id]/route");
    const res = await PATCH(patchReq({ status: "triaged" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
  });
});
