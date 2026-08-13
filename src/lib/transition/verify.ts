/**
 * The assertions that stop an export reporting success over wrong or incomplete data.
 *
 * This is the most important file in the toolkit. Everything else moves bytes; this
 * decides whether we are allowed to tell a researcher their data arrived. A migration
 * tool that says "verified" when it is not is worse than no tool at all, because it
 * retires the caution that would otherwise have made them check.
 *
 * The governing rule, learned from `src/lib/backup/capture.ts`: completeness is
 * COMPUTED, never inferred from the absence of an error. A 200 is not proof. An empty
 * loop that threw nothing is not proof. Only a positive, checkable statement is proof.
 *
 * Pure and synchronous — no network, no clock, no I/O — so every branch is testable.
 */

/** A half-open byte interval [start, end). */
export type Interval = { start: number; end: number };

export type HashPair = { md5: string | null; sha256: string | null };

export type FileVerificationInput = {
  /** OSF's immutable file id. Binding by id, never by path, is assertion 6. */
  osfFileId: string;
  path: string;
  /** Size OSF declared BEFORE the transfer. */
  declaredSize: number;
  /** Hashes OSF declared. Add-on providers typically supply neither. */
  declared: HashPair;
  /** Byte ranges actually written locally. */
  written: Interval[];
  /** Hashes computed over the bytes actually received. */
  local: HashPair;
  /** md5 the destination reported at commit, if the file was uploaded. */
  remoteMd5?: string | null;
  /** Content-Type of the response body, to catch an error page served with HTTP 200. */
  contentType?: string | null;
  /** True if OSF's metadata changed between planning and completion. */
  changedDuringTransfer?: boolean;
  /**
   * True when this file was uploaded somewhere and a destination checksum is therefore
   * REQUIRED. Distinguishes "local export, nothing to compare against" from "we uploaded
   * it and the destination told us nothing" — which are opposite situations that both
   * present as a null `remoteMd5`.
   *
   * Codex consult 2026-08-13: without this, a Zenodo commit whose checksum failed to
   * parse silently skipped the third comparison and still reported `verified`, on the
   * exact path where that comparison is the whole point.
   */
  destinationExpected?: boolean;
};

export type VerificationState = "verified" | "unverifiable" | "failed";

export type FileVerification = {
  osfFileId: string;
  path: string;
  state: VerificationState;
  /** Every check that ran, and what it concluded. Shown verbatim in the report. */
  checks: { name: string; passed: boolean; detail: string }[];
  /** Why this file is not `verified`, if it is not. */
  problems: string[];
};

/** Bodies that are never research data — an error page delivered with HTTP 200. */
const SUSPECT_CONTENT_TYPES = [/^text\/html/i, /^application\/json/i];

/**
 * Merge and total a set of byte intervals, refusing to paper over gaps or overlaps.
 *
 * A resumed download assembled from misaligned ranges can produce a file of exactly the
 * right LENGTH whose bytes are wrong — duplicated here, missing there. Summing lengths
 * would call that complete. Coverage has to be checked as a set, not a total.
 */
export function coverageProblems(written: Interval[], size: number): string[] {
  const problems: string[] = [];

  // A non-finite size defeats every comparison below: both `cursor < size` and
  // `cursor > size` are false against NaN, so an unknown-length file reported NO
  // coverage problems at all. (Codex consult 2026-08-13; reproduced.)
  if (!Number.isFinite(size) || size < 0) {
    problems.push(`OSF did not report a usable size for this file (got ${size}).`);
    return problems;
  }

  for (const iv of written) {
    if (!Number.isInteger(iv.start) || !Number.isInteger(iv.end) || iv.start < 0 || iv.end < iv.start) {
      problems.push(`Invalid byte range [${iv.start}, ${iv.end}).`);
      return problems;
    }
  }

  if (size === 0) {
    // A zero-byte file is legitimate, but it must have been DECLARED zero and received
    // as zero — not merely have produced no bytes because the transfer never ran.
    const wrote = written.reduce((n, iv) => n + (iv.end - iv.start), 0);
    if (wrote !== 0) problems.push(`Expected an empty file but received ${wrote} bytes.`);
    return problems;
  }

  const sorted = [...written].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const iv of sorted) {
    if (iv.start > cursor) {
      problems.push(`Missing bytes ${cursor}–${iv.start} of ${size}.`);
      return problems;
    }
    if (iv.start < cursor) {
      problems.push(`Overlapping byte ranges near ${iv.start} — the file was assembled twice over.`);
      return problems;
    }
    cursor = iv.end;
  }

  if (cursor < size) problems.push(`Missing bytes ${cursor}–${size} of ${size}.`);
  if (cursor > size) problems.push(`Received ${cursor} bytes but OSF declared ${size}.`);

  return problems;
}

