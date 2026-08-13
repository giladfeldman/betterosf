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
