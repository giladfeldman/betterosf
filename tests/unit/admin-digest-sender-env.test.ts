/**
 * d-bf671b: the digest SENDER follows the production-only rule too. A digest triggered on
 * a laptop is a local test and is emailed only with the opt-in, labelled; a production
 * digest is unlabelled, and with the opt-in the local/preview events go in a SEPARATE,
 * labelled email rather than into the production count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmail = vi.fn();
const collect = vi.fn();
vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  renderEmail: async () => ({ html: "<p/>", text: "" }),
}));
vi.mock("@/lib/notifications/admin-digest", () => ({ collectAdminDigest: (...a: unknown[]) => collect(...a) }));

import { sendAdminErrorDigest } from "@/lib/notifications/send-admin-digest";

const KEYS = ["VERCEL_ENV", "ALERT_EMAILS_NON_PRODUCTION", "ADMIN_NOTIFY_EMAIL"];
const env = process.env as Record<string, string | undefined>;
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
const digest = (n: number) => ({ windowHours: 24, errorCount: n, warnCount: 0, groups: [], recent: [], nonProductionExcluded: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of KEYS) delete env[k];
  env.ADMIN_NOTIFY_EMAIL = "admin@example.test";
  sendEmail.mockResolvedValue({ sent: true, mode: "ses" });
  collect.mockResolvedValue(digest(2));
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("sendAdminErrorDigest", () => {
  it("production: one email, unlabelled subject, production events only", async () => {
    env.VERCEL_ENV = "production";
    expect((await sendAdminErrorDigest()).status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0].subject).toMatch(/^\[BetterOSF\] 2 errors/);
    expect(collect).toHaveBeenCalledWith(24);
  });

  it("local, no opt-in: nothing is emailed", async () => {
    expect((await sendAdminErrorDigest()).status).toBe("not_production");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("local with opt-in: emailed with the LOCAL TEST label", async () => {
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    await sendAdminErrorDigest();
    expect(sendEmail.mock.calls[0]![0].subject.startsWith("[LOCAL TEST - NOT PRODUCTION]")).toBe(true);
  });

  it("production with opt-in: the non-production events go in a second, labelled email", async () => {
    env.VERCEL_ENV = "production";
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    await sendAdminErrorDigest();
    const subjects = sendEmail.mock.calls.map((c) => c[0].subject as string);
    expect(subjects).toHaveLength(2);
    expect(subjects.filter((s) => s.startsWith("[LOCAL TEST - NOT PRODUCTION]"))).toHaveLength(1);
    expect(subjects.filter((s) => s.startsWith("[BetterOSF]"))).toHaveLength(1);
    expect(collect).toHaveBeenCalledWith(24, { scope: "non-production" });
  });
});
