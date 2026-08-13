import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { zenodoEnv, zenodoSiteUrl } from "@/lib/transition/zenodo-env";
import { ZENODO_SESSION_COOKIE, readZenodoSession } from "@/lib/transition/zenodo-session";

export const runtime = "nodejs";

/**
 * GET /api/zenodo/session — is this user connected to Zenodo, and to WHICH Zenodo?
 *
 * Never returns the token. The UI needs to know only whether to show "Connect" or
 * "Connected to sandbox.zenodo.org", and the environment is part of that answer because
 * depositing to sandbox and depositing to production are different acts with different
 * consequences — one is wipeable, the other mints a permanent DOI.
 */
export async function GET(): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const env = zenodoEnv();
  const jar = await cookies();
  const session = readZenodoSession(jar.get(ZENODO_SESSION_COOKIE)?.value, {
    osfUserId: guard.actor.osfUserId,
    env,
    now: new Date(),
  });

  return Response.json(
    {
      connected: Boolean(session),
      env,
      site: zenodoSiteUrl(env),
      scope: session?.scope ?? null,
      expiresAt: session?.expiresAt ?? null,
    },
    { headers: noStore },
  );
}

/** DELETE /api/zenodo/session — disconnect. Clears our copy; nothing on Zenodo changes. */
export async function DELETE(): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const res = NextResponse.json({ connected: false }, { headers: noStore });
  res.cookies.delete(ZENODO_SESSION_COOKIE);
  return res;
}

const noStore = { "Cache-Control": "private, no-store" } as const;