/** md5 is 32 hex chars, sha256 is 64. Anything else is not a checksum. */
const HEX_HASH = /^[0-9a-f]{32}$|^[0-9a-f]{64}$/i;

/**
 * Hash equality that also requires both values to LOOK like hashes.
 *
 * A plain string compare would let two identical non-hashes — whitespace, an error
 * string, a truncated value — satisfy each other. Reachability is low because our own
 * digests always come from hash-wasm, but the cost of the guard is one regex and the
 * cost of being wrong is a file reported as verified against garbage.
 */
function eqHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (!HEX_HASH.test(a) || !HEX_HASH.test(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Verify one file.
 *
 * Three INDEPENDENT comparisons, not one:
 *   local sha256 == OSF sha256   (the strongest link — did we receive what OSF holds?)
 *   local md5    == OSF md5
 *   remote md5   == local md5    (did the destination store what we sent?)
 *
 * The third alone proves nothing about correctness: the destination reports a checksum
 * of what IT stored, so it will happily agree with locally wrong bytes. It is only
 * meaningful on top of the first two.
 *
 * A file OSF gave no hashes for cannot reach `verified`. It becomes `unverifiable` —
 * a distinct state that the report lists by name, never a quiet pass.
 */
export function verifyFile(input: FileVerificationInput): FileVerification {
  const checks: FileVerification["checks"] = [];
  const problems: string[] = [];
  const add = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, passed, detail });
    if (!passed) problems.push(detail);
  };

  // 1. Content sanity — an HTML/JSON body is an error page, whatever the status was.
  if (input.contentType && SUSPECT_CONTENT_TYPES.some((re) => re.test(input.contentType!))) {
    add(
      "content-type",
      false,
      `Received ${input.contentType}, which is an error page rather than file content.`,
    );
  } else {
    add("content-type", true, input.contentType ?? "not recorded");
  }

  // 2. Exact byte coverage — no gaps, no overlaps, exact length.
  const gaps = coverageProblems(input.written, input.declaredSize);
  if (gaps.length > 0) for (const g of gaps) add("byte-coverage", false, g);
  else add("byte-coverage", true, `All ${input.declaredSize} bytes accounted for exactly once.`);

  // 3. The source must not have moved under us.
  if (input.changedDuringTransfer) {
    add("source-stable", false, "The file changed on OSF while it was being transferred.");
  } else {
    add("source-stable", true, "Unchanged on OSF during transfer.");
  }

  // 4. Local vs OSF — the comparison that proves we received the right bytes.
  const haveDeclared = Boolean(input.declared.sha256 || input.declared.md5);
  if (!haveDeclared) {
    add(
      "source-checksum",
      false,
      "OSF supplied no checksum for this file, so what was received cannot be proved to match the original.",
    );
  } else {
    if (input.declared.sha256) {
      const ok = eqHash(input.local.sha256, input.declared.sha256);
      add("sha256", ok, ok ? "Matches the SHA-256 OSF reported." : "SHA-256 does NOT match OSF's.");
    }
    if (input.declared.md5) {
      const ok = eqHash(input.local.md5, input.declared.md5);
      add("md5", ok, ok ? "Matches the MD5 OSF reported." : "MD5 does NOT match OSF's.");
    }
  }

  // 5. Destination vs local — only meaningful once the above passed.
  if (input.destinationExpected && !input.remoteMd5) {
    add(
      "destination-md5",
      false,
      "The destination accepted this file but reported no checksum, so there is no evidence it stored what was sent.",
    );
  } else if (input.remoteMd5 !== undefined && input.remoteMd5 !== null) {
    const ok = eqHash(input.remoteMd5, input.local.md5);
    add(
      "destination-md5",
      ok,
      ok
        ? "The destination stored bytes matching what was sent."
        : "The destination reported a different checksum from what was sent.",
    );
  }

  // A missing source checksum is a KNOWN limit, not a failure — but only if nothing else
  // went wrong. Any real problem outranks it.
  const hardProblems = problems.filter(
    (p) => !p.startsWith("OSF supplied no checksum"),
  );

  let state: VerificationState;
  if (hardProblems.length > 0) state = "failed";
  else if (!haveDeclared) state = "unverifiable";
  else state = "verified";

  return { osfFileId: input.osfFileId, path: input.path, state, checks, problems };
}

// ---------------------------------------------------------------- run reconciliation

export type ReconciliationInput = {
  /** Files the plan said it would transfer, from an independent traversal of OSF. */
  expected: { osfFileId: string; path: string; size: number }[];
  /** What actually happened, one entry per file. */
  results: FileVerification[];
  /** Destination keys observed after the run, when the destination can be listed. */
  destinationKeys?: string[] | null;
};

