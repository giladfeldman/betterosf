// Splitting a deposit across Zenodo's per-record caps.
//
// The failure this guards is quiet: a shard planner that drops a file, or silently packs
// one past a limit, produces a deposit that LOOKS complete and is missing data. Every test
// here is a way a file could go missing between the plan and the records.

import { describe, it, expect } from "vitest";
import {
  planShards,
  shardRelatedIdentifiers,
  ZENODO_MAX_FILES_PER_RECORD,
} from "@/lib/transition/targets/zenodo";
import { shardMetadata, osfStillDescribesItTheSameWay } from "@/lib/transition/run-transfer";

const file = (path: string, size: number) => ({ path, size });

describe("planShards", () => {
  it("keeps everything in one record when it fits", () => {
    const files = [file("a.csv", 10), file("b.csv", 20)];
    const plan = planShards(files, { maxFiles: 100, maxBytes: 1000 });
    expect(plan.shards).toHaveLength(1);
    expect(plan.shards[0]).toHaveLength(2);
    expect(plan.unplaceable).toEqual([]);
  });

  it("splits on the file-count cap without losing a file", () => {
    const files = Array.from({ length: 250 }, (_, i) => file(`f${i}.csv`, 1));
    const plan = planShards(files, { maxFiles: 100, maxBytes: 1_000_000 });

    expect(plan.shards.map((s) => s.length)).toEqual([100, 100, 50]);
    // The property that actually matters: every input file appears exactly once.
    const seen = plan.shards.flat().map((f) => f.path);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it("splits on the byte cap", () => {
    const files = [file("a", 60), file("b", 60), file("c", 10)];
    const plan = planShards(files, { maxFiles: 100, maxBytes: 100 });
    expect(plan.shards).toHaveLength(2);
    expect(plan.shards[0]!.map((f) => f.path)).toEqual(["a"]);
    expect(plan.shards[1]!.map((f) => f.path)).toEqual(["b", "c"]);
  });

  it("preserves input order, so folders stay together across the split", () => {
    const files = [
      file("osfstorage/data/1.csv", 10),
      file("osfstorage/data/2.csv", 10),
      file("osfstorage/docs/a.md", 10),
    ];
    const plan = planShards(files, { maxFiles: 2, maxBytes: 1000 });
    expect(plan.shards[0]!.map((f) => f.path)).toEqual([
      "osfstorage/data/1.csv",
      "osfstorage/data/2.csv",
    ]);
    expect(plan.shards[1]!.map((f) => f.path)).toEqual(["osfstorage/docs/a.md"]);
  });

  it("reports a file too large for ANY record instead of packing it anyway", () => {
    const plan = planShards([file("huge.bin", 200), file("ok.csv", 5)], {
      maxFiles: 100,
      maxBytes: 100,
    });
    expect(plan.shards.flat().map((f) => f.path)).toEqual(["ok.csv"]);
    expect(plan.unplaceable).toHaveLength(1);
    expect(plan.unplaceable[0]!.file.path).toBe("huge.bin");
    expect(plan.unplaceable[0]!.reason).toMatch(/larger than/i);
  });

  it("treats an unknown size as unplaceable rather than assuming it fits", () => {
    // An unknown is never allowed to read as a fact. NaN would otherwise sail through
    // every comparison below (NaN > x and NaN + y > z are both false) and be packed.
    const plan = planShards([file("mystery.bin", Number.NaN), file("ok.csv", 5)], {
      maxFiles: 100,
      maxBytes: 100,
    });
    expect(plan.shards.flat().map((f) => f.path)).toEqual(["ok.csv"]);
    expect(plan.unplaceable[0]!.file.path).toBe("mystery.bin");
    expect(plan.unplaceable[0]!.reason).toMatch(/no usable size/i);
  });

  it("produces no empty shards", () => {
    const plan = planShards([], { maxFiles: 10, maxBytes: 100 });
    expect(plan.shards).toEqual([]);
  });

  it("defaults to Zenodo's real caps", () => {
    const files = Array.from({ length: ZENODO_MAX_FILES_PER_RECORD + 1 }, (_, i) => file(`f${i}`, 1));
    expect(planShards(files).shards).toHaveLength(2);
  });
});

describe("shardRelatedIdentifiers", () => {
  it("emits nothing for a single record", () => {
    expect(shardRelatedIdentifiers(["https://zenodo.org/records/1"], 0)).toEqual([]);
  });

  it("links every sibling and never itself", () => {
    const urls = ["https://zenodo.org/records/1", "https://zenodo.org/records/2", "https://zenodo.org/records/3"];
    const links = shardRelatedIdentifiers(urls, 1);
    expect(links.map((l) => l.identifier)).toEqual([urls[0], urls[2]]);
    expect(links.every((l) => l.relation_type.id === "ispartof")).toBe(true);
  });
});

describe("shardMetadata", () => {
  const base = {
    title: "My project",
    publication_date: "2026-01-01",
    resource_type: { id: "dataset" },
    creators: [],
  };

  it("leaves a single-record title alone", () => {
    expect(shardMetadata(base, 0, 1).title).toBe("My project");
  });

  it("numbers the parts so a record found alone says what it is", () => {
    expect(shardMetadata(base, 0, 3).title).toBe("My project (part 1 of 3)");
    expect(shardMetadata(base, 2, 3).title).toBe("My project (part 3 of 3)");
  });
});

describe("osfStillDescribesItTheSameWay", () => {
  const A = { md5: "a".repeat(32), sha256: "a".repeat(64) };
  const B = { md5: "b".repeat(32), sha256: "b".repeat(64) };
  const prior = (md5: string | null, sha256: string | null) => ({ localMd5: md5, localSha256: sha256 });

  it("accepts a file OSF still describes with the same hashes", () => {
    expect(osfStillDescribesItTheSameWay(A, prior(A.md5, A.sha256))).toBe(true);
  });

  it("is case-insensitive, because hex casing is not a change", () => {
    expect(
      osfStillDescribesItTheSameWay({ md5: A.md5.toUpperCase(), sha256: null }, prior(A.md5, null)),
    ).toBe(true);
  });

  it("REJECTS a file whose OSF checksum moved — the stale-resume defect", () => {
    expect(osfStillDescribesItTheSameWay(B, prior(A.md5, A.sha256))).toBe(false);
  });

  it("requires EVERY checksum OSF publishes to match, not just one", () => {
    // A resume that accepted "one of them matches" would skip a file whose sha256 moved
    // while its md5 happened to be recorded from an older run.
    expect(osfStillDescribesItTheSameWay({ md5: A.md5, sha256: B.sha256 }, prior(A.md5, A.sha256))).toBe(false);
  });

  it("refuses when OSF publishes no checksum at all", () => {
    // Add-on storage. With nothing to compare, "unchanged" cannot be established — so the
    // file is re-downloaded and re-checked rather than assumed current.
    expect(osfStillDescribesItTheSameWay({ md5: null, sha256: null }, prior(A.md5, A.sha256))).toBe(false);
  });

  it("refuses when we recorded no local hash last time", () => {
    expect(osfStillDescribesItTheSameWay(A, prior(null, null))).toBe(false);
  });
});
