import "server-only";

import { eq } from "drizzle-orm";
import { requireDb } from "./index";
import { userPrefs } from "./schema";

export async function getUserPrefs(userId: string): Promise<Record<string, unknown>> {
  const db = requireDb();
  const rows = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
  return rows[0]?.prefs ?? {};
}

export async function setUserPrefs(
  userId: string,
  prefs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = requireDb();
  const now = new Date();
  const existing = await db.select({ userId: userPrefs.userId }).from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(userPrefs).set({ prefs, updatedAt: now }).where(eq(userPrefs.userId, userId));
  } else {
    await db.insert(userPrefs).values({ userId, prefs, updatedAt: now });
  }
  return prefs;
}

/** Shallow-merge keys from `patch` into stored prefs. */
export async function patchUserPrefs(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getUserPrefs(userId);
  const next = { ...current, ...patch };
  return setUserPrefs(userId, next);
}
