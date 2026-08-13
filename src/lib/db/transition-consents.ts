import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { transitionConsents } from "@/lib/db/schema";
import { TERMS_VERSION } from "@/lib/terms";
import { hasToolkitConsent, type ConsentRecord, type ConsentScope } from "@/lib/transition/consent";

export type RecordConsentInput = {
  /** App user row id, when there is one. */
  userId?: string | null;
  /** Durable OSF identity — required, because this row is evidence. */
  osfUserId: string;
  scope: ConsentScope;
  jobId?: string | null;
  typedPhrase?: string | null;
  itemCount?: number | null;
  userAgent?: string | null;
};

/**
 * Write a consent record.
 *
 * `termsVersion` is stamped here from TERMS_VERSION rather than accepted from the
 * caller: a client that could name the version it agreed to could name an old one.
 *
 * Awaited by callers, never fire-and-forget — the whole point is that the record exists
 * BEFORE the action it authorises. Same rule the delete route follows.
 */
export async function recordConsent(input: RecordConsentInput): Promise<void> {
  const db = requireDb();
  await db.insert(transitionConsents).values({
    userId: input.userId ?? null,
    osfUserId: input.osfUserId,
    termsVersion: TERMS_VERSION,
    scope: input.scope,
    jobId: input.jobId ?? null,
    typedPhrase: input.typedPhrase ?? null,
    itemCount: input.itemCount ?? null,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
  });
}

/** Toolkit-scoped consents for a user, newest first. */
export async function listToolkitConsents(osfUserId: string): Promise<ConsentRecord[]> {
  const db = requireDb();
  const rows = await db
    .select({
      termsVersion: transitionConsents.termsVersion,
      scope: transitionConsents.scope,
      acceptedAt: transitionConsents.acceptedAt,
    })
    .from(transitionConsents)
    .where(
      and(eq(transitionConsents.osfUserId, osfUserId), eq(transitionConsents.scope, "toolkit")),
    )
    .orderBy(desc(transitionConsents.acceptedAt))
    .limit(50);

  return rows.map((r) => ({
    termsVersion: r.termsVersion,
    scope: r.scope as ConsentScope,
    acceptedAt: r.acceptedAt,
  }));
}

/**
 * The gate every transition route calls before doing anything.
 *
 * Fails closed on purpose: a database error means "not consented", never "probably
 * fine". An export that runs because the consent lookup threw is precisely the failure
 * this whole layer exists to prevent.
 */
export async function userHasToolkitConsent(osfUserId: string): Promise<boolean> {
  try {
    return hasToolkitConsent(await listToolkitConsents(osfUserId));
  } catch {
    return false;
  }
}
