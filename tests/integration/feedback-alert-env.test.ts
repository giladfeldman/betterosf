/**
 * A user bug report is an issue alert (admin email standard: `source: user report`, P3). The report
 * is ALWAYS stored; whether it is emailed (production only, labelled otherwise) is decided inside
 * maybeAlert, which tests/integration/admin-email.test.ts proves against a real Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeAlert = vi.fn();
vi.mock("@/lib/notifications/admin-alert", () => ({
  maybeAlert: (...a: unknown[]) => maybeAlert(...a),
  USER_REPORT_EVENT_PREFIX: "user-report:",
}));
vi.mock("@/lib/db/bug-reports", () => ({ insertBugReport: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/db/users", () => ({ findUserByOsfId: async () => null }));
vi.mock("@/lib/limits", () => ({ incrementWindow: async () => 1 }));
vi.mock("@/lib/logger", () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {}, errorDetails: () => ({}) }));

function post(): Request {
  return new Request("http://localhost:4747/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "bug", message: "The tree does not load on my project.", contactEmail: "me@example.org" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_NOTIFY_EMAIL = "admin@example.test";
});

describe("bug report raises a user-report issue alert", () => {
  it("stores the report and raises one P3 alert without the reporter's address", async () => {
    maybeAlert.mockResolvedValue("sent");
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(maybeAlert).toHaveBeenCalledTimes(1);
    const a = maybeAlert.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ source: "user report", priority: "P3", event: "user-report:bug" });
    expect(JSON.stringify(a)).not.toContain("me@example.org");
    expect(((await res.json()) as { emailed: boolean }).emailed).toBe(true);
  }, 20_000);

  it("a muted or skipped alert is reported as not emailed, and the report still succeeds", async () => {
    maybeAlert.mockResolvedValue("skipped");
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(((await res.json()) as { emailed: boolean }).emailed).toBe(false);
  });
});
