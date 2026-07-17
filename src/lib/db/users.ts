import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { users } from "./schema";

export type UpsertOsfUserInput = {
  osfUserId: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/**
 * Best-effort upsert on OSF sign-in. Never throws to the auth callback —
 * a DB blip must not block login.
 */
export async function upsertOsfUser(input: UpsertOsfUserInput): Promise<string | null> {
  const db = getDb();
  if (!db || !input.osfUserId) return null;
  try {
    const now = new Date();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.osfUserId, input.osfUserId))
      .limit(1);
    if (existing[0]) {
      await db
        .update(users)
        .set({
          name: input.name ?? undefined,
          email: input.email ?? undefined,
          image: input.image ?? undefined,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, existing[0].id));
      return existing[0].id;
    }
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      osfUserId: input.osfUserId,
      name: input.name ?? null,
      email: input.email ?? null,
      image: input.image ?? null,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  } catch (err) {
    console.error("[db:upsertOsfUser]", err);
    return null;
  }
}

export async function findUserByOsfId(osfUserId: string) {
  const db = getDb();
  if (!db || !osfUserId) return null;
  const rows = await db.select().from(users).where(eq(users.osfUserId, osfUserId)).limit(1);
  return rows[0] ?? null;
}
