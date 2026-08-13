import { cookies } from "next/headers";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { zenodoEnv, zenodoSiteUrl } from "@/lib/transition/zenodo-env";
import { ZENODO_SESSION_COOKIE, readZenodoSession } from "@/lib/transition/zenodo-session";

export const runtime = "nodejs";

/**
 * GET /api/zenodo/token
 *
 * Hands the browser its Zenodo access token for the duration of one run, so file bytes go
 * browser → zenodo.org directly. Zenodo sends `Access-Control-Allow-Origin: *` and allows
 * `authorization` and `PUT` on the deposit endpoints (measured 2026-08-13), which is the
 * entire reason a transfer can move gigabytes without touching Vercel.
 *
 * The same posture as `/api/osf/upload-token`: `no-store`, memory-only on the client,
 * pinned by the client to the Zenodo API base for the reported environment, discarded when
 * the run ends.
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

  if (!session) {
    return Response.json(
      {
        error: `Connect your ${zenodoSiteUrl(env)} account before transferring.`,
        code: "zenodo_not_connected",
      },
      { status: 403, headers: noStore },
    );
  }

  return Response.json(
    { token: session.accessToken, env: session.env, expiresAt: session.expiresAt },
    { headers: noStore },
  );
}

const noStore = { "Cache-Control": "private, no-store" } as const;
