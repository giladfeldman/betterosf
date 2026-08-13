// Zenodo deposit client — the pure parts.
//
// Fixtures are verbatim from the sandbox round trip on 2026-08-13, including the exact
// checksum Zenodo returned for a file whose local md5 was independently computed.

import { describe, it, expect } from "vitest";
import {
  encodeFileKey,
  parseChecksum,
  parseDeclaredFile,
  partsExpired,
  planCapacity,
  MULTIPART_THRESHOLD_BYTES,
  ZENODO_MAX_FILES_PER_RECORD,
} from "@/lib/transition/targets/zenodo";

describe("encodeFileKey", () => {
  it("keeps slashes so the deposit preserves OSF folder structure", () => {
    // Verified live: `sub/dir/nested.txt` round-tripped to status "completed".
    expect(encodeFileKey("sub/dir/nested.txt")).toBe("sub/dir/nested.txt");
  });

  it("encodes spaces and other characters within a segment", () => {
    expect(encodeFileKey("Wiki images/a b.png")).toBe("Wiki%20images/a%20b.png");
  });

  it("encodes a literal ? and # that would otherwise truncate the path", () => {
    expect(encodeFileKey("odd/name?q#1.csv")).toBe("odd/name%3Fq%231.csv");
  });

  it("leaves a plain key untouched", () => {
    expect(encodeFileKey("flat.txt")).toBe("flat.txt");
  });
});

describe("parseChecksum", () => {
  it("strips Zenodo's md5: prefix", () => {
    // Exactly what the sandbox returned for the probe file.
    expect(parseChecksum("md5:3833d18ed830b621388834f87be21458")).toBe(
      "3833d18ed830b621388834f87be21458",
    );
  });

  it("lower-cases so comparison is stable", () => {
    expect(parseChecksum("md5:3833D18ED830B621388834F87BE21458")).toBe(
      "3833d18ed830b621388834f87be21458",
    );
  });

  it("returns null rather than a bogus value for anything unexpected", () => {
    // Returning the raw string would make the verifier compare apples to oranges and
    // report a mismatch on a file that was fine — or worse, match on nonsense.
    expect(parseChecksum("sha256:abc")).toBeNull();
    expect(parseChecksum("md5:tooshort")).toBeNull();
    expect(parseChecksum(undefined)).toBeNull();
    expect(parseChecksum(null)).toBeNull();
    expect(parseChecksum(12345)).toBeNull();
  });
});

describe("parseDeclaredFile", () => {
  it("reads a single-stream entry", () => {
    // Verbatim sandbox response for a small file.
    const f = parseDeclaredFile({
      key: "flat.txt",
      transfer: { type: "L" },
      links: {
        content: "https://sandbox.zenodo.org/api/records/1/draft/files/flat.txt/content",
        commit: "https://sandbox.zenodo.org/api/records/1/draft/files/flat.txt/commit",
      },
    });
    expect(f.transferType).toBe("L");
    expect(f.contentUrl).toContain("/content");
  });

  it("reads a multipart entry with its part URLs", () => {
    // Verbatim: multipart IS live on Zenodo, with per-part URLs and expirations.
    const f = parseDeclaredFile({
      key: "multi.bin",
      transfer: { type: "M" },
      links: {
        commit: "https://sandbox.zenodo.org/api/records/1/draft/files/multi.bin/commit",
        parts: [
          { part: 1, url: "https://sandbox.zenodo.org/.../content/1", expiration: "2026-08-27T07:01:00.454665+00:00" },
          { part: 2, url: "https://sandbox.zenodo.org/.../content/2", expiration: "2026-08-27T07:01:00.454701+00:00" },
        ],
      },
    });
    expect(f.transferType).toBe("M");
    expect(f.parts).toHaveLength(2);
  });

  it("defaults to single-stream when the transfer type is absent", () => {
    expect(parseDeclaredFile({ key: "x" }).transferType).toBe("L");
  });
});

describe("partsExpired", () => {
  const file = {
    key: "multi.bin",
    transferType: "M" as const,
    commitUrl: "",
    parts: [
      { part: 1, url: "u1", expiration: "2026-08-27T07:01:00.000Z" },
      { part: 2, url: "u2", expiration: "2026-08-27T07:01:00.000Z" },
    ],
  };

  it("is false well before the 14-day expiry", () => {
    expect(partsExpired(file, new Date("2026-08-20T00:00:00Z"))).toBe(false);
  });

  it("is true once the expiry has passed — a resumed run must re-declare", () => {
    expect(partsExpired(file, new Date("2026-08-28T00:00:00Z"))).toBe(true);
  });

  it("is true exactly at the expiry instant, not one moment later", () => {
    expect(partsExpired(file, new Date("2026-08-27T07:01:00.000Z"))).toBe(true);
  });

  it("is false for a single-stream file, which has no parts", () => {
    expect(partsExpired({ key: "f", transferType: "L", commitUrl: "" }, new Date())).toBe(false);
  });

  it("ignores an unparseable expiration rather than declaring everything dead", () => {
    const bad = { ...file, parts: [{ part: 1, url: "u", expiration: "soon" }] };
    expect(partsExpired(bad, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("planCapacity", () => {
  it("fits a small deposit in one record", () => {
    const p = planCapacity([{ size: 100 }, { size: 200 }]);
    expect(p).toEqual({ fits: true, files: 2, bytes: 300 });
  });

  it("fits exactly at the file limit", () => {
    expect(planCapacity(Array(ZENODO_MAX_FILES_PER_RECORD).fill({ size: 1 })).fits).toBe(true);
  });

  it("does not fit one file over the limit, and says what will happen", () => {
    const p = planCapacity(Array(ZENODO_MAX_FILES_PER_RECORD + 1).fill({ size: 1 }));
    expect(p.fits).toBe(false);
    expect((p as { reason: string }).reason).toMatch(/packaged into archives/i);
  });

  it("does not fit above the byte ceiling, and says how many records are needed", () => {
    const p = planCapacity([{ size: 60 * 1024 ** 3 }]);
    expect(p.fits).toBe(false);
    expect((p as { recordsNeeded: number }).recordsNeeded).toBe(2);
  });

  it("handles an empty list without claiming success over nothing", () => {
    // reconcile() is what refuses an empty run; this simply reports the arithmetic.
    expect(planCapacity([])).toEqual({ fits: true, files: 0, bytes: 0 });
  });
});

describe("multipart threshold", () => {
  it("is 100 MB — small enough that retries stay cheap, large enough to avoid churn", () => {
    expect(MULTIPART_THRESHOLD_BYTES).toBe(100 * 1024 * 1024);
  });
});
