/**
 * An interrupted export must keep what it already verified.
 *
 * THE DEFECT, reported 2026-08-14: a 79-file export ran to about 60% and then died with
 * `AbortError: The operation was aborted`. The whole run was thrown away — an hour of
 * downloading and checksumming gone, with nothing to show for it and nothing saying which
 * files had been fine.
 *
 * The module's own contract already said the opposite: "A file that fails is recorded and
 * the run CONTINUES: stopping at the first failure would leave a researcher with nothing
 * and no list of what went wrong." A torn-down connection was the one path that ignored it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const staged = new Map<string, { size: number; md5: string; sha256: string; body: string }>();
/** File ids that should throw, and what they should throw. */
const failures = new Map<string, () => Error>();
const stageCalls: string[] = [];

vi.mock("@/lib/transition/stage-opfs", () => ({
  opfsAvailable: () => true,
  requestPersistence: async () => true,
  stageFile: vi.fn(async (opts: { osfFileId: string }) => {
    stageCalls.push(opts.osfFileId);
    const fail = failures.get(opts.osfFileId);
    if (fail) throw fail();
    const s = staged.get(opts.osfFileId)!;
    return { handleName: opts.osfFileId, size: s.size, digest: { md5: s.md5, sha256: s.sha256 }, contentType: "application/octet-stream" };
  }),
  stagedBlob: vi.fn(async (id: string) => new Blob([staged.get(id)!.body])),
  discardStaged: vi.fn(async () => {}),
  clearStaging: vi.fn(async () => {}),
}));

import { runExport } from "@/lib/transition/run-export";
import type { ExportPlan } from "@/lib/transition/run-export";

const hash = (c: string) => ({ md5: c.repeat(32), sha256: c.repeat(64) });

function plan(count: number): ExportPlan {
  staged.clear();
  const files = Array.from({ length: count }, (_, i) => {
    const h = hash(String(i % 10));
    staged.set(`f${i}`, { size: 3, ...h, body: "abc" });
    return {
      osfFileId: `f${i}`,
      path: `osfstorage/file${i}.csv`,
      size: 3,
      downloadUrl: `https://files.osf.io/v1/resources/abc12/providers/osfstorage/${i}?direct=`,
      ...h,
      provider: "osfstorage",
    };
  });
  return {
    guid: "abc12",
    projectTitle: "P",
    osfUrl: "https://osf.io/abc12/",
    doi: null,
    files,
    extras: [],
    contributors: [],
    crateInput: { description: "", datePublished: "2026-01-01", dateModified: "2026-01-02", keywords: [], license: null },
  };
}

const run = (p: ExportPlan, signal?: AbortSignal) =>
  runExport({ plan: p, token: "t", appVersion: "test", now: () => new Date("2026-08-14T00:00:00Z"), signal });

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

beforeEach(() => {
  failures.clear();
  stageCalls.length = 0;
  vi.clearAllMocks();
});

describe("a connection torn down mid-run", () => {
  it("keeps every file verified before it, instead of losing the whole run", async () => {
    const p = plan(5);
    // File 3 drops, permanently — every retry fails too.
    failures.set("f3", abortError);

    const result = await run(p);

    // The old behaviour: this call threw and the user got nothing.
    expect(result.verdict.counts.verified).toBe(3);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.reportMarkdown).toContain("INCOMPLETE");
  });

  it("says it was cut short, and where", async () => {
    const p = plan(5);
    failures.set("f2", abortError);

    const result = await run(p);

    expect(result.interrupted).not.toBeNull();
    expect(result.interrupted!.stoppedByUser).toBe(false);
    expect(result.interrupted!.atFile).toBe("osfstorage/file2.csv");
    expect(result.interrupted!.reason).toMatch(/interrupted/i);
  });

  it("never reconciles an interrupted run as complete", async () => {
    const p = plan(5);
    failures.set("f4", abortError);
    const result = await run(p);
    expect(result.verdict.status).toBe("incomplete");
  });

  it("retries a dropped download before giving up on the file", async () => {
    const p = plan(2);
    failures.set("f0", () => {
      // Fails once, then clears itself, so the SECOND attempt succeeds.
      failures.delete("f0");
      return abortError();
    });

    const result = await run(p);

    expect(stageCalls.filter((id) => id === "f0").length).toBe(2);
    expect(result.verdict.status).toBe("complete");
    expect(result.interrupted).toBeNull();
  });

  it("does NOT retry a checksum mismatch — retrying cannot change it", async () => {
    // Three slow attempts at a file that will never match wastes the researcher's time to
    // arrive at exactly the same honest failure.
    const p = plan(1);
    failures.set("f0", () => new Error("Staged 3 bytes but OSF declared 9999. The download is incomplete."));

    const result = await run(p);

    expect(stageCalls.filter((id) => id === "f0").length).toBe(1);
    expect(result.verdict.status).toBe("incomplete");
  });
});

