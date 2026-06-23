import { describe, it, expect } from "vitest";
import { readErrorResponse, throwFromResponse, parseRetryAfter, type HttpError } from "@/lib/http/read-error";

describe("readErrorResponse", () => {
  it("extracts a JSON {error,code} message and prefixes the status", async () => {
    const res = Response.json({ error: "You may not have write permission.", code: "forbidden" }, { status: 403 });
    const e = await readErrorResponse(res);
    expect(e.status).toBe(403);
    expect(e.code).toBe("forbidden");
    expect(e.message).toBe("HTTP 403 — You may not have write permission.");
  });

  it("falls back to the RAW body for non-JSON (the real bug: middleware 429 text)", async () => {
    const res = new Response("Too many requests. Please wait and try again.", { status: 429, headers: { "Content-Type": "text/plain" } });
    const e = await readErrorResponse(res);
    expect(e.status).toBe(429);
    expect(e.message).toBe("HTTP 429 — Too many requests. Please wait and try again.");
  });

  it("collapses an HTML error page to a single line", async () => {
    const res = new Response("<html>\n  <body>500</body>\n</html>", { status: 500, headers: { "Content-Type": "text/html" } });
    const e = await readErrorResponse(res);
    expect(e.message.startsWith("HTTP 500 — ")).toBe(true);
    expect(e.message).not.toContain("\n");
  });

  it("uses bare status when the body is empty", async () => {
    const res = new Response("", { status: 502 });
    expect((await readErrorResponse(res)).message).toBe("HTTP 502");
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds into milliseconds (min 1s)", () => {
    expect(parseRetryAfter(new Response("", { headers: { "Retry-After": "30" } }))).toBe(30_000);
    expect(parseRetryAfter(new Response("", { headers: { "Retry-After": "0" } }))).toBe(1_000);
  });
  it("returns undefined when absent", () => {
    expect(parseRetryAfter(new Response(""))).toBeUndefined();
  });
});

describe("throwFromResponse", () => {
  it("throws an HttpError carrying status, code, and Retry-After", async () => {
    const res = new Response("nope", { status: 429, headers: { "Retry-After": "5" } });
    try {
      await throwFromResponse(res);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as HttpError;
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(5_000);
      expect(err.message).toContain("HTTP 429");
    }
  });
});
