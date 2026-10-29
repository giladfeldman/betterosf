/**
 * d-bf671b: the daily error digest counts only PRODUCTION events by default. Local dev
 * writes to the same log table (it shares the database), so without this a laptop's
 * failed experiments reach the owner's inbox looking like production errors.
 * Each log row records `_env` at write time (the originator's environment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { level: string; type: string; message: string; context: unknown; createdAt: Date };
let rows: Row[] = [];
vi.mock("@/lib/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  };
  return { requireDb: () => chain, getDb: () => chain };
});

import { collectAdminDigest } from "@/lib/notifications/admin-digest";

const at = new Date();
beforeEach(() => {
  rows = [
    { level: "error", type: "osf", message: "prod boom", context: { _env: "production" }, createdAt: at },
    { level: "error", type: "osf", message: "laptop boom", context: { _env: "local" }, createdAt: at },
    { level: "warn", type: "osf", message: "preview warn", context: { _env: "preview" }, createdAt: at },
    // Written before rows carried a label: kept, so an upgrade cannot hide a real error.
    { level: "warn", type: "osf", message: "legacy warn", context: {}, createdAt: at },
  ];
});

describe("collectAdminDigest", () => {
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
