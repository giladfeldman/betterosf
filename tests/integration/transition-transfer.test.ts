// The transfer runner, end to end, against a fake Zenodo.
//
// This is the test that matters most in the toolkit. `run-transfer.ts` is the only place
// where `destinationExpected: true` is ever set, and the only path where a third checksum
// comparison happens at all — so it is the only place a "verified" claim can be made about
// data that reached somebody else's archive.
//
// The real Zenodo client runs here (only `fetch` and the OPFS staging layer are faked), so
// key encoding, checksum parsing and the declare→upload→commit sequence are exercised
// rather than described.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { Blob as NodeBlob } from "node:buffer";
import { server } from "../msw/server";

// OPFS does not exist in jsdom, and a transfer's whole point is that it does not hold a
// file in memory. The fake returns the digests a real staging pass would have computed.
const staged = new Map<string, { size: number; md5: string; sha256: string; body: string }>();

vi.mock("@/lib/transition/stage-opfs", () => ({
  opfsAvailable: () => true,
  requestPersistence: async () => true,
  stageFile: vi.fn(async (opts: { osfFileId: string; declaredSize: number }) => {
    const s = staged.get(opts.osfFileId);
    if (!s) throw new Error(`OSF returned 404 for ${opts.osfFileId}`);
    return { handleName: opts.osfFileId, size: s.size, digest: { md5: s.md5, sha256: s.sha256 }, contentType: "application/octet-stream" };
  }),
  // A **Node** Blob, not jsdom's. `fetch` here is undici's, and it recognises only its own
  // Blob — handed jsdom's it sends the string "[object Blob]", so every checksum comparison
  // failed while the code under test was correct. A real browser has one Blob and one
  // fetch; this is the environment gap, spelled out so nobody re-debugs it.
  stagedBlob: vi.fn(async (osfFileId: string) => new NodeBlob([staged.get(osfFileId)!.body])),
  discardStaged: vi.fn(async () => {}),
  clearStaging: vi.fn(async () => {}),
}));

// Same environment gap, one layer up: client-zip builds its archive with the global
// `Response`, whose `.blob()` returns a **jsdom** Blob that undici's fetch will not send.
// The real zipping still runs — only the Blob is re-wrapped in the realm `fetch` accepts,
// so the bytes the fake Zenodo hashes are the bytes client-zip actually produced.
/**
 * Every entry name handed to client-zip this run.
 *
 * Asserting on the VERDICT alone is not enough for the archive path: a file left in the
 * archive despite failing its OSF checksum still reads as "failed" in the verdict, so the
 * test passed against the defect. This is what actually pins the bytes.
 */
const zippedEntryNames: string[] = [];

vi.mock("client-zip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("client-zip")>();
  return {
    ...actual,
    downloadZip: (...args: Parameters<typeof actual.downloadZip>) => {
      return {
        blob: async () => {
          // The SAME realm gap, now on the input side. The staging fake hands back **Node**
          // Blobs (undici's fetch will not send jsdom's), and client-zip type-checks its
          // inputs against the GLOBAL Blob — jsdom's — so a Node Blob comes back as
          // "Unsupported input format". In a browser there is one Blob and the question
          // never arises. Read to bytes here so the real zipper still runs on the real
          // content.
          const entries = args[0] as Iterable<{ name: string; input: unknown }>;
          const normalised = [];
          for (const entry of entries) {
            zippedEntryNames.push(entry.name);
            const input = entry.input;
            normalised.push({
              name: entry.name,
              input:
                input && typeof (input as Blob).arrayBuffer === "function"
                  ? new Uint8Array(await (input as Blob).arrayBuffer())
                  : (input as string),
            });
          }
          const response = actual.downloadZip(normalised);
          return new NodeBlob([Buffer.from(await response.arrayBuffer())]);
        },
      };
    },
  };
});

import { runTransfer, SUPPLEMENT_KEY } from "@/lib/transition/run-transfer";
import { hashBytes } from "@/lib/transition/hash";
import type { ExportPlan } from "@/lib/transition/run-export";
import type { ZenodoMetadata } from "@/lib/transition/crosswalk";

const BASE = "https://sandbox.zenodo.org/api";

/**
 * A fake Zenodo draft store.
 *
 * It HASHES THE BYTES IT RECEIVES rather than echoing a checksum it was handed. That is
 * the difference between a test that proves the three-way comparison works and one that
 * proves the code agrees with itself: a fake that returns the expected md5 by construction
 * would pass even if nothing was ever uploaded.
 */
type FakeEntry = { key: string; status: string; size: number; checksum: string | null };
const drafts = new Map<string, FakeEntry[]>();
const uploaded = new Map<string, Uint8Array>();
/**
 * Draft metadata, stored and served back.
 *
 * Needed because shard linking no longer overwrites metadata — it READS the draft, appends
 * the sibling identifiers, writes it back, and reads again to confirm nothing else moved.
 * A fake that only accepted the PUT would let a merge that silently dropped the title pass.
 */
