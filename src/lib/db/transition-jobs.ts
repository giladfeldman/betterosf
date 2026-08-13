import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { transitionItems, transitionJobs } from "@/lib/db/schema";

/**
 * Neon-side reads and writes for the transfer ledger.
 *
 * Every function here is scoped by `osfUserId`, always in the WHERE clause and never by
 * checking afterwards. A job id is a client-generated UUID, so it is unguessable but not
 * secret — treating it as an authorisation token would let anyone who saw one in a log
 * read or overwrite somebody else's run.
 */

export type JobUpsert = {
  jobId: string;
  userId: string | null;
  osfUserId: string;
  guid: string;
  destination: string;
  env: string;
  status: string;
  records: { recordId: string; fileCount: number }[];
  fileCount: number;
  bytesTotal: number;
};

export type PublishedRecord = { recordId: string; doi: string | null; publishedAt: string };

export type JobRow = {
  jobId: string;
  guid: string;
  destination: string;
  env: string;
  status: string;
  records: { recordId: string; fileCount: number }[];
  publishedRecords: PublishedRecord[];
  fileCount: number;
  bytesTotal: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Create or update a job checkpoint.
 *
 * The `where` on the update is what stops a second user claiming an existing job id: the
 * conflict fires, the update matches nothing, and the row is left exactly as it was.
 */
export async function upsertJob(input: JobUpsert): Promise<void> {
  const db = requireDb();
  await db
    .insert(transitionJobs)
    .values({
      id: input.jobId,
      userId: input.userId,
      osfUserId: input.osfUserId,
      guid: input.guid,
      destination: input.destination,
      env: input.env,
      status: input.status,
      records: input.records,
      fileCount: input.fileCount,
      bytesTotal: input.bytesTotal,
    })
    .onConflictDoUpdate({
      target: transitionJobs.id,
      set: {
        status: input.status,
        records: input.records,
        fileCount: input.fileCount,
        bytesTotal: input.bytesTotal,
        updatedAt: new Date(),
      },
      where: eq(transitionJobs.osfUserId, input.osfUserId),
    });
}

export async function getJob(osfUserId: string, jobId: string): Promise<JobRow | null> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(transitionJobs)
    .where(and(eq(transitionJobs.id, jobId), eq(transitionJobs.osfUserId, osfUserId)))
    .limit(1);
  const row = rows[0];
  return row ? toJobRow(row) : null;
}

/** This user's runs, newest first. Bounded — this feeds a "resume a run" list, not a report. */
export async function listJobs(osfUserId: string, limit = 25): Promise<JobRow[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(transitionJobs)
    .where(eq(transitionJobs.osfUserId, osfUserId))
    .orderBy(desc(transitionJobs.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(toJobRow);
}

function toJobRow(row: typeof transitionJobs.$inferSelect): JobRow {
  return {
    jobId: row.id,
    guid: row.guid,
    destination: row.destination,
    env: row.env,
    status: row.status,
    records: row.records,
    publishedRecords: row.publishedRecords,
    fileCount: row.fileCount,
    bytesTotal: row.bytesTotal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Record that a draft was published, and refuse to do it twice.
 *
 * Returns false when this record is already marked published, which is how a replayed or
 * double-submitted request is stopped BEFORE Zenodo is called. Publishing mints a
 * permanent DOI; relying on the destination to reject a second attempt would be relying
 * on behaviour this codebase has never measured, unlike every other Zenodo fact it
 * depends on. (Sonnet consult 2026-08-13.)
 *
 * The conditional UPDATE is what makes it safe under concurrency: two simultaneous
 * requests both read "not published", but only one UPDATE matches a row whose
 * `published_records` does not yet contain the id.
 */
export async function claimPublish(
  osfUserId: string,
  jobId: string,
  recordId: string,
  entry: PublishedRecord,
): Promise<boolean> {
  const db = requireDb();
  const updated = await db
    .update(transitionJobs)
    .set({
      publishedRecords: sql`${transitionJobs.publishedRecords} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transitionJobs.id, jobId),
        eq(transitionJobs.osfUserId, osfUserId),
        sql`NOT (${transitionJobs.publishedRecords} @> ${JSON.stringify([{ recordId }])}::jsonb)`,
      ),
    )
    .returning({ id: transitionJobs.id });

  return updated.length > 0;
}

export type ItemUpsert = {
  osfFileId: string;
  path: string;
  size: number;
  state: string;
  localSha256: string | null;
  localMd5: string | null;
  remoteMd5: string | null;
  shardIndex: number;
  problems: string[];
};

/**
 * Write a batch of per-file results.
 *
 * Returns how many rows were sent, so a caller can report a real number instead of
 * "saved". Drizzle's `onConflictDoUpdate` with a multi-row insert applies per row, which
 * is what makes a re-sent batch idempotent.
 */
export async function upsertItems(
  osfUserId: string,
  jobId: string,
  items: ItemUpsert[],
): Promise<number> {
  if (items.length === 0) return 0;
  const db = requireDb();
  await db
    .insert(transitionItems)
    .values(
      items.map((i) => ({
        jobId,
        osfUserId,
        osfFileId: i.osfFileId,
        path: i.path,
        size: i.size,
        state: i.state,
        localSha256: i.localSha256,
        localMd5: i.localMd5,
        remoteMd5: i.remoteMd5,
        shardIndex: i.shardIndex,
        problems: i.problems,
      })),
    )
    .onConflictDoUpdate({
      target: [transitionItems.jobId, transitionItems.osfFileId],
      set: {
        path: sqlExcluded("path"),
        size: sqlExcluded("size"),
        state: sqlExcluded("state"),
        localSha256: sqlExcluded("local_sha256"),
        localMd5: sqlExcluded("local_md5"),
        remoteMd5: sqlExcluded("remote_md5"),
        shardIndex: sqlExcluded("shard_index"),
        problems: sqlExcluded("problems"),
        updatedAt: new Date(),
      },
    });
  return items.length;
}

export async function listItems(osfUserId: string, jobId: string): Promise<ItemUpsert[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(transitionItems)
    .where(and(eq(transitionItems.jobId, jobId), eq(transitionItems.osfUserId, osfUserId)))
    .limit(10_000);

  return rows.map((r) => ({
    osfFileId: r.osfFileId,
    path: r.path,
    size: r.size,
    state: r.state,
    localSha256: r.localSha256,
    localMd5: r.localMd5,
    remoteMd5: r.remoteMd5,
    shardIndex: r.shardIndex,
    problems: r.problems,
  }));
}

/**
 * `excluded.<column>` — the value the failed INSERT tried to write.
 *
 * Written out rather than passing the batch's first row's value, which is the mistake this
 * helper exists to prevent: a multi-row upsert whose SET clause holds literals would write
 * ONE file's checksums onto every row in the batch.
 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
