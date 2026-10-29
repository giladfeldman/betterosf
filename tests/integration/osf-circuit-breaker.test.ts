/**
 * d-24c4e3 — a shared OSF circuit breaker, so an OSF 429 or 5xx storm makes BetterOSF back
 * off instead of hammering OSF.
 *
 * Before: every request during an OSF outage still made its full set of attempts (two per
 * call, the second after a retry), and every anonymous request during an anonymous-bucket
 * 429 first spent a call on the anonymous path it already knew was throttled.
 *
 * Scope, stated honestly: the state is per server instance (module memory). A fleet-wide
 * breaker needs a shared store (Vercel KV), which is not provisioned and is an owner
 * decision (cost). Per instance still removes the hammering, because each warm instance
 * stops calling OSF as soon as it has seen the storm itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { osfGet, _resetOsfClientForTests, OSF_BREAKER } from "@/lib/osf/client";
import { OsfError } from "@/lib/osf/types";

beforeEach(() => _resetOsfClientForTests());
afterEach(() => vi.useRealTimers());

function countingHandler(path: string, respond: (req: Request) => Response) {
  const hits = { anon: 0, authed: 0 };
  server.use(
    http.get(`https://api.osf.io/v2${path}`, ({ request }) => {
      if (request.headers.get("authorization")) hits.authed++;
      else hits.anon++;
      return respond(request);
    }),
  );
  return hits;
}

describe("5xx storm opens the breaker", () => {
  it("after failureThreshold consecutive upstream failures, further calls fail fast without touching OSF", async () => {
    const hits = countingHandler("/nodes/:id/", () => new HttpResponse(null, { status: 503 }));
    for (let i = 0; i < OSF_BREAKER.failureThreshold; i++) {
      await expect(osfGet(`/nodes/n${i}/`)).rejects.toMatchObject({ code: "upstream" });
    }
    const before = hits.anon + hits.authed;
    const err = await osfGet("/nodes/next/").catch((e) => e);
    expect(err).toBeInstanceOf(OsfError);
    expect((err as OsfError).code).toBe("upstream");
    expect(hits.anon + hits.authed).toBe(before); // no network call at all
  });

  it("after the cooldown one probe goes through, and a success closes the breaker", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let healthy = false;
    const hits = countingHandler("/nodes/:id/", () =>
      healthy
        ? HttpResponse.json({ data: { id: "x", type: "nodes", attributes: {} } })
        : new HttpResponse(null, { status: 502 }),
    );
    for (let i = 0; i < OSF_BREAKER.failureThreshold; i++) {
      await osfGet(`/nodes/m${i}/`).catch(() => {});
    }
    await expect(osfGet("/nodes/blocked/")).rejects.toBeInstanceOf(OsfError);

    healthy = true;
    vi.setSystemTime(Date.now() + OSF_BREAKER.cooldownMs + 1);
    const before = hits.anon;
    await expect(osfGet("/nodes/probe/")).resolves.toBeTruthy();
    expect(hits.anon).toBe(before + 1);
    await expect(osfGet("/nodes/after/")).resolves.toBeTruthy(); // closed again
  });

  it("a success in between resets the count (failures must be consecutive)", async () => {
    let healthy = false;
    const hits = countingHandler("/nodes/:id/", () =>
      healthy
        ? HttpResponse.json({ data: { id: "x", type: "nodes", attributes: {} } })
        : new HttpResponse(null, { status: 503 }),
    );
    const fail = async (tag: string) => {
      for (let i = 0; i < OSF_BREAKER.failureThreshold - 1; i++) await osfGet(`/nodes/${tag}${i}/`).catch(() => {});
    };
    await fail("p");
    healthy = true;
    await osfGet("/nodes/ok/");
    healthy = false;
    await fail("q");
    const before = hits.anon;
    await osfGet("/nodes/still-open/").catch(() => {});
    expect(hits.anon).toBeGreaterThan(before); // breaker still closed: OSF was asked
  });

  it("4xx answers (404) never count toward the breaker", async () => {
    const hits = countingHandler("/nodes/:id/", () => new HttpResponse(null, { status: 404 }));
    for (let i = 0; i < OSF_BREAKER.failureThreshold + 2; i++) {
      await expect(osfGet(`/nodes/g${i}/`)).rejects.toMatchObject({ code: "not_found" });
    }
    expect(hits.anon).toBe(OSF_BREAKER.failureThreshold + 2);
  });
});

describe("anonymous-bucket 429 is remembered", () => {
  it("once anonymous is throttled, later anonymous requests go straight to the app token", async () => {
    const hits = countingHandler("/nodes/:id/", (req) =>
      req.headers.get("authorization")
        ? HttpResponse.json({ data: { id: "x", type: "nodes", attributes: {} } })
        : new HttpResponse(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await osfGet("/nodes/a1/");
    await osfGet("/nodes/a2/");
    await osfGet("/nodes/a3/");
    expect(hits.anon).toBe(1); // only the first request learned it the hard way
    expect(hits.authed).toBe(3);
  });

  it("when both the anonymous bucket and the app token are throttled, calls fail fast as rate_limited", async () => {
    const hits = countingHandler("/nodes/:id/", () =>
      new HttpResponse(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(osfGet("/nodes/b1/")).rejects.toMatchObject({ code: "rate_limited" });
    const before = hits.anon + hits.authed;
    await expect(osfGet("/nodes/b2/")).rejects.toMatchObject({ code: "rate_limited" });
    expect(hits.anon + hits.authed).toBe(before);
  });
});
