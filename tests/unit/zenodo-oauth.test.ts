// The Zenodo authorization-code flow: what we send, and what we accept back.
//
// Both halves were measured against sandbox.zenodo.org on 2026-08-13 — `/oauth/authorize`
// answers 302 to `/login/?next=…` with every parameter preserved, and `/oauth/token`
// returns a Bearer token with `expires_in: 5184000`.

import { describe, it, expect } from "vitest";
import { buildZenodoAuthorizeUrl, parseTokenResponse, exchangeZenodoCode } from "@/lib/transition/zenodo-oauth";
import { ZENODO_SCOPES, zenodoRedirectUri } from "@/lib/transition/zenodo-env";

describe("buildZenodoAuthorizeUrl", () => {
  it("sends exactly the parameters Zenodo expects, at the right host", () => {
    const url = new URL(
      buildZenodoAuthorizeUrl({
        env: "sandbox",
        clientId: "abc",
        redirectUri: "http://localhost:4747/api/zenodo/oauth/callback",
        state: "st-1",
      }),
    );
    expect(url.origin).toBe("https://sandbox.zenodo.org");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4747/api/zenodo/oauth/callback");
    expect(url.searchParams.get("scope")).toBe(ZENODO_SCOPES);
    expect(url.searchParams.get("state")).toBe("st-1");
  });

  it("points production at zenodo.org", () => {
    const url = new URL(
      buildZenodoAuthorizeUrl({ env: "production", clientId: "a", redirectUri: "https://x/y", state: "s" }),
    );
    expect(url.origin).toBe("https://zenodo.org");
  });

  it("asks for no scope beyond depositing", () => {
    expect(ZENODO_SCOPES).toBe("deposit:write deposit:actions");
  });
});

describe("zenodoRedirectUri", () => {
  it("derives the URI from configuration, never from a request host", () => {
    expect(zenodoRedirectUri({ NEXT_PUBLIC_BASE_URL: "https://betterosf.vercel.app" })).toBe(
      "https://betterosf.vercel.app/api/zenodo/oauth/callback",
    );
  });

  it("tolerates a trailing slash rather than producing a double one", () => {
    // Zenodo matches the registered URI EXACTLY, so `//api/...` fails opaquely.
    expect(zenodoRedirectUri({ NEXT_PUBLIC_BASE_URL: "http://localhost:4747/" })).toBe(
      "http://localhost:4747/api/zenodo/oauth/callback",
    );
  });

  it("throws rather than guessing when the base URL is unset", () => {
    expect(() => zenodoRedirectUri({})).toThrow(/NEXT_PUBLIC_BASE_URL/);
  });
});

describe("parseTokenResponse", () => {
  const now = new Date("2026-08-13T00:00:00Z");

  it("reads a real Zenodo token response", () => {
    const result = parseTokenResponse(
      { access_token: "tok", token_type: "Bearer", expires_in: 5184000, scope: ZENODO_SCOPES },
      now,
    );
    expect(result.accessToken).toBe("tok");
    expect(result.scope).toBe(ZENODO_SCOPES);
    expect(result.expiresAt).toBe(now.getTime() + 5184000 * 1000);
  });

  it("records an absent expiry as unknown, not as 'never'", () => {
    expect(parseTokenResponse({ access_token: "tok" }, now).expiresAt).toBeNull();
  });

  it("refuses a response with no token instead of sealing a blank one", () => {
    // A sealed empty token would present as "connected" and fail on the first upload.
    expect(() => parseTokenResponse({ error: "invalid_client" }, now)).toThrow(/invalid_client/);
    expect(() => parseTokenResponse({ access_token: "   " }, now)).toThrow(/access token/i);
    expect(() => parseTokenResponse(null, now)).toThrow();
  });

  it("refuses a token type we would send wrongly", () => {
    expect(() => parseTokenResponse({ access_token: "t", token_type: "mac" }, now)).toThrow(/token type/i);
  });
});

describe("exchangeZenodoCode", () => {
  it("posts the code and secret as form data to the token endpoint", async () => {
    let seen: { url: string; body: string; method?: string } | null = null;
    const result = await exchangeZenodoCode({
      env: "sandbox",
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://localhost:4747/api/zenodo/oauth/callback",
      code: "the-code",
      now: () => new Date("2026-08-13T00:00:00Z"),
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), body: String(init?.body), method: init?.method };
        return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 60 }), {
          status: 200,
        });
      }) as typeof fetch,
    });

    expect(result.accessToken).toBe("tok");
    const captured = seen as unknown as { url: string; body: string; method?: string };
    expect(captured.url).toBe("https://sandbox.zenodo.org/oauth/token");
    expect(captured.method).toBe("POST");
    expect(captured.body).toContain("grant_type=authorization_code");
    expect(captured.body).toContain("code=the-code");
    expect(captured.body).toContain("client_secret=secret");
  });

  it("surfaces the status and body when Zenodo rejects the exchange", async () => {
    await expect(
      exchangeZenodoCode({
        env: "sandbox",
        clientId: "id",
        clientSecret: "wrong",
        redirectUri: "r",
        code: "c",
        now: () => new Date(),
        fetchImpl: (async () =>
          new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })) as typeof fetch,
      }),
    ).rejects.toThrow(/401.*invalid_client/s);
  });
});
