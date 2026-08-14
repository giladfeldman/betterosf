// The false-green suite.
//
// Every test here is an attempt to make the verifier say "verified" over data that is
// wrong, incomplete, or absent. If any of them passes, a researcher can be told their
// irreplaceable data arrived safely when it did not — and will act on that.
//
// The attacks are the ones Codex enumerated on 2026-08-13 plus the empty-input case that
// the portfolio rules call out by name: "A green result from an empty input is a false
// green."

import { describe, it, expect } from "vitest";
import { verifyFile, reconcile, coverageProblems, type FileVerificationInput } from "@/lib/transition/verify";

const MD5 = "3833d18ed830b621388834f87be21458";
const SHA = "c9404035aac5ab4e10ab27baa98b69843d85909fd7e3e6623304a380f70e9604";

function input(over: Partial<FileVerificationInput> = {}): FileVerificationInput {
  return {
    osfFileId: "f1",
    path: "data/x.csv",
    declaredSize: 100,
    declared: { md5: MD5, sha256: SHA },
    written: [{ start: 0, end: 100 }],
    local: { md5: MD5, sha256: SHA },
    remoteMd5: MD5,
    contentType: "text/csv",
    ...over,
  };
}

describe("a checksum outranks a mislabelled content type", () => {
  it("verifies real content OSF served as text/html", () => {
    // Measured 2026-08-14: Waterbutler returns small text-ish files (.bib, .Rmd, several
    // .docx) as `text/html; charset=UTF-8` with their real, complete bytes. Rejecting on
    // the header alone failed 12 of 79 files in a real export whose data was perfect.
    //
    // A content type is the SERVER'S CLAIM ABOUT the bytes; a checksum is a statement
    // about the bytes themselves. When OSF's own published hash matches what arrived, the
    // content is provably right and the header is provably wrong.
    const r = verifyFile(input({ contentType: "text/html; charset=UTF-8" }));
    expect(r.state).toBe("verified");
    expect(r.checks.find((c) => c.name === "content-type")?.detail).toMatch(
      /bytes match the checksum/i,
    );
  });

  it("still records what the server actually said, rather than hiding it", () => {
    const r = verifyFile(input({ contentType: "text/html; charset=UTF-8" }));
    expect(r.checks.find((c) => c.name === "content-type")?.detail).toContain("text/html");
  });
});

describe("the happy path is genuinely reachable", () => {
  it("verifies a file whose three comparisons all agree", () => {
    const r = verifyFile(input());
    expect(r.state).toBe("verified");
    expect(r.problems).toEqual([]);
  });
});

