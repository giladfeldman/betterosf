/**
 * Admin email standard (issue alerts + fortnight digest), proven on a real
 * Postgres (PGlite) with this app's own migrations: the 0006 admin_alerts table, the
 * fingerprint mute, the production-only rule, the session button, and the fortnight digest.
 * No SES, no Neon traffic: EMAIL_MODE=console or a fake SES client.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { freshDb } from "../db/pglite";
import { systemLogs } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof freshDb>>["db"];
vi.mock("@/lib/db", () => ({ requireDb: () => db, getDb: () => db }));
const sesSend = vi.fn(async (_cmd: unknown) => ({}));
vi.mock("@/lib/email/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/client")>()),
  getSesClient: () => ({ send: sesSend }),
}));

import { maybeAlert } from "@/lib/notifications/admin-alert";
import { sendFortnightDigest } from "@/lib/notifications/send-admin-digest";

const KEYS = ["VERCEL_ENV", "ALERT_EMAILS_NON_PRODUCTION", "ADMIN_NOTIFY_EMAIL", "EMAIL_MODE", "ADMIN_EMAIL_SESSION_FOLDER"];
const env = process.env as Record<string, string | undefined>;
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
let log: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  db = (await freshDb()).db;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE admin_alerts, system_logs`);
  vi.clearAllMocks();
  for (const k of KEYS) delete env[k];
  env.ADMIN_NOTIFY_EMAIL = "admin@example.test";
  env.ADMIN_EMAIL_SESSION_FOLDER = "C:\\proj\\BetterOSF";
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

const input = {
  level: "error" as const,
  event: "osf",
  message: "OSF returned 500 for node abc12",
  context: { route: "/api/osf/tree", errorName: "OsfError", stack: "Error: boom\n    at a (x.ts:1:1)" },
};

describe("issue alerts", () => {
  it("local, no opt-in: nothing is sent and nothing is recorded", async () => {
    env.EMAIL_MODE = "console";
    expect(await maybeAlert(input)).toBe("skipped");
    expect(log).not.toHaveBeenCalled();
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM admin_alerts`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("local with the opt-in: labelled, has priority, details and the session button; a repeat is muted", async () => {
    env.EMAIL_MODE = "console";
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    expect(await maybeAlert(input)).toBe("console");
    const out = String(log.mock.calls[0]?.join(" "));
    expect(out).toContain('subject="[LOCAL TEST - NOT PRODUCTION] [P3 MEDIUM] BetterOSF');
    expect(out).toContain("claude://code/new");
    expect(out).toContain("OsfError");
    expect(out).toContain("/api/osf/tree");
    expect(await maybeAlert(input)).toBe("muted");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("production: sent through SES, unlabelled, to ADMIN_NOTIFY_EMAIL only", async () => {
    env.VERCEL_ENV = "production";
    expect(await maybeAlert(input)).toBe("sent");
    expect(sesSend).toHaveBeenCalledTimes(1);
    const cmd = sesSend.mock.calls[0]?.[0] as unknown as {
      input: { Destination: { ToAddresses: string[] }; Message: { Subject: { Data: string } } };
    };
    expect(cmd.input.Destination.ToAddresses).toEqual(["admin@example.test"]);
    expect(cmd.input.Message.Subject.Data.startsWith("[P3 MEDIUM] BetterOSF")).toBe(true);
  });

  it("production with no ADMIN_NOTIFY_EMAIL: nothing is sent (no fallback address)", async () => {
    env.VERCEL_ENV = "production";
    delete env.ADMIN_NOTIFY_EMAIL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await maybeAlert(input)).toBe("skipped");
    expect(sesSend).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a user report is a P3 alert with source 'user report' and its own deep link", async () => {
    env.EMAIL_MODE = "console";
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    await maybeAlert({
      level: "error",
      event: "user-report:bug",
      message: "The tree does not load",
      priority: "P3",
      source: "user report",
      summary: "New bug report: The tree does not load",
      adminLogUrl: "https://betterosf.vercel.app/admin/feedback",
    });
    const out = String(log.mock.calls[0]?.join(" "));
    expect(out).toContain("user report");
    expect(out).toContain("https://betterosf.vercel.app/admin/feedback");
  });
});

describe("alert cap: user reports and errors have separate daily budgets (d-6f9e96)", () => {
  async function seedAlerted(prefix: string, n: number) {
    for (let i = 0; i < n; i++) {
      await db.execute(sql`INSERT INTO admin_alerts (fingerprint, priority, event, summary, last_alerted_at)
        VALUES (${`seed-${prefix}-${i}`}, 'P3', ${`${prefix}${i}`}, 'seed', now())`);
    }
  }

  it("ten user-report alerts today do not mute a production error", async () => {
    env.VERCEL_ENV = "production";
    await seedAlerted("user-report:bug-", 10);
    expect(await maybeAlert(input)).toBe("sent");
  });

  it("control: ten error alerts today DO mute the next error (the cap still works)", async () => {
    env.VERCEL_ENV = "production";
    await seedAlerted("osf-", 10);
    expect(await maybeAlert(input)).toBe("muted");
  });

  it("ten error alerts today do not mute a user report; ten reports mute the eleventh", async () => {
    env.VERCEL_ENV = "production";
    await seedAlerted("osf-", 10);
    const report = { level: "error" as const, event: "user-report:bug", message: "x", priority: "P3" as const, source: "user report" };
    expect(await maybeAlert(report)).toBe("sent");
    await db.execute(sql`TRUNCATE admin_alerts`);
    await seedAlerted("user-report:bug-", 10);
    expect(await maybeAlert({ ...report, message: "y" })).toBe("muted");
  });
});

describe("fortnight digest", () => {
  it("local, no opt-in: not sent", async () => {
    expect((await sendFortnightDigest()).status).toBe("not_production");
  });

  it("opted-in: renders even when quiet, counts production log rows only", async () => {
    env.EMAIL_MODE = "console";
    env.ALERT_EMAILS_NON_PRODUCTION = "1";
    await db.insert(systemLogs).values([
      { level: "error", type: "osf", message: "prod error", context: { _env: "production" } },
      { level: "error", type: "osf", message: "legacy row, no label", context: {} },
      { level: "error", type: "osf", message: "laptop experiment", context: { _env: "local" } },
    ]);
    const res = await sendFortnightDigest();
    expect(res.status).toBe("console");
    const out = String(log.mock.calls[0]?.join(" "));
    expect(out).toContain("Fortnight digest");
    expect(out).toMatch(/Errors logged\D+2\b/);
  });
});
