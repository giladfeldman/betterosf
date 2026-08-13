import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { zenodoEnv, zenodoOAuthCredentials, zenodoRedirectUri } from "@/lib/transition/zenodo-env";
import { exchangeZenodoCode } from "@/lib/transition/zenodo-oauth";
import { logInfo } from "@/lib/logger";
import {
  ZENODO_OAUTH_STATE_COOKIE,
  ZENODO_SESSION_COOKIE,
  cookieOptions,
  open,
  safeReturnTo,
  seal,
  stateMatches,
  type OAuthStatePayload,
  type ZenodoSession,
} from "@/lib/transition/zenodo-session";

export const runtime = "nodejs";

/** Cookie lifetime is capped at Zenodo's own token lifetime, never beyond it. */
const MAX_SESSION_SECONDS = 60 * 60 * 24 * 60; // 60 days — Zenodo's measured expires_in.

/**
 * GET /api/zenodo/oauth/callback?code=…&state=…
 *
 * Redeem the authorization code and seal the resulting access token into an httpOnly
 * cookie bound to this OSF user and this Zenodo environment.
 *
 * Every failure sends the user back to the page they started from with a `zenodo=` error
 * marker rather than rendering an error page here: this URL is reached by redirect from
 * another origin, and a dead end at `/api/…` is the worst place to strand somebody.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jar = await cookies();
  const stateCookie = open<OAuthStatePayload>(jar.get(ZENODO_OAUTH_STATE_COOKIE)?.value);

  // Where to send the user back to. Taken from the sealed cookie — never from the query
  // string, which came back through a third party.
  const returnTo = safeReturnTo(stateCookie?.returnTo, "/transition");

  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const fail = (code: string, detail?: string): Response => {
    if (detail) console.error(`[zenodo/oauth/callback] ${code}: ${detail}`);
    const res = NextResponse.redirect(new URL(`${returnTo}?zenodo=${code}`, url.origin));
    res.cookies.delete(ZENODO_OAUTH_STATE_COOKIE);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };

  // Zenodo reports a refusal in the query string, not as an HTTP error.
  const oauthError = url.searchParams.get("error");
  if (oauthError) return fail("denied", oauthError);

  if (!stateCookie) return fail("state_missing");
  if (stateCookie.osfUserId !== guard.actor.osfUserId) return fail("state_user_mismatch");

  const returnedState = url.searchParams.get("state") ?? "";
  if (!stateMatches(returnedState, stateCookie.state)) return fail("state_mismatch");

  const code = url.searchParams.get("code");
  if (!code) return fail("no_code");

  let env, credentials, redirectUri;
  try {
    env = zenodoEnv();
    credentials = zenodoOAuthCredentials(env);
    redirectUri = zenodoRedirectUri();
  } catch (e) {
    return fail("not_configured", e instanceof Error ? e.message : String(e));
  }

  // The environment is pinned at `start` time. If ZENODO_ENV changed while the user was
  // away, redeeming the code against the other instance would fail opaquely — or worse,
  // succeed and leave a sandbox token labelled production.
  if (stateCookie.env !== env) return fail("env_changed");

  let token;
  try {
    token = await exchangeZenodoCode({
      env,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      redirectUri,
      code,
      now: () => new Date(),
    });
  } catch (e) {
    return fail("exchange_failed", e instanceof Error ? e.message : String(e));
  }

  const session: ZenodoSession = {
    accessToken: token.accessToken,
    env,
    scope: token.scope,
    expiresAt: token.expiresAt,
    osfUserId: guard.actor.osfUserId,
  };

  const maxAge = token.expiresAt
    ? Math.max(60, Math.min(MAX_SESSION_SECONDS, Math.floor((token.expiresAt - Date.now()) / 1000)))
    : MAX_SESSION_SECONDS;

  const res = NextResponse.redirect(new URL(`${returnTo}?zenodo=connected`, url.origin));
  res.cookies.set(ZENODO_SESSION_COOKIE, seal(session), cookieOptions(maxAge));
  res.cookies.delete(ZENODO_OAUTH_STATE_COOKIE);
  res.headers.set("Cache-Control", "private, no-store");

  // Not awaited: the connection is already established, and a slow log must not delay the
  // redirect. The scope is recorded because a narrower grant than we asked for is the
  // first thing to check when an upload later 403s.
  logInfo("transition", "Zenodo account connected", { env, scope: token.scope }, guard.actor.userId);

  return res;
}