describe("false greens that must NOT verify", () => {
  it("an error page served with HTTP 200, when OSF published no checksum", () => {
    // OSF's links.download drops auth across its redirect and returns a 263-byte Forbidden
    // page. For add-on storage (Dropbox, Drive, S3, GitHub) OSF publishes no checksum, so
    // the content type is the ONLY signal there is — and it stays fatal.
    const r = verifyFile(
      input({
        contentType: "text/html; charset=utf-8",
        declared: { md5: null, sha256: null },
      }),
    );
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/error page/i);
  });

  it("a JSON error body served with HTTP 200, when OSF published no checksum", () => {
    expect(
      verifyFile(input({ contentType: "application/json", declared: { md5: null, sha256: null } }))
        .state,
    ).toBe("failed");
  });

  it("an error page whose bytes do NOT match the checksum OSF published", () => {
    // The realistic shape of the original attack: a Forbidden page cannot hash to the
    // value OSF holds for the real file, so the checksum catches it regardless.
    const r = verifyFile(
      input({ contentType: "text/html; charset=utf-8", local: { md5: "a".repeat(32), sha256: "b".repeat(64) } }),
    );
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/does NOT match/i);
  });

  it("a resumed download with a GAP", () => {
    const r = verifyFile(input({ written: [{ start: 0, end: 40 }, { start: 60, end: 100 }] }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/Missing bytes 40–60/);
  });

  it("a resumed download with OVERLAPPING ranges", () => {
    // Right total length, wrong bytes. Summing lengths would call this complete.
    const r = verifyFile(input({ written: [{ start: 0, end: 60 }, { start: 40, end: 100 }] }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/Overlapping/i);
  });

  it("a truncated file", () => {
    expect(verifyFile(input({ written: [{ start: 0, end: 99 }] })).state).toBe("failed");
  });

  it("more bytes than OSF declared", () => {
    const r = verifyFile(input({ written: [{ start: 0, end: 120 }] }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/declared 100/);
  });

  it("a local hash that disagrees with OSF", () => {
    const r = verifyFile(input({ local: { md5: MD5, sha256: "0".repeat(64) } }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/SHA-256 does NOT match/);
  });

  it("a destination checksum that disagrees with what we sent", () => {
    const r = verifyFile(input({ remoteMd5: "f".repeat(32) }));
    expect(r.state).toBe("failed");
    expect(r.problems.join(" ")).toMatch(/different checksum/i);
  });

  it("a file that changed on OSF mid-transfer", () => {
    const r = verifyFile(input({ changedDuringTransfer: true }));
    expect(r.state).toBe("failed");
  });

  it("a destination checksum agreeing with locally WRONG bytes", () => {
    // The destination reports what IT stored, so it agrees with whatever we sent — even
    // if what we sent was never what OSF held. This is why the third comparison alone
    // proves nothing, and why the OSF comparison is mandatory.
    const wrong = "a".repeat(32);
    const r = verifyFile(input({ local: { md5: wrong, sha256: null }, remoteMd5: wrong }));
    expect(r.state).toBe("failed");
  });
});

describe("files OSF cannot vouch for", () => {
  it("are unverifiable, never verified", () => {
    // Add-on storage (Dropbox, Drive, S3) supplies no checksum.
    const r = verifyFile(input({ declared: { md5: null, sha256: null } }));
    expect(r.state).toBe("unverifiable");
  });

  it("still FAIL when something else is also wrong", () => {
    // "Unverifiable" must never become a soft landing that hides a real defect.
    const r = verifyFile(
      input({ declared: { md5: null, sha256: null }, written: [{ start: 0, end: 50 }] }),
    );
    expect(r.state).toBe("failed");
  });

  it("verify on a single hash when OSF supplies only one", () => {
    expect(verifyFile(input({ declared: { md5: MD5, sha256: null } })).state).toBe("verified");
  });
});

describe("zero-byte files", () => {
  it("verify when declared empty and received empty", () => {
    const r = verifyFile(
      input({ declaredSize: 0, written: [], declared: { md5: MD5, sha256: SHA } }),
    );
    expect(r.state).toBe("verified");
  });

  it("fail when declared empty but bytes arrived", () => {
    const r = verifyFile(input({ declaredSize: 0, written: [{ start: 0, end: 5 }] }));
    expect(r.state).toBe("failed");
  });

  it("fail when declared non-empty but nothing arrived", () => {
    // The commonest shape of a silent failure: the loop ran, nothing was written, and
    // nothing threw.
    expect(verifyFile(input({ written: [] })).state).toBe("failed");
  });
});

describe("coverageProblems", () => {
  it("accepts contiguous out-of-order ranges", () => {
    expect(
      coverageProblems([{ start: 50, end: 100 }, { start: 0, end: 50 }], 100),
    ).toEqual([]);
  });

  it("rejects a negative or inverted range", () => {
    expect(coverageProblems([{ start: 10, end: 5 }], 100).length).toBeGreaterThan(0);
    expect(coverageProblems([{ start: -1, end: 100 }], 100).length).toBeGreaterThan(0);
  });

  it("rejects NaN bounds rather than treating them as zero", () => {
    expect(coverageProblems([{ start: 0, end: NaN }], 100).length).toBeGreaterThan(0);
  });
});

describe("reconcile — the run-level verdict", () => {
  const ok = (id: string, path: string) => ({
    osfFileId: id,
    path,
    state: "verified" as const,
    checks: [],
    problems: [],
  });

  it("reports EMPTY, never complete, for a plan with no files", () => {
    // The false green the portfolio rules name explicitly: an all-clear derived from
    // having looked at nothing.
    const v = reconcile({ expected: [], results: [] });
    expect(v.status).toBe("empty");
    expect(v.summary).toMatch(/NOT a successful export/i);
  });

  it("is complete when every expected file verified", () => {
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 1 }],
      results: [ok("a", "a.csv")],
    });
    expect(v.status).toBe("complete");
  });

  it("is INCOMPLETE when a file is missing from the results", () => {
    const v = reconcile({
      expected: [
        { osfFileId: "a", path: "a.csv", size: 1 },
        { osfFileId: "b", path: "b.csv", size: 1 },
      ],
      results: [ok("a", "a.csv")],
    });
    expect(v.status).toBe("incomplete");
    expect(v.missing).toEqual(["b.csv"]);
    expect(v.summary).toMatch(/Do not treat this export as a complete copy/i);
  });

  it("is INCOMPLETE when a file failed", () => {
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 1 }],
      results: [{ osfFileId: "a", path: "a.csv", state: "failed", checks: [], problems: ["bad"] }],
    });
    expect(v.status).toBe("incomplete");
    expect(v.failed[0]!.problems).toEqual(["bad"]);
  });

  it("flags an unexpected extra file rather than ignoring it", () => {
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 1 }],
      results: [ok("a", "a.csv"), ok("z", "z.csv")],
    });
    expect(v.status).toBe("incomplete");
    expect(v.extra).toEqual(["z.csv"]);
  });

  it("is complete WITH unverifiable files, and names them", () => {
    const v = reconcile({
      expected: [
        { osfFileId: "a", path: "a.csv", size: 1 },
        { osfFileId: "b", path: "b.csv", size: 1 },
      ],
      results: [
        ok("a", "a.csv"),
        { osfFileId: "b", path: "b.csv", state: "unverifiable", checks: [], problems: [] },
      ],
    });
    expect(v.status).toBe("complete");
    expect(v.unverifiable).toEqual(["b.csv"]);
    expect(v.summary).toMatch(/could not be verified/i);
  });

  it("catches a file we believed we uploaded that never landed", () => {
    // Independent third opinion: the destination's own listing.
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 1 }],
      results: [ok("a", "a.csv")],
      destinationKeys: [],
    });
    expect(v.status).toBe("incomplete");
    expect(v.missing).toEqual(["a.csv"]);
  });

  it("catches an UNVERIFIABLE file that never landed at the destination", () => {
    // Regression, betterosf-review 2026-08-13. The destination cross-check originally
    // looked only at `verified` results, so an add-on-storage file — which can never be
    // more than `unverifiable`, because OSF publishes no checksum for it — could vanish
    // between upload and listing and the run still reconciled as COMPLETE.
    // That is the worst population to miss: those files have no checksum backstop either,
    // so the destination listing is the ONLY evidence they arrived.
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "dropbox/a.csv", size: 1 }],
      results: [
        { osfFileId: "a", path: "dropbox/a.csv", state: "unverifiable", checks: [], problems: [] },
      ],
      destinationKeys: [],
    });
    expect(v.status).toBe("incomplete");
    expect(v.missing).toEqual(["dropbox/a.csv"]);
  });

  it("is complete when the destination confirms an unverifiable file DID land", () => {
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "dropbox/a.csv", size: 1 }],
      results: [
        { osfFileId: "a", path: "dropbox/a.csv", state: "unverifiable", checks: [], problems: [] },
      ],
      destinationKeys: ["dropbox/a.csv"],
    });
    expect(v.status).toBe("complete");
  });

  it("is complete when the destination listing confirms every file", () => {
    const v = reconcile({
      expected: [{ osfFileId: "a", path: "a.csv", size: 1 }],
      results: [ok("a", "a.csv")],
      destinationKeys: ["a.csv"],
    });
    expect(v.status).toBe("complete");
  });
});

