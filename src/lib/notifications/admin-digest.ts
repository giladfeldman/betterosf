import { and, gte, lt, isNull, isNotNull, inArray, eq, count, desc, sql } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { adminAlerts, bugReports, systemLogs } from "@/lib/db/schema";
import type { AdminIssue, DigestInput, Priority } from "./admin-email";

/**
 * Collect the fortnight digest (admin email standard §7). Pure read.
 * Window: from the latest 1st/15th 06:00 UTC boundary that is at least 12 h old, to now.
 * Run by the cron `0 6 1,15 * *` that is the previous boundary, so consecutive digests
 * tile the calendar; a manual run mid-fortnight covers the fortnight so far.
 * Also auto-resolves issues not seen for 14 days (resolved_at), so "still open"
 * means "seen recently".
 */
export function previousDigestBoundary(now = new Date()): Date {
  const t = new Date(now.getTime() - 12 * 3600 * 1000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  for (const b of [Date.UTC(y, m, 15, 6), Date.UTC(y, m, 1, 6), Date.UTC(y, m - 1, 15, 6)]) {
    if (b <= t.getTime()) return new Date(b);
  }
  return new Date(Date.UTC(y, m - 1, 15, 6)); // unreachable
}

export async function collectFortnightDigest(app: string, environment: string, adminUrl?: string,
                                             now = new Date()): Promise<DigestInput> {
  const db = requireDb();
  const start = previousDigestBoundary(now);
  const staleCut = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

  const resolvedRows = await db.update(adminAlerts)
    .set({ resolvedAt: sql`now()` })
    .where(and(isNull(adminAlerts.resolvedAt), lt(adminAlerts.lastSeen, staleCut)))
    .returning();

  const openRows = await db.select().from(adminAlerts)
    .where(and(isNull(adminAlerts.resolvedAt), inArray(adminAlerts.priority, ["P1", "P2", "P3"])))
    .orderBy(desc(adminAlerts.lastSeen)).limit(50);

  const earlierResolved = await db.select().from(adminAlerts)
    .where(and(isNotNull(adminAlerts.resolvedAt), gte(adminAlerts.resolvedAt, start)))
    .limit(50);

  // Local dev shares this log table: count production-origin rows only. A row without the
  // `_env` label predates it and counts as production, so an upgrade cannot hide an error.
  const prodRow = sql`(${systemLogs.context}->>'_env' IS NULL OR ${systemLogs.context}->>'_env' = 'production')`;
  const noise = await db.select({ event: systemLogs.type, n: count() }).from(systemLogs)
    .where(and(eq(systemLogs.level, "warn"), gte(systemLogs.createdAt, start), prodRow))
    .groupBy(systemLogs.type).orderBy(desc(count())).limit(15);

  const byLevel = await db.select({ level: systemLogs.level, n: count() }).from(systemLogs)
    .where(and(gte(systemLogs.createdAt, start), prodRow)).groupBy(systemLogs.level);
  const lvl = (l: string) => Number(byLevel.find((r) => r.level === l)?.n ?? 0);

  const [sentRow] = await db.select({ alertsSent: count() }).from(adminAlerts)
    .where(gte(adminAlerts.lastAlertedAt, start));
  const [lastRow] = await db.select({ lastAlert: sql<Date | null>`max(${adminAlerts.lastAlertedAt})` }).from(adminAlerts);

  const reportKinds = await db.select({ kind: bugReports.kind, n: count() }).from(bugReports)
    .where(gte(bugReports.createdAt, start)).groupBy(bugReports.kind);
  const reports = reportKinds.reduce((a, r) => a + Number(r.n), 0);

  const toIssue = (r: typeof openRows[number]): AdminIssue => ({
    app, environment, priority: r.priority as Priority, summary: r.summary,
    explanation: r.summary, event: r.event, fingerprint: r.fingerprint, count: r.count,
    firstSeen: r.firstSeen.toISOString(), lastSeen: r.lastSeen.toISOString(),
    message: String((r.sample as { message?: unknown })?.message ?? ""),
    adminLogUrl: adminUrl ? `${adminUrl}/logs?q=${encodeURIComponent(r.event)}` : undefined,
  });
  const seen = new Set<string>();
  const resolved = [...resolvedRows, ...earlierResolved].filter((r) => !seen.has(r.fingerprint) && seen.add(r.fingerprint))
    .map((r) => ({ summary: r.summary, fingerprint: r.fingerprint, resolvedAt: (r.resolvedAt ?? now).toISOString().slice(0, 10) }));

  return {
    app, environment, periodStart: start.toISOString(), periodEnd: now.toISOString(),
    open: openRows.map(toIssue), resolved,
    noise: noise.map((n) => ({ event: n.event, count: Number(n.n) })),
    // Hosts: append their own usage numbers here (sign-ups, jobs run...) — from the DB only.
    numbers: [
      { label: "Errors logged", value: lvl("error") },
      { label: "Warnings logged", value: lvl("warn") },
      { label: "Open issues", value: openRows.length },
      { label: "Alerts sent", value: Number(sentRow?.alertsSent ?? 0) },
      { label: "User reports (bugs, ideas, questions)", value: reports },
    ],
    alertingHealth: [
      { label: "Last issue alert sent", value: lastRow?.lastAlert ? new Date(lastRow.lastAlert).toISOString() : "none ever" },
      { label: "Digest window", value: `${start.toISOString()} → ${now.toISOString()}` },
    ],
    adminUrl,
  };
}
