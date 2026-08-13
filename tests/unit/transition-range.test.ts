// Resume decisions and range-response validation.
//
// The failure these guard against is the nastiest kind: a resumed download that produces
// a file of plausible length whose bytes are wrong. Nothing throws, nothing looks broken,
// and both checksums would then be computed over the corrupted result.

import { describe, it, expect } from "vitest";
import { planRange, checkRangeResponse, parseContentRange } from "@/lib/transition/range";

describe("planRange", () => {
  it("starts from zero for a fresh file", () => {
    expect(planRange(0, 100)).toEqual({ action: "resume", header: "bytes=0-", from: 0 });
  });

  it("resumes from exactly what is already staged", () => {
    expect(planRange(40, 100)).toEqual({ action: "resume", header: "bytes=40-", from: 40 });
  });

  it("is complete when the stage already matches the expected size", () => {
    expect(planRange(100, 100)).toEqual({ action: "complete" });
  });

  it("RESTARTS rather than continuing when the stage is bigger than the source", () => {
    // A stale stage from an earlier version of the file. Continuing would append to
    // bytes that no longer belong to this file at all.
    const d = planRange(120, 100);
    expect(d.action).toBe("restart");
    expect((d as { reason: string }).reason).toMatch(/stale or corrupt/i);
  });

  it("restarts on a nonsensical staged size instead of computing a negative range", () => {
    expect(planRange(-1, 100).action).toBe("restart");
    expect(planRange(NaN, 100).action).toBe("restart");
  });

  it("restarts when OSF gave no usable size", () => {
    expect(planRange(0, NaN).action).toBe("restart");
  });

  it("handles a zero-byte file as already complete", () => {
    expect(planRange(0, 0)).toEqual({ action: "complete" });
  });
});

describe("checkRangeResponse", () => {
  const base = {
    status: 206,
    requestedFrom: 40,
    contentType: "application/octet-stream",
    contentRange: "bytes 40-99/100",
    expectedTotal: 100,
  };

  it("accepts a well-formed partial response", () => {
    expect(checkRangeResponse(base)).toEqual({ ok: true });
  });

  it("REJECTS a 200 when a resume was requested", () => {
    // The server ignored the range and is sending the whole file. Appending it would
    // duplicate the prefix already on disk.
    const r = checkRangeResponse({ ...base, status: 200 });
    expect(r.ok).toBe(false);
    expect((r as { problem: string }).problem).toMatch(/ignored the byte range/i);
  });

  it("accepts a 200 when the request started at zero", () => {
    expect(checkRangeResponse({ ...base, status: 200, requestedFrom: 0, contentRange: null }).ok).toBe(
      true,
    );
  });

  it("rejects an HTML error page even with a 206", () => {
    const r = checkRangeResponse({ ...base, contentType: "text/html; charset=utf-8" });
    expect(r.ok).toBe(false);
    expect((r as { problem: string }).problem).toMatch(/error page/i);
  });

  it("rejects a JSON body", () => {
    expect(checkRangeResponse({ ...base, contentType: "application/json" }).ok).toBe(false);
  });

  it("rejects a server that starts from the wrong offset", () => {
    const r = checkRangeResponse({ ...base, contentRange: "bytes 0-99/100" });
    expect(r.ok).toBe(false);
    expect((r as { problem: string }).problem).toMatch(/but 40 was requested/);
  });

  it("rejects a file whose total size changed underneath us", () => {
    const r = checkRangeResponse({ ...base, contentRange: "bytes 40-199/200" });
    expect(r.ok).toBe(false);
    expect((r as { problem: string }).problem).toMatch(/changed underneath us/i);
  });

  it("tolerates an unknown total (bytes 40-99/*)", () => {
    expect(checkRangeResponse({ ...base, contentRange: "bytes 40-99/*" }).ok).toBe(true);
  });

  it("rejects an unparseable Content-Range rather than ignoring it", () => {
    expect(checkRangeResponse({ ...base, contentRange: "garbage" }).ok).toBe(false);
  });

  it("rejects an unexpected status", () => {
    expect(checkRangeResponse({ ...base, status: 416 }).ok).toBe(false);
    expect(checkRangeResponse({ ...base, status: 500 }).ok).toBe(false);
  });

  it("does not require Content-Range to be present", () => {
    // Some proxies drop it. The offset check is then unavailable, but a 206 with the
    // right length is still workable — the final hash is the real gate.
    expect(checkRangeResponse({ ...base, contentRange: null }).ok).toBe(true);
  });
});

describe("parseContentRange", () => {
  it("parses the standard form", () => {
    expect(parseContentRange("bytes 200-1000/1001")).toEqual({ start: 200, end: 1000, total: 1001 });
  });

  it("parses an unknown total", () => {
    expect(parseContentRange("bytes 0-99/*")).toEqual({ start: 0, end: 99, total: null });
  });

  it("returns null for anything else", () => {
    expect(parseContentRange("items 0-99/100")).toBeNull();
    expect(parseContentRange("")).toBeNull();
    expect(parseContentRange("bytes */100")).toBeNull();
  });
});