const draftMetadata = new Map<string, Record<string, unknown>>();
/** Communities asked to take a record, in the order the runner asked. */
const communityRequests: { recordId: string; communityId: string }[] = [];
/** Records created by `POST /records/{id}/versions`, as sourceId → newId. */
const versionsCreated: { source: string; created: string }[] = [];
let nextRecordId = 1000;
/** Set to force a commit to answer with no checksum — the case destinationExpected exists for. */
let commitChecksumOverride: string | null | undefined;
let publishedRecords: string[] = [];

function installZenodoHandlers() {
  server.use(
    http.post(`${BASE}/records`, async ({ request }) => {
      const id = String(nextRecordId++);
      drafts.set(id, []);
      const body = (await request.json()) as { metadata?: Record<string, unknown> };
      draftMetadata.set(id, { ...(body.metadata ?? {}) });
      return HttpResponse.json({ id, links: {}, pids: {} }, { status: 201 });
    }),

    // A new version is a fresh, EMPTY draft — measured against sandbox.zenodo.org on
    // 2026-08-14, where `GET /records/{new}/draft/files` came back `entries: []`. It
    // inherits the published record's metadata, which is exactly why the runner must not
    // overwrite it.
    http.post(`${BASE}/records/:id/versions`, ({ params }) => {
      const id = String(nextRecordId++);
      drafts.set(id, []);
      draftMetadata.set(id, { title: "Inherited from the published version", publisher: "Zenodo" });
      versionsCreated.push({ source: String(params.id), created: id });
      return HttpResponse.json({ id, links: {}, pids: {} }, { status: 201 });
    }),

    http.get(`${BASE}/records/:id/draft`, ({ params }) =>
      HttpResponse.json({ id: params.id, metadata: draftMetadata.get(String(params.id)) ?? {} }),
    ),

    http.put(`${BASE}/records/:id/draft`, async ({ params, request }) => {
      const body = (await request.json()) as { metadata?: Record<string, unknown> };
      // Replaces, exactly like the real endpoint — which is why the runner reads first.
      draftMetadata.set(String(params.id), { ...(body.metadata ?? {}) });
      return HttpResponse.json({ ok: true });
    }),

    http.put(`${BASE}/records/:id/draft/review`, async ({ params, request }) => {
      const body = (await request.json()) as { receiver?: { community?: string } };
      communityRequests.push({ recordId: String(params.id), communityId: String(body.receiver?.community) });
      return HttpResponse.json({ id: "req-1", status: "created" });
    }),

    http.post(`${BASE}/records/:id/draft/files`, async ({ params, request }) => {
      const id = String(params.id);
      const list = drafts.get(id) ?? [];
      const body = (await request.json()) as { key: string; size?: number }[];
      for (const f of body) {
        if (!list.some((e) => e.key === f.key)) {
          list.push({ key: f.key, status: "pending", size: f.size ?? 0, checksum: null });
        }
      }
      drafts.set(id, list);
      // Zenodo returns EVERY entry on the draft, not just the ones just declared.
      return HttpResponse.json({
        entries: list.map((e) => ({
          key: e.key,
          status: e.status,
          size: e.size,
          checksum: e.checksum,
          links: {
            content: `${BASE}/records/${id}/draft/files/${encodeURIComponent(e.key)}/content`,
            commit: `${BASE}/records/${id}/draft/files/${encodeURIComponent(e.key)}/commit`,
          },
        })),
      });
    }),

    http.get(`${BASE}/records/:id/draft/files`, ({ params }) => {
      const list = drafts.get(String(params.id)) ?? [];
      return HttpResponse.json({
        entries: list.map((e) => ({ key: e.key, status: e.status, size: e.size, checksum: e.checksum })),
      });
    }),

    http.put(`${BASE}/records/:id/draft/files/*/content`, async ({ request }) => {
      const url = new URL(request.url);
      const id = String(url.pathname.split("/")[3]);
      const key = decodeKey(url.pathname.split("/draft/files/")[1]!.replace(/\/content$/, ""));
      uploaded.set(`${id}:${key}`, new Uint8Array(await request.arrayBuffer()));
      return HttpResponse.json({ ok: true });
    }),

    http.post(`${BASE}/records/:id/draft/files/*/commit`, async ({ request }) => {
      const url = new URL(request.url);
      const id = String(url.pathname.split("/")[3]);
      const key = decodeKey(url.pathname.split("/draft/files/")[1]!.replace(/\/commit$/, ""));
      const list = drafts.get(id) ?? [];
      const entry = list.find((e) => e.key === key);
      if (!entry) return HttpResponse.json({ message: "no such file" }, { status: 404 });

      const bytes = uploaded.get(`${id}:${key}`);
      // Hashed here, from what arrived — the same thing the real service does.
      const computed = bytes ? `md5:${(await hashBytes(bytes)).md5}` : null;
      const checksum = commitChecksumOverride === undefined ? computed : commitChecksumOverride;
      entry.status = "completed";
      entry.size = bytes?.byteLength ?? entry.size;
      entry.checksum = checksum;
      return HttpResponse.json({ key, size: entry.size, checksum, status: "completed" });
    }),

    http.delete(`${BASE}/records/:id/draft/files/*`, ({ request }) => {
      const url = new URL(request.url);
      const id = String(url.pathname.split("/")[3]);
      const key = decodeKey(url.pathname.split("/draft/files/")[1]!);
      drafts.set(id, (drafts.get(id) ?? []).filter((e) => e.key !== key));
      uploaded.delete(`${id}:${key}`);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post(`${BASE}/records/:id/draft/actions/publish`, ({ params }) => {
      publishedRecords.push(String(params.id));
      return HttpResponse.json({ id: params.id, links: {}, pids: { doi: { identifier: "10.5072/x" } } });
    }),
  );
}

const metadata: ZenodoMetadata = {
  title: "Test project",
  publisher: "Zenodo",
  publication_date: "2026-01-01",
  resource_type: { id: "dataset" },
  creators: [{ person_or_org: { type: "personal", family_name: "Probe" } }],
};

/** Split a `key/with/slashes` back out of a request path, one segment at a time. */
function decodeKey(encoded: string): string {
  return encoded.split("/").map(decodeURIComponent).join("/");
}

type FixtureFile = {
  id: string;
  path: string;
  body: string;
  /**
   * What OSF claims about this file:
   *   "correct" — the real hashes (the normal case),
   *   "wrong"   — hashes of different bytes (a corrupt or swapped download),
   *   "none"    — no checksum at all (add-on storage: Dropbox, Drive, S3, GitHub).
   */
  declared?: "correct" | "wrong" | "none";
};

/**
 * Build a plan whose hashes are REAL.
 *
 * The staging fake returns the actual digest of the body, and the fake Zenodo hashes what
 * it receives, so all three comparisons in `verifyFile` are performed against genuinely
 * independent computations rather than against a constant this file made up.
 */
async function planWith(files: FixtureFile[]): Promise<ExportPlan> {
  staged.clear();
  uploaded.clear();
  const planFiles: ExportPlan["files"] = [];

  for (const f of files) {
    const bytes = new TextEncoder().encode(f.body);
    const digest = await hashBytes(bytes);
    staged.set(f.id, { size: bytes.byteLength, md5: digest.md5, sha256: digest.sha256, body: f.body });

    const wrong = await hashBytes(new TextEncoder().encode(`${f.body}-tampered`));
    const declared =
      f.declared === "none"
        ? { md5: null, sha256: null }
        : f.declared === "wrong"
          ? { md5: wrong.md5, sha256: wrong.sha256 }
          : { md5: digest.md5, sha256: digest.sha256 };

    planFiles.push({
      osfFileId: f.id,
      path: f.path,
      size: bytes.byteLength,
      downloadUrl: `https://files.osf.io/v1/${f.id}`,
      md5: declared.md5,
      sha256: declared.sha256,
      sourceGuid: "abc12",
    });
  }

  return {
    guid: "abc12",
    projectTitle: "Test project",
    osfUrl: "https://osf.io/abc12/",
    doi: null,
    files: planFiles,
    extras: [{ path: "metadata/osf-project.json", text: "{}" }],
    coveredNodes: [{ guid: "abc12", title: "Test project", kind: "project", fileCount: planFiles.length }],
    contributors: [],
    crateInput: {
      description: "",
      datePublished: "2026-01-01",
      dateModified: "2026-01-02",
      keywords: [],
      license: null,
    },
  };
}

/** The digest the staging fake will report for a file, for assertions about resume. */
function stagedDigest(id: string): { md5: string; sha256: string } {
  const s = staged.get(id)!;
  return { md5: s.md5, sha256: s.sha256 };
}

function run(plan: ExportPlan, extra: Partial<Parameters<typeof runTransfer>[0]> = {}) {
  return runTransfer({
    jobId: "11111111-1111-4111-8111-111111111111",
    plan,
    osfToken: "osf-token",
    zenodo: { accessToken: "zen-token", env: "sandbox" },
    metadata,
    fidelity: [],
    appVersion: "test",
    now: () => new Date("2026-08-13T00:00:00Z"),
    ...extra,
  });
}

beforeEach(() => {
  drafts.clear();
  uploaded.clear();
  draftMetadata.clear();
  zippedEntryNames.length = 0;
  communityRequests.length = 0;
  versionsCreated.length = 0;
  publishedRecords = [];
  commitChecksumOverride = undefined;
  installZenodoHandlers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runTransfer", () => {
  it("uploads every file, verifies all three checksums and reconciles complete", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/sub dir/b.csv", body: "bbb" },
    ]);

    const result = await run(plan);

    expect(result.verdict.status).toBe("complete");
    expect(result.verdict.counts.verified).toBe(2);
    expect(result.records).toHaveLength(1);

    // The third comparison actually happened, on both files.
    for (const v of result.verifications) {
      const destination = v.checks.find((c) => c.name === "destination-md5");
      expect(destination?.passed).toBe(true);
    }

    // Folder structure survives: the key keeps its slashes.
    const entries = drafts.get(result.records[0]!.recordId)!;
    expect(entries.map((e) => e.key)).toContain("osfstorage/sub dir/b.csv");
  });

  it("FAILS a file whose commit reported no checksum, rather than skipping the check", async () => {
    // The whole reason destinationExpected exists. Without it this run reports "verified"
    // on the one path where the destination comparison is the point.
    commitChecksumOverride = null;
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);

    const result = await run(plan);

    expect(result.verdict.status).toBe("incomplete");
    expect(result.verifications[0]!.state).toBe("failed");
    expect(result.verifications[0]!.problems.join(" ")).toMatch(/reported no checksum/i);
  });

  it("FAILS a file the destination stored differently from what was sent", async () => {
    commitChecksumOverride = `md5:${"c".repeat(32)}`;
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);

    const result = await run(plan);
    expect(result.verdict.status).toBe("incomplete");
    expect(result.verifications[0]!.problems.join(" ")).toMatch(/different checksum/i);
  });

  it("refuses to upload bytes that do not match what OSF says it holds", async () => {
    // A permanent, citable copy of the wrong thing is the worst outcome available here.
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa", declared: "wrong" }]);

    const result = await run(plan);

    expect(result.verifications[0]!.state).toBe("failed");
    expect(result.verdict.status).toBe("incomplete");
    // Nothing reached the draft.
    const entries = drafts.get(result.records[0]!.recordId)!;
    expect(entries.filter((e) => e.key !== SUPPLEMENT_KEY)).toHaveLength(0);
  });

  it("marks a file OSF gave no checksum for as unverifiable, never verified", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/addon.csv", body: "aaa", declared: "none" }]);

    const result = await run(plan);

    expect(result.verifications[0]!.state).toBe("unverifiable");
    // Still counted as transferred, so the run can be complete — and named in the report.
    expect(result.verdict.status).toBe("complete");
    expect(result.verdict.unverifiable).toEqual(["osfstorage/addon.csv"]);
  });

  it("records a download failure and keeps going instead of stopping at the first one", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    // A file the fake staging layer has never heard of throws, like a 404 would.
    plan.files.push({
      osfFileId: "missing",
      path: "osfstorage/gone.csv",
      size: 3,
      downloadUrl: "https://files.osf.io/v1/missing",
      md5: "b".repeat(32),
      sha256: "b".repeat(64),
      sourceGuid: "abc12",
    });

    const result = await run(plan);

    expect(result.verifications).toHaveLength(2);
    expect(result.verifications.find((v) => v.path === "osfstorage/a.csv")!.state).toBe("verified");
    expect(result.verifications.find((v) => v.path === "osfstorage/gone.csv")!.state).toBe("failed");
    expect(result.verdict.status).toBe("incomplete");
  });

  it("deposits the report bundle on the record", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan);

    const entries = drafts.get(result.records[0]!.recordId)!;
    expect(entries.map((e) => e.key)).toContain(SUPPLEMENT_KEY);
    expect(result.supplement.deposited).toBe(1);
    expect(result.supplement.expected).toBe(1);
  });

  it("never publishes anything", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    await run(plan);
    expect(publishedRecords).toEqual([]);
  });

  it("checkpoints the job and its items through the ledger", async () => {
    const jobs: unknown[] = [];
    const items: unknown[] = [];
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);

    await run(plan, {
      ledger: {
        saveJob: async (j) => void jobs.push(j),
        saveItems: async (_id, batch) => void items.push(...batch),
        loadItems: async () => [],
      },
    });

    expect(jobs.length).toBeGreaterThanOrEqual(2); // running, then the final status
    expect((jobs.at(-1) as { status: string }).status).toBe("complete");
    expect(items).toHaveLength(1);
    expect((items[0] as { remoteMd5: string }).remoteMd5).toBe(stagedDigest("f1").md5);
  });

  it("keeps running when every ledger write fails", async () => {
    // A checkpoint is a convenience. Losing one must never stop a transfer that works.
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, {
      ledger: {
        saveJob: async () => {
          throw new Error("offline");
        },
        saveItems: async () => {
          throw new Error("offline");
        },
        loadItems: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(result.verdict.status).toBe("complete");
  });

  it("resumes into the SAME draft and skips a file the destination still holds", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/b.csv", body: "bbb" },
    ]);

    const first = await run(plan);
    const recordId = first.records[0]!.recordId;
    const priorItems = [
      {
        osfFileId: "f1",
        path: "osfstorage/a.csv",
        size: 3,
        state: "verified" as const,
        localSha256: stagedDigest("f1").sha256,
        localMd5: stagedDigest("f1").md5,
        remoteMd5: stagedDigest("f1").md5,
        shardIndex: 0,
        problems: [],
      },
    ];

    const stageFile = vi.mocked((await import("@/lib/transition/stage-opfs")).stageFile);
    stageFile.mockClear();

    const second = await run(plan, {
      resumeRecordIds: [recordId],
      ledger: {
        saveJob: async () => {},
        saveItems: async () => {},
        loadItems: async () => priorItems,
      },
    });

    expect(second.records[0]!.recordId).toBe(recordId);
    expect(second.verdict.status).toBe("complete");
    // f1 was not re-downloaded; f2 was.
    const restaged = stageFile.mock.calls.map((c) => (c[0] as { osfFileId: string }).osfFileId);
    expect(restaged).not.toContain("f1");
    expect(restaged).toContain("f2");
  });

  it("re-transfers a file whose prior checksum no longer matches the destination", async () => {
    // The stored verification is a memory; the destination's current state is the fact.
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const first = await run(plan);
    const recordId = first.records[0]!.recordId;

    const stageFile = vi.mocked((await import("@/lib/transition/stage-opfs")).stageFile);
    stageFile.mockClear();

    const second = await run(plan, {
      resumeRecordIds: [recordId],
      ledger: {
        saveJob: async () => {},
        saveItems: async () => {},
        loadItems: async () => [
          {
            osfFileId: "f1",
            path: "osfstorage/a.csv",
            size: 3,
            state: "verified" as const,
            localSha256: stagedDigest("f1").sha256,
            localMd5: stagedDigest("f1").md5,
            // Disagrees with what the draft actually holds.
            remoteMd5: "d".repeat(32),
            shardIndex: 0,
            problems: [],
          },
        ],
      },
    });

    expect(stageFile.mock.calls.map((c) => (c[0] as { osfFileId: string }).osfFileId)).toContain("f1");
    expect(second.verdict.status).toBe("complete");
  });

  it("splits a large project across linked records and reconciles over all of them", async () => {
    const plan = await planWith(
      Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, path: `osfstorage/f${i}.csv`, body: `body-${i}` })),
    );

    // Force two records without uploading 100 files: the caps are the runner's, so this
    // exercises the real path by making the per-record byte budget tiny.
    const result = await runTransfer({
      jobId: "22222222-2222-4222-8222-222222222222",
      plan,
      osfToken: "t",
      zenodo: { accessToken: "z", env: "sandbox" },
      metadata,
      fidelity: [],
      appVersion: "test",
      now: () => new Date("2026-08-13T00:00:00Z"),
      shardLimits: { maxFiles: 2, maxBytes: 1_000_000 },
    });

    expect(result.records).toHaveLength(3);
    expect(result.verdict.status).toBe("complete");
    expect(result.verdict.counts.verified).toBe(5);
    // Every record carries the report bundle.
    expect(result.supplement.deposited).toBe(3);
  });
});

