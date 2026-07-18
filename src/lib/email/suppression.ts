import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/db/schema";

type CacheEntry = { suppressed: boolean; expires: number };
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function isSuppressed(email: string): Promise<boolean> {
  const key = email.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.suppressed;

  const db = getDb();
  if (!db) return false;

  const rows = await db
    .select({ id: emailEvents.id })
    .from(emailEvents)
    .where(
      and(
        eq(emailEvents.email, key),
        or(
          eq(emailEvents.type, "complaint"),
          and(eq(emailEvents.type, "bounce"), eq(emailEvents.bounceType, "Permanent")),
        ),
      ),
    )
    .limit(1);

  const suppressed = rows.length > 0;
  cache.set(key, { suppressed, expires: now + TTL_MS });
  return suppressed;
}

export function clearSuppressionCache(email?: string) {
  if (email) cache.delete(email.toLowerCase());
  else cache.clear();
}

/** @deprecated use clearSuppressionCache */
export function _resetCacheForTests() {
  clearSuppressionCache();
}
