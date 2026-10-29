/**
 * d-bf671b: the bug-report email is an admin alert, so it follows the production-only rule.
 * The report is ALWAYS stored (the owner reads it on /admin/feedback); only the email
 * depends on where it happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/email/render", () => ({ renderEmail: async () => ({ html: "<p>x</p>", text: "x" }) }));
vi.mock("@/lib/db/bug-reports", () => ({ insertBugReport: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/db/users", () => ({ findUserByOsfId: async () => null }));
vi.mock("@/lib/limits", () => ({ incrementWindow: async () => 1 }));
vi.mock("@/lib/logger", () => ({ logInfo: () => {}, logError: () => {}, logWarn: () => {}, errorDetails: () => ({}) }));

const KEYS = ["VERCEL_ENV", "ALERT_EMAILS_NON_PRODUCTION", "ADMIN_NOTIFY_EMAIL"];
const env = process.env as Record<string, string | undefined>;
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));

function post(): Request {
  return new Request("http://localhost:4747/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "bug", message: "The tree does not load on my project." }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ sent: true, mode: "ses" });
  for (const k of KEYS) delete env[k];
  env.ADMIN_NOTIFY_EMAIL = "admin@example.test";
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("bug-report alert email follows the production-only rule", () => {
  it("production: stored AND emailed, subject unlabelled", async () => {
    env.VERCEL_ENV = "production";
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].subject).toMatch(/^\[BetterOSF\]/);
  }, 20_000);

  it("local: stored, NOT emailed", async () => {
    const { POST } = await import("@/app/api/feedback/route");
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(((await res.json()) as { emailed: boolean }).emailed).toBe(false);
  });

  it("local with the opt-in: emailed, subject starts [LOCAL TEST - NOT PRODUCTION]", async () => {
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    const { POST } = await import("@/app/api/feedback/route");
    await POST(post());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].subject.startsWith("[LOCAL TEST - NOT PRODUCTION]")).toBe(true);
  });
});