describe("the staged files are still readable when the archive is built", () => {
  it("does not delete a staged file before the ZIP reads it", async () => {
    // THE BUG, shipped since v1.8.0: each file's Blob was pushed into the archive and the
    // backing OPFS file deleted immediately afterwards, under a comment claiming "peak
    // disk stays at one file". The ZIP is only assembled at the END, so every one of those
    // Blobs was dangling by then and packaging failed — as `AbortError` in Firefox, naming
    // neither the cause nor a file.
    const p = plan(3);
    const { discardStaged, stagedBlob } = await import("@/lib/transition/stage-opfs");

    const discardedBeforeRead = new Set<string>();
    vi.mocked(discardStaged).mockImplementation(async (id: string) => {
      discardedBeforeRead.add(id);
    });
    vi.mocked(stagedBlob).mockImplementation(async (id: string) => {
      if (discardedBeforeRead.has(id)) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return new Blob([staged.get(id)!.body]);
    });

    const result = await run(p);

    expect(result.verdict.status).toBe("complete");
    expect(result.blob.size).toBeGreaterThan(0);
  });
});

describe("the run log", () => {
  it("records each file, so a failure names one instead of just 'aborted'", async () => {
    const p = plan(2);
    failures.set("f1", () => new Error("Staged 3 bytes but OSF declared 9999."));
    const log: import("@/lib/transition/run-export").RunLogEntry[] = [];

    await runExport({
      plan: p,
      token: "t",
      appVersion: "test",
      now: () => new Date("2026-08-14T00:00:00Z"),
      log,
    });

    expect(log.some((e) => e.phase === "plan")).toBe(true);
    expect(log.some((e) => e.phase === "package")).toBe(true);
    expect(log.some((e) => e.phase === "done")).toBe(true);
    const failed = log.find((e) => e.error);
    expect(failed?.path).toBe("osfstorage/file1.csv");
    expect(failed?.index).toBe(2);
  });

  it("survives a run that throws, because the caller owns the array", async () => {
    const p = plan(1);
    const log: import("@/lib/transition/run-export").RunLogEntry[] = [];
    const { stagedBlob } = await import("@/lib/transition/stage-opfs");
    vi.mocked(stagedBlob).mockRejectedValue(new Error("packaging blew up"));

    await runExport({
      plan: p,
      token: "t",
      appVersion: "test",
      now: () => new Date("2026-08-14T00:00:00Z"),
      log,
    }).catch(() => {});

    // The diary is still here even though the run did not return one.
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]!.phase).toBe("plan");
  });
});

describe("a user-requested stop", () => {
  it("is reported as a decision, not a failure, and still packages what completed", async () => {
    const p = plan(4);
    const controller = new AbortController();
    // Abort after the first file has been staged.
    const { stageFile } = await import("@/lib/transition/stage-opfs");
    vi.mocked(stageFile).mockImplementation(async (opts: { osfFileId: string }) => {
      stageCalls.push(opts.osfFileId);
      if (stageCalls.length >= 2) controller.abort();
      const s = staged.get(opts.osfFileId)!;
      return { handleName: opts.osfFileId, size: s.size, digest: { md5: s.md5, sha256: s.sha256 }, contentType: "application/octet-stream" };
    });

    const result = await run(p, controller.signal);

    expect(result.interrupted?.stoppedByUser).toBe(true);
    expect(result.verdict.counts.verified).toBeGreaterThan(0);
    expect(result.verdict.status).toBe("incomplete");
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
