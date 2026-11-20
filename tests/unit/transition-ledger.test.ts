// Merging a run's local ledger with the server's checkpoint.
//
// The failure mode is asymmetric: preferring the server would discard a resumed device's
// fresher evidence, and preferring the browser would discard everything a cross-device
// resume needs. Neither side is authoritative — the row that says MORE wins.

import { describe, it, expect } from "vitest";
import { mergeItems } from "@/lib/transition/ledger";
import type { TransferItemSnapshot } from "@/lib/transition/run-transfer";

const item = (over: Partial<TransferItemSnapshot>): TransferItemSnapshot => ({
  osfFileId: "f1",
  path: "osfstorage/a.csv",
  size: 3,
  state: "verified",
  localSha256: "a".repeat(64),
  localMd5: "a".repeat(32),
  remoteMd5: "a".repeat(32),
  shardIndex: 0,
  problems: [],
  ...over,
});

describe("mergeItems", () => {
  it("keeps rows that exist on only one side", () => {
    const merged = mergeItems([item({ osfFileId: "local" })], [item({ osfFileId: "remote" })]);
    expect(merged.map((i) => i.osfFileId).sort()).toEqual(["local", "remote"]);
  });

  it("prefers the row carrying a destination checksum", () => {
    const merged = mergeItems(
      [item({ remoteMd5: null, state: "failed" })],
      [item({ remoteMd5: "b".repeat(32) })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.remoteMd5).toBe("b".repeat(32));
  });

  it("prefers the local row when both say the same amount", () => {
    // A tie goes to the browser: it is where the run actually is, and the server copy is
    // by construction a checkpoint of some earlier moment.
    const merged = mergeItems([item({ localMd5: "local" })], [item({ localMd5: "remote" })]);
    expect(merged[0]!.localMd5).toBe("local");
  });

  it("does not resurrect a failure over a later success", () => {
    const merged = mergeItems(
      [item({ state: "verified", remoteMd5: "c".repeat(32) })],
      [item({ state: "failed", remoteMd5: "c".repeat(32) })],
    );
    expect(merged[0]!.state).toBe("verified");
  });

  it("handles both sides being empty", () => {
    expect(mergeItems([], [])).toEqual([]);
  });
});

// d-94be77 (unknown-is-not-zero): an unreadable checkpoint is NOT "no prior items". Reading
// it as empty makes a resumed run re-upload files already on the draft.
import { vi, afterEach } from "vitest";
import { createBrowserLedger } from "@/lib/transition/ledger";

describe("createBrowserLedger.loadItems — a failed read is not an empty ledger", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects when the server checkpoint answers non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(createBrowserLedger().loadItems("job-1")).rejects.toThrow(/could not be read/i);
  });

  it("rejects when the server checkpoint cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(createBrowserLedger().loadItems("job-1")).rejects.toThrow(/could not be read/i);
  });

  it("still returns the server's items when the read succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [item({ osfFileId: "f9" })] })),
    );
    const items = await createBrowserLedger().loadItems("job-1");
    expect(items.map((i) => i.osfFileId)).toEqual(["f9"]);
  });
});

// Cross-model review 2026-11-19: the server answers 404 when its first checkpoint POST
// failed (saveJob tolerates that). With this browser's copy readable, that is a definite
// "no server rows", not an unknown: rejecting blocked every resume of such a run for good.
// Without IndexedDB nothing is known about prior uploads, so a 404 must still reject.
import { listLocalJobs, getLocalJob } from "@/lib/transition/ledger";

function fakeIndexedDb(rows: TransferItemSnapshot[]) {
  const request = <T,>(result: T) => {
    const req: { result: T; onsuccess: null | (() => void); onerror: null | (() => void) } = {
      result,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  };
  const db = {
    close() {},
    transaction: () => ({
      objectStore: () => ({ index: () => ({ getAll: () => request(rows) }) }),
    }),
  };
  return { open: () => request(db) };
}

describe("createBrowserLedger.loadItems — a server 404 is 'no server rows', not unreadable", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns this browser's items when the server has no record of the run", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb([item({ osfFileId: "local-1" })]));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "No such run." }, { status: 404 })));
    const items = await createBrowserLedger().loadItems("job-1");
    expect(items.map((i) => i.osfFileId)).toEqual(["local-1"]);
  });

  it("still rejects a 404 when this browser has no local copy to fall back on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "No such run." }, { status: 404 })));
    await expect(createBrowserLedger().loadItems("job-1")).rejects.toThrow(/could not be read/i);
  });
});

describe("local job reads without IndexedDB — nothing can have been saved", () => {
  it("lists no jobs and finds none, instead of failing the read", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(listLocalJobs()).resolves.toEqual([]);
    await expect(getLocalJob("job-1")).resolves.toBeNull();
  });
});