describe("codex-consult 2026-08-13 — reproduced false greens", () => {
  const ok = (id: string, path: string, state: "verified" | "unverifiable" = "verified") => ({
    osfFileId: id,
    path,
    state,
    checks: [],
    problems: [],
  });

  it("a NaN declared size must not sail through the coverage check", () => {
    // Both `cursor < size` and `cursor > size` are false against NaN, so the original
    // coverage check reported no problems for a file of unknown length.
    expect(coverageProblems([{ start: 0, end: 100 }], NaN).length).toBeGreaterThan(0);
    expect(verifyFile(input({ declaredSize: NaN })).state).toBe("failed");
  });

  it("a fractional byte interval is not a valid coverage claim", () => {
    expect(coverageProblems([{ start: 0, end: 99.5 }], 100).length).toBeGreaterThan(0);
  });

  it("a non-hex 'hash' must never satisfy a comparison, even against itself", () => {
    // eqHash compared strings. Two identical whitespace or garbage values matched.
    const junk = "   ";
    expect(verifyFile(input({ declared: { md5: junk, sha256: null }, local: { md5: junk, sha256: null } })).state)
      .not.toBe("verified");
    const notHex = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    expect(verifyFile(input({ declared: { md5: notHex, sha256: null }, local: { md5: notHex, sha256: null } })).state)
      .not.toBe("verified");
  });

  it("two files landing on the SAME destination key is a collision, not a pass", () => {
    // Zenodo keys are unique: if two OSF files map to one key, the second overwrote the
    // first. Both would find their path in the destination listing and reconcile clean.
    const v = reconcile({
      expected: [
        { osfFileId: "a", path: "data/x.csv", size: 1 },
        { osfFileId: "b", path: "data/x.csv", size: 1 },
      ],
      results: [ok("a", "data/x.csv"), ok("b", "data/x.csv")],
      destinationKeys: ["data/x.csv"],
    });
    expect(v.status).toBe("incomplete");
  });

  it("a duplicated result must not satisfy the count for a different file", () => {
    const v = reconcile({
      expected: [
        { osfFileId: "a", path: "a.csv", size: 1 },
        { osfFileId: "b", path: "b.csv", size: 1 },
      ],
      results: [ok("a", "a.csv"), ok("a", "a.csv")],
    });
    expect(v.status).toBe("incomplete");
  });

  it("a transfer whose destination returned NO checksum is not verified", () => {
    // parseChecksum returns null when Zenodo's format is unrecognised. Passing that
    // through as "no destination to check" silently skipped the third comparison on the
    // exact path where it matters most.
    const r = verifyFile(input({ remoteMd5: null, destinationExpected: true }));
    expect(r.state).toBe("failed");
  });

  it("a local export with no destination at all is still verifiable", () => {
    const r = verifyFile(input({ remoteMd5: undefined, destinationExpected: false }));
    expect(r.state).toBe("verified");
  });
});