export type ReconciliationVerdict = {
  /** `complete` is the ONLY value a caller may present as success. */
  status: "complete" | "incomplete" | "empty";
  counts: { expected: number; verified: number; unverifiable: number; failed: number; missing: number; extra: number };
  missing: string[];
  extra: string[];
  failed: { path: string; problems: string[] }[];
  unverifiable: string[];
  /** Plain-English summary, safe to show verbatim. */
  summary: string;
};

/**
 * Decide whether a run succeeded.
 *
 * The empty case is first and deliberate. A run over zero files produces zero failures,
 * and every naive "no errors, therefore fine" check reports success. That is the
 * false green this whole module exists to prevent — an all-clear derived from having
 * looked at nothing.
 */
export function reconcile(input: ReconciliationInput): ReconciliationVerdict {
  const expectedIds = new Set(input.expected.map((f) => f.osfFileId));
  const resultIds = new Set(input.results.map((r) => r.osfFileId));

  const missing = input.expected.filter((f) => !resultIds.has(f.osfFileId)).map((f) => f.path);
  const extra = input.results.filter((r) => !expectedIds.has(r.osfFileId)).map((r) => r.path);

  const verified = input.results.filter((r) => r.state === "verified");
  const unverifiable = input.results.filter((r) => r.state === "unverifiable");
  const failed = input.results.filter((r) => r.state === "failed");

  const counts = {
    expected: input.expected.length,
    verified: verified.length,
    unverifiable: unverifiable.length,
    failed: failed.length,
    missing: missing.length,
    extra: extra.length,
  };

  if (input.expected.length === 0) {
    return {
      status: "empty",
      counts,
      missing,
      extra,
      failed: [],
      unverifiable: [],
      summary:
        "Nothing was transferred: the plan contained no files. This is NOT a successful export — " +
        "check that the right project and content types were selected.",
    };
  }

  // Destination listing, when available, is an independent third opinion: it catches a
  // file we believed we uploaded that never actually landed.
  //
  // It must cover EVERY file we claim to have transferred — `verified` AND
  // `unverifiable` — not just the checksum-verified ones. Checking only `verified` was a
  // real false green: an add-on-storage file (which can never be more than
  // `unverifiable`, because OSF publishes no checksum for it) could vanish between
  // upload and listing and the run would still reconcile as COMPLETE. That is precisely
  // the population most at risk, since those files have no checksum backstop either.
  const transferred = [...verified, ...unverifiable];
  const destinationMissing: string[] = [];
  const collisions: string[] = [];

  if (input.destinationKeys) {
    const keys = new Set(input.destinationKeys);
    for (const r of transferred) {
      if (!keys.has(r.path)) destinationMissing.push(r.path);
    }
  }

  // Two source files mapping to ONE destination key means the second overwrote the
  // first — and both would find their path in the destination listing, so the missing
  // check above cannot see it. Destination keys are unique by construction; source paths
  // are not guaranteed to be, especially once unicode normalisation is involved.
  // (Codex consult 2026-08-13; reproduced.)
  const seenPaths = new Map<string, number>();
  for (const r of transferred) {
    const key = r.path.normalize("NFC");
    seenPaths.set(key, (seenPaths.get(key) ?? 0) + 1);
  }
  for (const [path, count] of seenPaths) {
    if (count > 1) {
      collisions.push(`${path} (${count} source files map to this one destination key)`);
    }
  }

  const complete =
    missing.length === 0 &&
    extra.length === 0 &&
    failed.length === 0 &&
    destinationMissing.length === 0 &&
    collisions.length === 0 &&
    verified.length + unverifiable.length === input.expected.length;

  const allMissing = [...missing, ...destinationMissing];

  return {
    status: complete ? "complete" : "incomplete",
    counts: { ...counts, missing: allMissing.length },
    missing: allMissing,
    extra,
    failed: [
      ...failed.map((f) => ({ path: f.path, problems: f.problems })),
      ...collisions.map((c) => ({
        path: c,
        problems: ["Destination key collision — one of these files overwrote the other."],
      })),
    ],
    unverifiable: unverifiable.map((u) => u.path),
    summary: complete
      ? unverifiable.length > 0
        ? `All ${input.expected.length} files transferred. ${verified.length} were checksum-verified; ` +
          `${unverifiable.length} could not be verified because OSF supplied no checksum for them ` +
          `(usually files in third-party storage). Those are listed individually.`
        : `All ${input.expected.length} files transferred and checksum-verified.`
      : `INCOMPLETE. ${verified.length} of ${input.expected.length} verified; ` +
        `${failed.length} failed, ${allMissing.length} missing, ${extra.length} unexpected. ` +
        `Do not treat this export as a complete copy.`,
  };
}