/**
 * Defects found by a Codex review on 2026-08-13, each reproduced here FIRST against the
 * unfixed code. Both are ways a run could report success over data that is not there or
 * not current — the exact failure this module exists to prevent.
 */
describe("runTransfer — reviewer findings (Codex, 2026-08-13)", () => {
  it("does NOT reuse a prior verification when OSF now reports a different checksum", async () => {
    // The file changed on OSF between attempts. Same id, same path, same SIZE — so the
    // size check passes — but different bytes. Zenodo still holds the OLD copy, whose md5
    // matches what we recorded last time, so every condition of the fast-resume path is
    // satisfied while the deposit is now stale.
    const original = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const first = await run(original);
    const recordId = first.records[0]!.recordId;
    const priorDigest = stagedDigest("f1");

    // Same length, different content.
    const changed = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "zzz" }]);

    const second = await run(changed, {
      resumeRecordIds: [recordId],
      ledger: {
        saveJob: async () => {},
        saveItems: async () => {},
        loadItems: async () => [
          {
            osfFileId: "f1",
            path: "osfstorage/a.csv",
            size: 3,
            state: "verified" as const,
            localSha256: priorDigest.sha256,
            localMd5: priorDigest.md5,
            remoteMd5: priorDigest.md5,
            shardIndex: 0,
            problems: [],
          },
        ],
      },
    });

    // The deposit must end up holding the NEW bytes, and must not have claimed the old
    // ones were fine.
    const stored = uploaded.get(`${recordId}:osfstorage/a.csv`);
    expect(new TextDecoder().decode(stored)).toBe("zzz");
    expect(second.verdict.status).toBe("complete");
  });

  it("refuses to call a run complete when Zenodo's listing could not be read", async () => {
    // Every file committed with a matching checksum, but the final listing — the
    // independent third opinion that the files really landed — failed. "No third opinion"
    // must not silently become "confirmed".
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);

    let commitsSeen = 0;
    server.use(
      http.get(`${BASE}/records/:id/draft/files`, () => {
        // Fail only the final reconciliation read; the per-record read at the start of the
        // shard loop must still work, or nothing gets uploaded at all.
        if (commitsSeen > 0) return HttpResponse.json({ message: "boom" }, { status: 503 });
        return HttpResponse.json({ entries: [] });
      }),
      http.post(`${BASE}/records/:id/draft/files/*/commit`, async ({ request }) => {
        commitsSeen += 1;
        const url = new URL(request.url);
        const id = String(url.pathname.split("/")[3]);
        const key = decodeKey(url.pathname.split("/draft/files/")[1]!.replace(/\/commit$/, ""));
        const bytes = uploaded.get(`${id}:${key}`);
        return HttpResponse.json({
          key,
          size: bytes?.byteLength ?? 0,
          checksum: bytes ? `md5:${(await hashBytes(bytes)).md5}` : null,
          status: "completed",
        });
      }),
    );

    const result = await run(plan);

    expect(result.verdict.status).not.toBe("complete");
    expect(JSON.stringify(result.verdict)).toMatch(/could not|unavailable|no independent/i);
  });
});

