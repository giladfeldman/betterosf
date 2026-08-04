import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, requireDb } from "@/lib/db";
import { bugReports } from "@/lib/db/schema";

export type NewBugReport = {
  kind: string;
  message: string;
  contactEmail: string | null;
  pageUrl: string | null;
  appVersion: string;
  userAgent: string | null;
  userId: string | null;
  osfUserId: string | null;
};

/**
 * Persist a report. Returns the new row id, or null when no database is
 * configured.
 *
 * The caller MUST surface a null return as a failure to the user rather than a
 * success — telling someone their bug report was received when it was silently
 * dropped is worse than telling them it failed.
 */
export async function insertBugReport(input: NewBugReport): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .insert(bugReports)
    .values({
      kind: input.kind,
      message: input.message,
      contactEmail: input.contactEmail,
      pageUrl: input.pageUrl,
      appVersion: input.appVersion,
      userAgent: input.userAgent,
      userId: input.userId,
      osfUserId: input.osfUserId,
    })
    .returning({ id: bugReports.id });
  return rows[0]?.id ?? null;
}

export async function listBugReports(opts: { status?: string; limit?: number } = {}) {
  const db = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conditions = [];
  if (opts.status && opts.status !== "all") conditions.push(eq(bugReports.status, opts.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(bugReports)
    .where(where)
    .orderBy(desc(bugReports.createdAt))
    .limit(limit);
}

export async function countBugReportsByStatus(): Promise<Record<string, number>> {
  const db = getDb();
  if (!db) return {};
  const rows = await db
    .select({ status: bugReports.status, n: sql<number>`count(*)::int` })
    .from(bugReports)
    .groupBy(bugReports.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function setBugReportStatus(id: string, status: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const rows = await db
    .update(bugReports)
    .set({ status })
    .where(eq(bugReports.id, id))
    .returning({ id: bugReports.id });
  return rows.length > 0;
}
