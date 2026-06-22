import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

/**
 * Regression: commit daa92b3 added an `if (isLocalHost) return next()` short-circuit
 * to bypass rate limiting during repeatable QA runs — but placed it BEFORE the guid
 * canonicalisation block, so canonicalisation (lowercasing the guid, stripping
 * `/overview`, rewriting `/files/<fileGuid>`) silently stopped running on localhost.
 * That broke the local visual-qa gate AND made local behavior diverge from prod.
 *
 * Canonicalisation is pure string logic (no OSF call), so it MUST run identically on
 * localhost and prod. Only the per-IP rate limiting should be skipped on localhost.
 */
describe("middleware canonicalisation runs on localhost (prod parity)", () => {
  it("redirects an uppercase guid to lowercase on localhost", async () => {
    const res = await middleware(new NextRequest(new URL("http://localhost:3000/3KMR9")));
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/3kmr9");
  });

  it("strips an /overview suffix on localhost", async () => {
    const res = await middleware(new NextRequest(new URL("http://localhost:3000/3kmr9/overview")));
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/3kmr9");
  });

  it("rewrites /<guid>/files/<fileGuid> to the bare file guid on localhost", async () => {
    const res = await middleware(new NextRequest(new URL("http://localhost:3000/3kmr9/files/zzzz9")));
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/zzzz9");
  });

  it("still bypasses rate limiting on localhost (QA repeatability)", async () => {
    // /about is a static segment (never canonicalised), so it flows to the nav
    // rate-limit. Far exceed the 60/min anon nav limit; localhost must never 429.
    let res!: Response;
    for (let i = 0; i < 75; i++) {
      res = await middleware(new NextRequest(new URL("http://localhost:3000/about")));
    }
    expect(res.status).not.toBe(429);
  });
});
