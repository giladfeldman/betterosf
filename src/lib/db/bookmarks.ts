import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { FavoriteKind, FavoriteRef } from "@/lib/favorites";
import { requireDb } from "./index";
import { bookmarks } from "./schema";

function toRef(row: typeof bookmarks.$inferSelect): FavoriteRef {
  return {
    id: row.refId,
    title: row.title,
    kind: row.kind as FavoriteKind,
  };
}

export async function listBookmarksForUser(userId: string): Promise<FavoriteRef[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.updatedAt));
  return rows.map(toRef);
}

export async function upsertBookmark(userId: string, ref: FavoriteRef): Promise<void> {
  const db = requireDb();
  const now = new Date();
  const existing = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.refId, ref.id)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(bookmarks)
      .set({ title: ref.title, kind: ref.kind, updatedAt: now })
      .where(eq(bookmarks.id, existing[0].id));
    return;
  }
  await db.insert(bookmarks).values({
    userId,
    refId: ref.id,
    title: ref.title,
    kind: ref.kind,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteBookmark(userId: string, refId: string): Promise<void> {
  const db = requireDb();
  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.refId, refId)));
}

/** Merge local pins into DB (local wins on title/kind for same id). */
export async function mergeBookmarks(userId: string, local: FavoriteRef[]): Promise<FavoriteRef[]> {
  for (const ref of local) {
    await upsertBookmark(userId, ref);
  }
  return listBookmarksForUser(userId);
}
