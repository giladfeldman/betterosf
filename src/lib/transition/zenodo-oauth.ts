import "server-only";

import {
  ZENODO_SCOPES,
  zenodoAuthorizeUrl,
  zenodoTokenUrl,
  type ZenodoEnv,
} from "./zenodo-env";

/**
 * The Zenodo authorization-code flow.
 *
 * Split out from the routes so the URL building and the response parsing — the two places
 * that can be silently wrong — are pure and unit-testable. The routes own cookies and
 * redirects; this owns what is actually sent to Zenodo.
 *
 * No PKCE: the application is registered as a **Confidential** client (a Public one has no
 * usable secret and fails `client_credentials` with an opaque `invalid_client`, which cost
 * an hour on 2026-08-13), and Zenodo's authorize endpoint is not documented to accept
 * `code_challenge`. Sending parameters a server ignores would look like a protection we do
 * not have. The `state` cookie is the anti-forgery control, and the client secret never
 * leaves the server.
 */

export type AuthorizeUrlInput = {
  env: ZenodoEnv;
  clientId: string;
  redirectUri: string;
  state: string;
};

export function buildZenodoAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(zenodoAuthorizeUrl(input.env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", ZENODO_SCOPES);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type TokenExchangeResult = {
  accessToken: string;
  scope: string;
  /** Epoch ms, or null when Zenodo did not say. Null means unknown, never "forever". */
  expiresAt: number | null;
};

/**
 * Parse a token response.
 *
 * Rejects anything that is not a usable Bearer access token rather than storing a
 * plausible-looking blank — a sealed cookie holding `""` would present as "connected" and
 * then fail on the first upload, which is the worst of both.
 */
export function parseTokenResponse(json: unknown, now: Date): TokenExchangeResult {
  const body = (json ?? {}) as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) {
    const err = typeof body.error === "string" ? body.error : "no access_token in the response";
    throw new Error(`Zenodo did not return an access token (${err}).`);
  }
  const tokenType = typeof body.token_type === "string" ? body.token_type.toLowerCase() : "bearer";
  if (tokenType !== "bearer") {
    throw new Error(`Zenodo returned an unexpected token type (${tokenType}).`);
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    scope: typeof body.scope === "string" ? body.scope : "",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now.getTime() + expiresIn * 1000 : null,
  };
}

export type ExchangeInput = {
  env: ZenodoEnv;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  now: () => Date;
  fetchImpl?: typeof fetch;
};

/** Exchange an authorization code for an access token. Server-side only — sends the secret. */
export async function exchangeZenodoCode(input: ExchangeInput): Promise<TokenExchangeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(zenodoTokenUrl(input.env), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }),
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    // Zenodo's OAuth errors are terse. Include the status and a bounded slice of the body
    // so a misregistered redirect URI or a Public-client secret is diagnosable from the
    // log rather than from guesswork.
    throw new Error(`Zenodo rejected the token exchange (HTTP ${res.status}). ${text.slice(0, 200)}`);
  }

  return parseTokenResponse(json, input.now());
}
