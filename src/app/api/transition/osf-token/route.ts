import { auth } from "@/auth";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";

export const runtime = "nodejs";

/**
 * GET /api/transition/osf-token
 *
 * The OSF access token the BROWSER needs to pull file bytes straight from Waterbutler
 * (`files.osf.io`), which allows `Range` + `Authorization` and returns 206. Research bytes
 * therefore never pass through Vercel, at any size.
 *
 * Why this exists instead of reusing `/api/osf/upload-token`: that route requires
 * `session.osfCanWrite`, and the transition gate deliberately signs users in with
 * **read-only** scope (see TransitionGate — asking for write would contradict the term
 * promising this feature never deletes anything). So every user who arrived through
 * /transition and signed in there had `osfCanWrite === false`, got a 403, and saw
 * "Could not get an OSF access token" the moment they pressed Start. Reading is all an
 * export or a transfer ever needs.
 *
 * Same posture as the upload token otherwise: access token only (the refresh token never
 * leaves the server), `no-store`, in memory in the client, discarded when the run ends.
 * Consent-gated like every other transition route, so it cannot be used as a general
 * token oracle.
 */
export async function GET(): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const session = await auth().catch(() => null);
  if (!session?.accessToken) {
    return Response.json(
      { error: "Sign in with OSF again — your session has no access token.", code: "unauthorized" },
      { status: 401, headers: noStore },
    );
  }
  if (session.osfAuthError) {
    return Response.json(
      {
        error: "Your OSF connection has expired. Sign in again to continue.",
        code: "osf_auth_error",
      },
      { status: 403, headers: noStore },
    );
  }

  return Response.json(
    { token: session.accessToken, expiresAt: session.osfAccessTokenExpires ?? null },
    { headers: noStore },
  );
}

const noStore = { "Cache-Control": "private, no-store" } as const;