/**
 * Reviewer finding (Sonnet, 2026-08-13): a destination-key collision is caught by
 * `reconcile` — the run goes incomplete — but the CROSSWALK CSV, which is the artefact a
 * researcher uses to repair links in papers, still printed `verified` for the file whose
 * bytes were overwritten, and attributed the other file's size and SHA-256 to it.
 *
 * Root cause: the report rows were keyed by PATH, in a module whose stated rule is to bind
 * by OSF's immutable file id and never by path.
 */
describe("runTransfer — destination-key collisions (Sonnet, 2026-08-13)", () => {
  it("never prints 'verified' in the crosswalk for a file another one overwrote", async () => {
    // Two distinct OSF files whose paths collapse to the same Zenodo key. OSF permits
    // names differing only by Unicode normalisation form; Zenodo has one key per string.
    const plan = await planWith([
      { id: "f1", path: "osfstorage/cafe\u0301.csv", body: "first" },
      { id: "f2", path: "osfstorage/caf\u00e9.csv", body: "second-and-longer" },
    ]);

    const result = await run(plan);

    expect(result.verdict.status).toBe("incomplete");

    // No row for either colliding file may claim to be verified, and none may point at a
    // destination key it does not own.
    const rows = result.crosswalkCsv.split("\n").filter((l) => l.includes("caf"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toMatch(/,verified,/);
    }
  });

  it("attributes each file's own size and hash, not whichever shared its path", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/cafe\u0301.csv", body: "first" },
      { id: "f2", path: "osfstorage/caf\u00e9.csv", body: "second-and-longer" },
    ]);
    const first = plan.files.find((f) => f.osfFileId === "f1")!;
    const second = plan.files.find((f) => f.osfFileId === "f2")!;
    expect(first.size).not.toBe(second.size);

    const result = await run(plan);
    // Read the size column by NAME. Hard-coding index 4 silently started reading
    // `osf_node_url` when the per-file node columns were added, and the assertion compared
    // NaN against NaN's neighbours rather than failing on the thing it was written for.
    const header = result.crosswalkCsv.split("\n")[0]!.split(",");
    const sizeColumn = header.indexOf("size_bytes");
    expect(sizeColumn).toBeGreaterThan(-1);
    const sizes = result.crosswalkCsv
      .split("\n")
      .filter((l) => l.includes("caf"))
      .map((l) => Number(l.split(",")[sizeColumn]));

    // Both real sizes appear exactly once; neither file borrowed the other's.
    expect(sizes.sort((a, b) => a - b)).toEqual([first.size, second.size].sort((a, b) => a - b));
  });
});

