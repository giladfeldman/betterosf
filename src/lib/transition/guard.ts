import "server-only";

import { requireAppUser } from "@/lib/db/require-user";
import { userHasToolkitConsent } from "@/lib/db/transition-consents";

export type TransitionActor = { userId: string; osfUserId: string };

export type GuardResult =
  | { ok: true; actor: TransitionActor }
  | { ok: false; status: 401 | 403 | 503; code: string; error: string };

/**
 * The gate EVERY transition API route must call before doing anything.
 *
 * Two conditions, both required, both failing closed:
 *   1. a signed-in OSF user with an app row, and
 *   2. a consent record for the CURRENT terms version at toolkit scope.
 *
 * Consent is deliberately not implied by being signed in. The transition terms cover
 * things the general terms do not — depositing to a third party, publishing an
 * irreversible DOI, and the researcher's own authority to share participant data — so
 * agreement has to be explicit and re-collected whenever TERMS_VERSION moves.
 *
 * `403 consent_required` is distinguishable from `401 unauthorized` on purpose: the
 * client shows the clickwrap for the former and a sign-in prompt for the latter.
 */
export async function requireTransitionActor(): Promise<GuardResult> {
  const user = await requireAppUser();
  if (!user.ok) {
    return {
      ok: false,
      status: user.status,
      code: user.status === 401 ? "unauthorized" : "database_unavailable",
      // requireAppUser's own 401 text is written for the bookmarks feature ("sync
      // favorites and preferences"), which is meaningless to someone trying to export a
      // project. Say what THIS caller was actually trying to do.
      error:
        user.status === 401
          ? "Sign in with OSF to see your projects and export them."
          : user.error,
    };
  }

  if (!(await userHasToolkitConsent(user.osfUserId))) {
    return {
      ok: false,
      status: 403,
      code: "consent_required",
      error: "Agree to the transition terms before exporting or transferring a project.",
    };
  }

  return { ok: true, actor: { userId: user.userId, osfUserId: user.osfUserId } };
}

/** Turn a failed guard into a Response. Never cached — it is per-user state. */
export function guardResponse(result: Extract<GuardResult, { ok: false }>): Response {
  return Response.json(
    { error: result.error, code: result.code },
    { status: result.status, headers: { "Cache-Control": "private, no-store" } },
  );
}
