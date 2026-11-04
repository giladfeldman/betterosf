// @vitest-environment node
//
// zenodo.org's firewall 403s Node's default `User-Agent: node` ("unusual traffic from your
// network"); sandbox does not. Every production Zenodo connect failed with exchange_failed
// until the server sent its own UA (measured 2026-11-04). These pin the header on every
// server-side Zenodo call path: the token exchange and the API client the publish route uses.

import { describe, it, expect } from "vitest";
import { exchangeZenodoCode } from "@/lib/transition/zenodo-oauth";
import { ZENODO_SERVER_USER_AGENT, zenodoServerHeaders } from "@/lib/transition/zenodo-env";
import { publishDraft } from "@/lib/transition/targets/zenodo";

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("server-side Zenodo requests carry a User-Agent", () => {
  it("is a non-empty, non-default UA", () => {
    expect(zenodoServerHeaders()["User-Agent"]).toBe(ZENODO_SERVER_USER_AGENT);
    expect(ZENODO_SERVER_USER_AGENT).not.toMatch(/^node/i);
  });

  it("token exchange sends it", async () => {
    let ua: string | null = null;
    await exchangeZenodoCode({
      env: "production",
      clientId: "id",
      clientSecret: "s",
      redirectUri: "r",
      code: "c",
      now: () => new Date(),
      fetchImpl: (async (_u: string | URL | Request, init?: RequestInit) => {
        ua = headerOf(init, "User-Agent");
        return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }), { status: 200 });
      }) as typeof fetch,
    });
    expect(ua).toBe(ZENODO_SERVER_USER_AGENT);
  });

  it("API client (used by the publish route) sends it alongside the bearer token", async () => {
    const orig = globalThis.fetch;
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_u: string | URL | Request, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ id: "1", links: {}, pids: {} }), { status: 200 });
    }) as typeof fetch;
    try {
      await publishDraft({ env: "production", accessToken: "tok" }, "1").catch(() => undefined);
    } finally {
      globalThis.fetch = orig;
    }
    expect(headerOf(init, "User-Agent")).toBe(ZENODO_SERVER_USER_AGENT);
    expect(headerOf(init, "Authorization")).toBe("Bearer tok");
  });
});