/**
 * Where the deposit lands (v1.12).
 *
 * Every shape asserted here was measured against sandbox.zenodo.org on 2026-08-14 before
 * any of it was written — see the docs on `createNewVersion`, `requestCommunityReview` and
 * `appendRelatedIdentifiers` for the exact responses.
 */
describe("runTransfer — destination options", () => {
  it("adds to an existing draft instead of creating one, and leaves its metadata alone", async () => {
    // A draft the user already has, with metadata they curated and one file of their own.
    drafts.set("777", [{ key: "notes/theirs.txt", status: "completed", size: 12, checksum: "md5:aa" }]);
    draftMetadata.set("777", { title: "A title they wrote", publisher: "Zenodo", description: "theirs" });

    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { destination: { kind: "existing-draft", recordId: "777" } });

    expect(result.records.map((r) => r.recordId)).toEqual(["777"]);
    expect(result.verdict.status).toBe("complete");
    // Their file is untouched and ours is alongside it.
    expect((drafts.get("777") ?? []).map((e) => e.key).sort()).toEqual(
      ["betterosf-supplement.zip", "notes/theirs.txt", "osfstorage/a.csv"].sort(),
    );
    // Their metadata is exactly as it was: no crosswalk was written over the top.
    expect(draftMetadata.get("777")).toEqual({
      title: "A title they wrote",
      publisher: "Zenodo",
      description: "theirs",
    });
    expect(result.destinationKind).toBe("existing-draft");
  });

  it("says in the report that the draft already held files it did not verify", async () => {
    drafts.set("778", [{ key: "notes/theirs.txt", status: "completed", size: 12, checksum: "md5:aa" }]);
    draftMetadata.set("778", { title: "Theirs" });
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { destination: { kind: "existing-draft", recordId: "778" } });

    expect(result.reportMarkdown).toMatch(/already held 1 file/);
    expect(result.reportMarkdown).toMatch(/left its metadata alone/);
  });

  it("counts what the draft already holds against the per-record cap", async () => {
    // Two slots, one already used by a file that is not ours, so our two files need a
    // second record. Assuming an empty draft would have hit Zenodo's cap mid-run.
    drafts.set("779", [{ key: "notes/theirs.txt", status: "completed", size: 1, checksum: "md5:aa" }]);
    draftMetadata.set("779", { title: "Theirs" });
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/b.csv", body: "bbb" },
    ]);
    const result = await run(plan, {
      destination: { kind: "existing-draft", recordId: "779" },
      shardLimits: { maxFiles: 2, maxBytes: 1024 },
    });

    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.recordId).toBe("779");
    expect(result.records[0]!.fileCount).toBe(1);
    expect(result.verdict.status).toBe("complete");
  });

  it("does not count OUR OWN keys twice when adding to the same draft again", async () => {
    // Re-sending a key REPLACES that entry rather than adding one, so a file this deposit
    // already put there must not be charged against the cap a second time.
    drafts.set("780", [{ key: "osfstorage/a.csv", status: "completed", size: 3, checksum: "md5:aa" }]);
    draftMetadata.set("780", { title: "Ours" });
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/b.csv", body: "bbb" },
    ]);
    const result = await run(plan, {
      destination: { kind: "existing-draft", recordId: "780" },
      shardLimits: { maxFiles: 2, maxBytes: 1024 },
    });
    expect(result.records).toHaveLength(1);
  });

  it("refuses a draft with no room left, before uploading anything", async () => {
    drafts.set("781", [
      { key: "a", status: "completed", size: 1, checksum: "md5:a" },
      { key: "b", status: "completed", size: 1, checksum: "md5:b" },
    ]);
    draftMetadata.set("781", { title: "Full" });
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);

    await expect(
      run(plan, {
        destination: { kind: "existing-draft", recordId: "781" },
        shardLimits: { maxFiles: 2, maxBytes: 1024 },
      }),
    ).rejects.toThrow(/no room left/i);
    // Nothing was uploaded into it.
    expect((drafts.get("781") ?? []).map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("creates a new version of a published record and never imports its old files", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { destination: { kind: "new-version", sourceRecordId: "555" } });

    expect(versionsCreated).toHaveLength(1);
    expect(versionsCreated[0]!.source).toBe("555");
    const created = versionsCreated[0]!.created;
    expect(result.records.map((r) => r.recordId)).toEqual([created]);
    // Only what this run uploaded, plus the report bundle. `files-import` would have
    // brought the previous version's files across, spending file slots on bytes this run
    // never checked and leaving two states of the project in one deposit.
    expect((drafts.get(created) ?? []).map((e) => e.key).sort()).toEqual(
      ["betterosf-supplement.zip", "osfstorage/a.csv"].sort(),
    );
    // The inherited metadata is still the inherited metadata.
    expect(draftMetadata.get(created)).toEqual({
      title: "Inherited from the published version",
      publisher: "Zenodo",
    });
    expect(result.destinationKind).toBe("new-version");
  });

  it("asks a community to take every record, without submitting or publishing anything", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { communityId: "comm-uuid" });

    expect(communityRequests).toEqual([
      { recordId: result.records[0]!.recordId, communityId: "comm-uuid" },
    ]);
    expect(result.community.requested).toBe(true);
    // The measured consequence: an open review request blocks POST /draft/actions/publish.
    expect(result.community.blocksDirectPublish).toBe(true);
    expect(publishedRecords).toEqual([]);
    expect(result.reportMarkdown).toMatch(/curator still has to accept it/);
  });

  it("does not let a community refusing the request fail the transfer", async () => {
    server.use(
      http.put(`${BASE}/records/:id/draft/review`, () =>
        HttpResponse.json({ message: "community not found" }, { status: 404 }),
      ),
    );
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { communityId: "nope" });

    // The files copied and verified; only the community request failed.
    expect(result.verdict.status).toBe("complete");
    expect(result.community.requested).toBe(false);
    expect(result.community.problems).toHaveLength(1);
    expect(result.community.problems[0]).toMatch(/files are unaffected/i);
  });

  it("refuses a single-archive deposit into anything but a new record", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    await expect(
      run(plan, {
        packageAsArchive: true,
        destination: { kind: "existing-draft", recordId: "777" },
      }),
    ).rejects.toThrow(/only offered for a new record/i);
  });

  it("appends sibling links to a split deposit instead of overwriting the metadata", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/b.csv", body: "bbb" },
    ]);
    const result = await run(plan, { shardLimits: { maxFiles: 1, maxBytes: 1024 } });
    expect(result.records).toHaveLength(2);

    for (const record of result.records) {
      const md = draftMetadata.get(record.recordId)!;
      // The title set at creation survived the linking step. A full-replace PUT looks
      // identical to this on a fresh record and is destructive on a draft the user chose,
      // which is exactly why the linking step no longer replaces.
      expect(String(md.title)).toMatch(/^Test project \(part \d of 2\)$/);
      expect(md.publisher).toBe("Zenodo");
      const rels = md.related_identifiers as { identifier: string; relation_type: { id: string } }[];
      expect(rels.filter((r) => r.relation_type.id === "ispartof")).toHaveLength(1);
    }
  });
});

