import { NextResponse } from "next/server";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { zenodoEnv, zenodoOAuthCredentials, zenodoRedirectUri } from "@/lib/transition/zenodo-env";
import { buildZenodoAuthorizeUrl } from "@/lib/transition/zenodo-oauth";
import {
  ZENODO_OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  cookieOptions,
  newOAuthState,
  safeReturnTo,
  seal,
  type OAuthStatePayload,
} from "@/lib/transition/zenodo-session";

export const runtime = "nodejs";

/**
 * GET /api/zenodo/oauth/start?returnTo=/transition/abc12
 *
 * Begin the Zenodo authorization-code flow. Consent-gated like every transition route, so
 * a user cannot be walked into granting deposit rights before they have agreed to the
 * terms that explain what a deposit means.
 *
 * The `state` is sealed into a short-lived httpOnly cookie ALONGSIDE the OSF user id and
 * the target environment. The callback re-checks all three, so a code obtained in one
 * account or aimed at the other Zenodo instance cannot be redeemed here.
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  let env, credentials, redirectUri;
  try {
    env = zenodoEnv();
    credentials = zenodoOAuthCredentials(env);
    redirectUri = zenodoRedirectUri();
  } catch (e) {
    // A misconfiguration, not a user error. Say exactly which variable is missing —
    // zenodoOAuthCredentials names it — instead of a generic failure.
    return Response.json(
      { error: e instanceof Error ? e.message : "Zenodo is not configured.", code: "zenodo_not_configured" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const state = newOAuthState();
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"), "/transition");
  const payload: OAuthStatePayload = { state, returnTo, env, osfUserId: guard.actor.osfUserId };

  const res = NextResponse.redirect(
    buildZenodoAuthorizeUrl({ env, clientId: credentials.clientId, redirectUri, state }),
  );
  res.cookies.set(ZENODO_OAUTH_STATE_COOKIE, seal(payload), cookieOptions(OAUTH_STATE_TTL_SECONDS));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
