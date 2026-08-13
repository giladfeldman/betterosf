import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";
/** Must never be cached, or drift checks would read a stale version forever. */
export const dynamic = "force-dynamic";

/**
 * Liveness + deployed version.
 *
 * Exists so `deploy-drift-check.sh` can answer the one question no local gate can:
 * **is the version RUNNING in production the version that is COMMITTED?** Without a
 * machine-readable version somewhere on the deployed surface, that check returns
 * "cannot verify" on every run — which is not a pass, and would stay not-a-pass forever.
 *
 * The failure this guards against is silent: a release is committed and pushed, the
 * deploy never lands, every local gate stays green, and the fixes in it are simply not
 * live. ESCImate lost six consecutive releases that way before anyone noticed.
 *
 * Deliberately anonymous and free of any secret, DB call, or upstream request — a health
 * endpoint that can fail for reasons unrelated to health is worse than none.
 */
export function GET(): Response {
  return Response.json(
    { status: "ok", version: APP_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}
