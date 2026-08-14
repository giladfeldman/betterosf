/**
 * Resumable-download decision logic, with no I/O so it can be tested exhaustively.
 *
 * Waterbutler supports byte ranges and CORS-exposes `Content-Range`, `Accept-Ranges` and
 * `Content-Length` (verified 2026-08-13 — a ranged GET returns 206). That is what makes a
 * multi-gigabyte download survivable in a browser tab.
 *
 * Downloads are strictly SEQUENTIAL and append-only: a resume asks for exactly one range,
 * `bytes=<already have>-`. That keeps written coverage trivially contiguous — always
 * [0, done) — which removes the entire class of bug where a resumed file is assembled
 * from misaligned or overlapping ranges and ends up the right LENGTH with the wrong
 * bytes. Parallel range fetching would be faster and is not worth that risk.
 */

export type RangeDecision =
  | { action: "complete" }
  | { action: "restart"; reason: string }
  | { action: "resume"; header: string; from: number };

/**
 * What to do given how much is already staged.
 *
 * `staged > expected` means the local file disagrees with OSF — a stale stage from an
 * earlier version of the file, or a bug. Either way it is never safe to "just continue":
 * the only honest move is to throw it away and start again.
 */
export function planRange(staged: number, expected: number): RangeDecision {
  if (!Number.isFinite(staged) || staged < 0) {
    return { action: "restart", reason: "Local staged size is not a valid byte count." };
  }
  if (!Number.isFinite(expected) || expected < 0) {
    return { action: "restart", reason: "OSF did not report a usable file size." };
  }
  if (staged > expected) {
    return {
      action: "restart",
      reason: `Staged copy is larger (${staged} bytes) than OSF reports (${expected}) — it is stale or corrupt.`,
    };
  }
  if (staged === expected) return { action: "complete" };
  return { action: "resume", header: `bytes=${staged}-`, from: staged };
}

export type RangeResponseCheck = { ok: true } | { ok: false; problem: string };

/**
 * Validate the response to a ranged request before writing a single byte.
 *
 * A 200 where a 206 was asked for means the server ignored the range and is sending the
 * WHOLE file. Appending that to a partial stage would silently duplicate the prefix —
 * producing a file that is too long, or (if the length check were sloppy) subtly wrong.
 */
export function checkRangeResponse(args: {
  status: number;
  requestedFrom: number;
  contentRange: string | null;
  expectedTotal: number;
}): RangeResponseCheck {
  const { status, requestedFrom, contentRange, expectedTotal } = args;

  // NOT checked here any more. A suspect content type used to abort the download before a
  // byte was written, on the theory that an HTML body is an error page. Measured
  // 2026-08-14: OSF serves small text-ish files (`.bib`, `.Rmd`, some `.docx`) as
  // `text/html; charset=UTF-8` with their real, complete contents — so this rejected 12 of
  // 79 files in a real export whose bytes were perfect.
  //
  // The judgement now happens in `verifyFile`, AFTER the bytes exist and can be hashed,
  // where a checksum can corroborate or refute the header. That is strictly more
  // information than this function has: here we would be guessing from a string, there we
  // can compare against what OSF published. The caller reads the header off the response
  // and hands it to `verifyFile` itself.

  if (requestedFrom === 0) {
    if (status !== 200 && status !== 206) {
      return { ok: false, problem: `Unexpected status ${status}.` };
    }
    return { ok: true };
  }

  // A resume was requested.
  if (status === 200) {
    return {
      ok: false,
      problem:
        "Server ignored the byte range and sent the whole file. Appending it would duplicate " +
        "what is already staged, so the transfer restarts instead.",
    };
  }
  if (status !== 206) return { ok: false, problem: `Unexpected status ${status} for a range request.` };

  if (contentRange) {
    const parsed = parseContentRange(contentRange);
    if (!parsed) return { ok: false, problem: `Could not parse Content-Range: ${contentRange}` };
    if (parsed.start !== requestedFrom) {
      return {
        ok: false,
        problem: `Server sent bytes from ${parsed.start} but ${requestedFrom} was requested.`,
      };
    }
    if (parsed.total !== null && parsed.total !== expectedTotal) {
      return {
        ok: false,
        problem: `Server reports the file is ${parsed.total} bytes but OSF said ${expectedTotal}. It changed underneath us.`,
      };
    }
  }

  return { ok: true };
}

/** "bytes 200-1000/1001" → { start: 200, end: 1000, total: 1001 } */
export function parseContentRange(
  header: string,
): { start: number; end: number; total: number | null } | null {
  const m = header.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === "*" ? null : Number(m[3]),
  };
}
