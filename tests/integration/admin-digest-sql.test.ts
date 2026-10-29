/**
 * d-bf671b: the daily error digest counts only PRODUCTION events by default. Local dev
 * writes to the same log table (it shares the database), so without this a laptop's
 * failed experiments reach the owner's inbox looking like production errors.
 * Each log row records `_env` at write time (the originator's environment).
 *
 * Run against a real Postgres (PGlite) because the filter is SQL: review of v1.14.0 found
 * the 1,000-row cap applied BEFORE the production filter, so a noisy local session could
 * push real production errors out of the digest — the exact failure this change exists to
 * prevent. The last test pins that.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { freshDb } from "../db/pglite";
import { systemLogs } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof freshDb>>["db"];
vi.mock("@/lib/db", () => ({ requireDb: () => db, getDb: () => db }));

import { collectAdminDigest } from "@/lib/notifications/admin-digest";

beforeAll(async () => {
  db = (await freshDb()).db;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE system_logs`);
});

const row = (level: string, message: string, context: Record<string, unknown>, ageMs = 0) => ({
  level,
  type: "osf",
  message,
  context,
  createdAt: new Date(Date.now() - ageMs),
});

describe("collectAdminDigest (real SQL)", () => {
  beforeEach(async () => {
    await db.insert(systemLogs).values([
      row("error", "prod boom", { _env: "production" }),
      row("error", "laptop boom", { _env: "local" }),
      row("warn", "preview warn", { _env: "preview" }),
      // Written before rows carried a label: kept, so an upgrade cannot hide a real error.
      row("warn", "legacy warn", {}),
    ]);
  });

  it("counts production (and unlabelled legacy) events only, and reports what it left out", async () => {
    const d = await collectAdminDigest(24);
    expect(d.errorCount).toBe(1);
    expect(d.warnCount).toBe(1);
    expect(d.groups.map((g) => g.event).join(" ")).not.toMatch(/laptop|preview/);
    expect(d.nonProductionExcluded).toBe(2);
  });

  it("can collect the non-production events alone, for an opted-in labelled digest", async () => {
    const d = await collectAdminDigest(24, { scope: "non-production" });
    expect(d.errorCount).toBe(1);
    expect(d.warnCount).toBe(1);
    expect(d.groups.map((g) => g.event).join(" ")).toMatch(/laptop/);
  });
});

describe("the row cap never hides production errors behind local noise", () => {
  it("1,000 newer local errors do not push an older production error out", async () => {
    await db.insert(systemLogs).values(row("error", "real production failure", { _env: "production" }, 60_000));
    const noise = Array.from({ length: 1000 }, (_, i) => row("error", `local experiment ${i}`, { _env: "local" }));
    await db.insert(systemLogs).values(noise);
    const d = await collectAdminDigest(24);
    expect(d.errorCount).toBe(1);
    expect(d.groups.map((g) => g.event).join(" ")).toMatch(/real production failure/);
    expect(d.nonProductionExcluded).toBe(1000);
  }, 30_000);
});
