/**
 * d-7ec41f: a malformed id in an API URL must answer 400, never 500.
 *
 * Postgres rejects a non-uuid string compared against a uuid column with error 22P02
 * (invalid_text_representation); an unguarded route turns that into a 500. Proven here on a
 * real Postgres (PGlite, this app's own migrations), because a mocked db layer cannot raise
 * 22P02 — the mocked feedback-route test proves the guard exists, not that it is needed.
 *
 * Class enumeration (2026-11-19): uuid columns are bookmarks.id, system_logs.id,
 * email_events.id, bug_reports.id, transition_consents.id, transition_items.id. The only one
 * a URL value reaches is bug_reports.id via PATCH /api/admin/feedback/[id]. Every other
 * dynamic API segment ([guid], [provider], [wikiId], [jobId]) and URL query id (bookmarks
 * ?id= -> ref_id, publish ?jobId= -> transition_jobs.id) lands in a text column.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { freshDb } from "../db/pglite";
import { bugReports } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof freshDb>>["db"];
vi.mock("@/lib/db", () => ({ requireDb: () => db, getDb: () => db }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => ({ ok: true, session: { osfUserId: "m4kfe" } }),
}));

import { setBugReportStatus } from "@/lib/db/bug-reports";
import { PATCH } from "@/app/api/admin/feedback/[id]/route";

beforeAll(async () => {
  db = (await freshDb()).db;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE bug_reports`);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

function patch(id: string) {
  return PATCH(
    new Request(`http://localhost:4747/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("malformed uuid in an API URL -> 400, not 500", () => {
  it("control: the real query DOES fail with 22P02 on a malformed id (the guard is load-bearing)", async () => {
    const err = await setBugReportStatus("abc", "resolved").then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } },
    );
    expect(err).not.toBeNull();
    expect(err?.code ?? err?.cause?.code).toBe("22P02");
  });

  for (const bad of ["abc", "123", "db1d9336-0504-4244-95e3-d9ade0689ed", "db1d9336050442449 5e3d9ade0689ed1", "'; DROP TABLE bug_reports; --"]) {
    it(`PATCH /api/admin/feedback/${JSON.stringify(bad)} answers 400`, async () => {
      const res = await patch(bad);
      expect(res.status).toBe(400);
    });
  }

  it("a well-formed but absent uuid answers 404", async () => {
    const res = await patch("db1d9336-0504-4244-95e3-d9ade0689ed1");
    expect(res.status).toBe(404);
  });

  it("a real report id updates (200)", async () => {
    const [row] = await db
      .insert(bugReports)
      .values({ kind: "bug", message: "a genuine bug report", appVersion: "test" })
      .returning({ id: bugReports.id });
    const res = await patch(row!.id);
    expect(res.status).toBe(200);
  });
});
