import { and, count, desc, gte, inArray, sql } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { systemLogs } from "@/lib/db/schema";

export interface DigestGroup {
  event: string;
  count: number;
  lastSeen: string;
  sampleMeta: Record<string, unknown> | null;
}

export interface DigestRow {
  level: string;
  event: string;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface AdminDigest {
  windowHours: number;
  errorCount: number;
  warnCount: number;
  groups: DigestGroup[];
  recent: DigestRow[];
  /**
   * Error/warn events from local, preview or development servers that this digest left out
   * (d-bf671b). Local dev shares this log table; its failures are not production news.
   */
  nonProductionExcluded: number;
}

/** A row with no `_env` predates the label; it is kept, so an upgrade cannot hide an error. */
function isProductionRow(context: unknown): boolean {
  const env = (context as { _env?: unknown } | null)?._env;
  return env === undefined || env === null || env === "production";
}

const MAX_ROWS = 1000;
const MAX_RECENT = 20;

function iso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? "");
}

function eventKey(type: string, message: string): string {
  return `${type}|${message.slice(0, 120)}`;
}

export async function collectAdminDigest(
  windowHours = 24,
  opts: { scope?: "production" | "non-production" } = {},
): Promise<AdminDigest> {
  const scope = opts.scope ?? "production";
  const db = requireDb();
  const since = new Date(Date.now() - windowHours * 3_600_000);

  // The environment filter is in SQL, BEFORE the row cap: filtering after the cap let a
  // noisy local session push real production errors out of the window. A row with no
  // `_env` predates the label and counts as production (see isProductionRow).
  const isProduction = sql`coalesce(${systemLogs.context}->>'_env', 'production') = 'production'`;
  const inScope = scope === "production" ? isProduction : sql`not (${isProduction})`;
  const base = and(gte(systemLogs.createdAt, since), inArray(systemLogs.level, ["error", "warn"]));

  const fetched = await db
    .select()
    .from(systemLogs)
    .where(and(base, inScope))
    .orderBy(desc(systemLogs.createdAt))
    .limit(MAX_ROWS);
  // Belt and braces: the same rule in code, so a driver quirk cannot widen the scope.
  const rows = fetched.filter((r) => isProductionRow(r.context) === (scope === "production"));

  let nonProductionExcluded = 0;
  if (scope === "production") {
    const [excluded] = await db.select({ n: count() }).from(systemLogs).where(and(base, sql`not (${isProduction})`));
    nonProductionExcluded = Number(excluded?.n ?? 0);
  }

  const errorCount = rows.filter((r) => r.level === "error").length;
  const warnCount = rows.filter((r) => r.level === "warn").length;

  const byEvent = new Map<string, DigestGroup>();
  for (const r of rows) {
    const key = eventKey(r.type, r.message);
    const g = byEvent.get(key);
    if (g) {
      g.count += 1;
    } else {
      byEvent.set(key, {
        event: key,
        count: 1,
        lastSeen: iso(r.createdAt),
        sampleMeta: (r.context as Record<string, unknown> | null) ?? null,
      });
    }
  }
  const groups = [...byEvent.values()].sort((a, b) => b.count - a.count);

  const recent: DigestRow[] = rows.slice(0, MAX_RECENT).map((r) => ({
    level: r.level,
    event: eventKey(r.type, r.message),
    createdAt: iso(r.createdAt),
    meta: (r.context as Record<string, unknown> | null) ?? null,
  }));

  return { windowHours, errorCount, warnCount, groups, recent, nonProductionExcluded };
}