/**
 * Blockers: checks that did not RUN, as opposed to checks that failed.
 *
 * Added 2026-08-13 after a Codex review found that a destination listing which could not
 * be fetched left `destinationKeys` null — an honest "no third opinion" that nonetheless
 * let every other condition pass and reported COMPLETE.
 */
describe("reconcile — blockers", () => {
  const oneVerifiedFile = {
    expected: [{ osfFileId: "f1", path: "a.csv", size: 3 }],
    results: [
      { osfFileId: "f1", path: "a.csv", state: "verified" as const, checks: [], problems: [] },
    ],
  };

  it("is complete with no blockers", () => {
    expect(reconcile({ ...oneVerifiedFile, destinationKeys: ["a.csv"] }).status).toBe("complete");
  });

  it("refuses complete when a check could not be run, however good the counts are", () => {
    const verdict = reconcile({
      ...oneVerifiedFile,
      destinationKeys: null,
      blockers: ["Could not read what Zenodo holds for record 555."],
    });
    expect(verdict.status).toBe("incomplete");
    expect(verdict.counts.verified).toBe(1);
    expect(verdict.counts.failed).toBe(0);
    expect(verdict.blockers).toHaveLength(1);
  });

  it("names the blocker in the summary, so the reason is never only in a field", () => {
    const verdict = reconcile({
      ...oneVerifiedFile,
      blockers: ["Could not read what Zenodo holds for record 555."],
    });
    expect(verdict.summary).toContain("could not be run");
    expect(verdict.summary).toContain("record 555");
  });

  it("carries blockers through the empty verdict too", () => {
    const verdict = reconcile({ expected: [], results: [], blockers: ["listing failed"] });
    expect(verdict.status).toBe("empty");
    expect(verdict.blockers).toEqual(["listing failed"]);
  });

  it("defaults to no blockers, so existing callers are unaffected", () => {
    expect(reconcile(oneVerifiedFile).blockers).toEqual([]);
  });
});
