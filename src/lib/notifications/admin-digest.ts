import { and, desc, gte, inArray } from "drizzle-orm";
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

export async function collectAdminDigest(windowHours = 24): Promise<AdminDigest> {
  const db = requireDb();
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const rows = await db
    .select()
    .from(systemLogs)
    .where(and(gte(systemLogs.createdAt, since), inArray(systemLogs.level, ["error", "warn"])))
    .orderBy(desc(systemLogs.createdAt))
    .limit(MAX_ROWS);

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

  return { windowHours, errorCount, warnCount, groups, recent };
}
