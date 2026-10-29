/**
 * d-baf04b: the publish-claim SQL, run against real Postgres (see tests/db/pglite.ts).
 *
 * `claimPublish` appends an entry before Zenodo is called; `releasePublishClaim` must remove
 * exactly that entry — and never one carrying a DOI, which is proof of a real publication —
 * so a record Zenodo refused can be published again. `recordPublishedDoi` fills the DOI in.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { freshDb } from "../db/pglite";
import * as schema from "@/lib/db/schema";

let current: Awaited<ReturnType<typeof freshDb>>["db"];
vi.mock("@/lib/db", () => ({ requireDb: () => current, getDb: () => current }));

import { claimPublish, releasePublishClaim, recordPublishedDoi } from "@/lib/db/transition-jobs";

const JOB = "33333333-3333-4333-8333-333333333333";

async function published(): Promise<unknown[]> {
  const rows = await current.select({ p: schema.transitionJobs.publishedRecords }).from(schema.transitionJobs);
  return rows[0].p as unknown[];
}

let fresh: Awaited<ReturnType<typeof freshDb>>;
// One database per file (booting PGlite costs seconds); each test starts from empty tables.
beforeAll(async () => {
  fresh = await freshDb();
  current = fresh.db;
}, 60_000);

beforeEach(async () => {
  await fresh.client.exec("TRUNCATE transition_jobs, users CASCADE;");
  const [user] = await current
    .insert(schema.users)
    .values({ osfUserId: "osf1" } as typeof schema.users.$inferInsert)
    .returning();
  await current.insert(schema.transitionJobs).values({
    id: JOB,
    userId: user.id,
    osfUserId: "osf1",
    guid: "abc12",
    destination: "zenodo",
    env: "sandbox",
    status: "complete",
  } as typeof schema.transitionJobs.$inferInsert);
}, 60_000);

describe("publish claim SQL (real Postgres)", () => {
  it("a second claim of the same record is refused", async () => {
    const entry = { recordId: "555", doi: null, publishedAt: "2026-10-29T00:00:00Z" };
    expect(await claimPublish("osf1", JOB, "555", entry)).toBe(true);
    expect(await claimPublish("osf1", JOB, "555", entry)).toBe(false);
  });

  it("release after a definite failure lets the record be claimed again", async () => {
    const entry = { recordId: "555", doi: null, publishedAt: "2026-10-29T00:00:00Z" };
    await claimPublish("osf1", JOB, "555", entry);
    await claimPublish("osf1", JOB, "777", { ...entry, recordId: "777" });
    expect(await releasePublishClaim("osf1", JOB, "555")).toBe(true);
    expect(await published()).toEqual([{ ...entry, recordId: "777" }]);
    expect(await claimPublish("osf1", JOB, "555", entry)).toBe(true);
  });

  it("release never removes an entry that has a DOI", async () => {
    const entry = { recordId: "555", doi: null, publishedAt: "2026-10-29T00:00:00Z" };
    await claimPublish("osf1", JOB, "555", entry);
    await recordPublishedDoi("osf1", JOB, "555", "10.5072/zenodo.555");
    expect(await published()).toEqual([{ ...entry, doi: "10.5072/zenodo.555" }]);
    await releasePublishClaim("osf1", JOB, "555");
    expect(await published()).toEqual([{ ...entry, doi: "10.5072/zenodo.555" }]);
    expect(await claimPublish("osf1", JOB, "555", entry)).toBe(false);
  });

  it("release of the only entry leaves an empty array, not NULL", async () => {
    await claimPublish("osf1", JOB, "555", { recordId: "555", doi: null, publishedAt: "x" });
    await releasePublishClaim("osf1", JOB, "555");
    expect(await published()).toEqual([]);
  });

  it("another user's release touches nothing", async () => {
    await claimPublish("osf1", JOB, "555", { recordId: "555", doi: null, publishedAt: "x" });
    expect(await releasePublishClaim("someone-else", JOB, "555")).toBe(false);
    expect(await published()).toHaveLength(1);
  });
});