/**
 * The single-archive deposit — Lakens's shape, offered as the answer to sharding.
 *
 * The thing these tests exist to prevent is the deposit reading as if it carried the same
 * guarantee as a per-file one. It does not: Zenodo holds ONE checksum, for a container OSF
 * never had. Every assertion below is about that difference being visible.
 */
describe("runTransfer — single-archive deposit", () => {
  it("puts exactly one archive on the record, beside the report bundle", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/a.csv", body: "aaa" },
      { id: "f2", path: "osfstorage/sub dir/b.csv", body: "bbb" },
    ]);
    const result = await run(plan, { packageAsArchive: true });

    expect(result.records).toHaveLength(1);
    const keys = (drafts.get(result.records[0]!.recordId) ?? []).map((e) => e.key).sort();
    expect(keys).toEqual([SUPPLEMENT_KEY, "betterosf-archive.zip"].sort());
    expect(result.verdict.status).toBe("complete");
    // Both files are still expected and still individually accounted for.
    expect(result.verdict.counts.expected).toBe(2);
    expect(result.verdict.counts.verified).toBe(2);
  });

  it("says in the verdict that the destination check covers the ARCHIVE, not each file", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { packageAsArchive: true });

    expect(result.verdict.summary).toMatch(/covers the ARCHIVE, not each file/);
    expect(result.verdict.summary).toMatch(/container OSF never had/);
    // And the per-file wording from the normal path must NOT appear — a researcher
    // comparing two reports has to see the difference in the sentence.
    expect(result.verdict.summary).not.toMatch(/transferred and checksum-verified\./);
  });

  it("names the archive on the record, and points each file inside it", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { packageAsArchive: true });

    // Not the bare archive key: that would suggest the file can be fetched on its own,
    // which is precisely what this trade gives up.
    expect(result.crosswalkCsv).toMatch(/betterosf-archive\.zip!\/data\/osfstorage\/a\.csv/);
    expect(result.reportMarkdown).toMatch(/MANIFEST\.tsv/);
    expect(result.reportMarkdown).toMatch(/one checksum, for the archive/);
  });

  it("leaves a file that fails its OSF checksum OUT, and refuses to call the run complete", async () => {
    const plan = await planWith([
      { id: "f1", path: "osfstorage/good.csv", body: "aaa" },
      // OSF's declared checksum does not match the bytes: pushing these into a permanent
      // citable archive is the worst outcome available.
      { id: "f2", path: "osfstorage/bad.csv", body: "bbb", declared: "wrong" },
    ]);
    const result = await run(plan, { packageAsArchive: true });

    expect(result.verdict.status).toBe("incomplete");
    expect(result.verdict.failed.map((f) => f.path)).toContain("osfstorage/bad.csv");
    // The archive itself still uploaded and still verified — the failure is about the file.
    expect(result.verdict.blockers).toEqual([]);

    // And the bytes really are absent. Asserting only on the verdict passed even with the
    // exclusion removed, because a file left IN still reports "failed" — the verdict is
    // about the check, not about what went in the archive.
    expect(zippedEntryNames).toContain("data/osfstorage/good.csv");
    expect(zippedEntryNames).not.toContain("data/osfstorage/bad.csv");
    // …but it is still named in the manifest, so its absence is documented rather than silent.
    expect(zippedEntryNames).toContain("MANIFEST.tsv");
  });

  it("treats an archive Zenodo could not confirm as a blocker for the whole run", async () => {
    // The single point of failure a container deposit creates, and the reason it is not
    // the default: one bad answer invalidates everything inside.
    commitChecksumOverride = null;
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { packageAsArchive: true });

    expect(result.verdict.status).toBe("incomplete");
    expect(result.verdict.blockers.join(" ")).toMatch(/did not verify at the destination/);
    expect(result.verdict.blockers.join(" ")).toMatch(/Nothing inside it can be relied on/);
    // Every file passed its own checks — which is exactly why the blocker is needed.
    expect(result.verdict.counts.failed).toBe(0);
  });

  it("tells the record's readers, in the description, that they are looking at an archive", async () => {
    const plan = await planWith([{ id: "f1", path: "osfstorage/a.csv", body: "aaa" }]);
    const result = await run(plan, { packageAsArchive: true });

    const description = String(draftMetadata.get(result.records[0]!.recordId)!.description);
    expect(description).toMatch(/single archive/i);
    expect(description).toMatch(/MANIFEST\.tsv/);
    expect(description).toMatch(/covers the archive, not the individual files/i);
  });
});
