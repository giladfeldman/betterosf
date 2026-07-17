import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { systemLogs } from "@/lib/db/schema";

export async function getRecentLogs(opts: {
  level?: string;
  type?: string;
  limit?: number;
}) {
  const db = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 200, 10), 2000);
  const conditions = [];
  if (opts.level) conditions.push(eq(systemLogs.level, opts.level));
  if (opts.type) conditions.push(eq(systemLogs.type, opts.type));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db
    .select()
    .from(systemLogs)
    .where(where)
    .orderBy(desc(systemLogs.createdAt))
    .limit(limit);
}
