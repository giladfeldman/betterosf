import { auth } from "@/auth";
import { getMyLicencePage, listOsfLicences } from "@/lib/osf/licences";
import { pickableLicences } from "@/lib/licence/check";
import { osfErrorResponse, appErrorResponse } from "@/lib/osf/error-response";

export const runtime = "nodejs";
/** One invocation fetches ONE upstream page (plus the cached licence list on the first). */
export const maxDuration = 60;

/**
 * The licence check: one page of the signed-in user's projects and components, each with
 * its licence. Paged for the same reason as /api/transition/inventory (a 443-project
 * account takes 5 upstream pages). The first page also carries OSF's licence list.
 *
 * Read-only, so it needs only sign-in — not the transition consent, which covers
 * exporting and depositing.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth().catch(() => null);
  if (!session?.accessToken || session.osfAuthError) {
    return appErrorResponse({
      status: 401,
      code: session?.osfAuthError ? "osf_unauthorized" : "unauthorized",
      error: "Sign in with OSF to check your projects' licences.",
      logType: "osf",
    });
  }

  const cursor = new URL(req.url).searchParams.get("cursor");
  // Pin the cursor to the OSF API host so this route cannot become an open proxy that
  // fetches anywhere with the user's OSF token attached.
  if (cursor && !isOsfApiUrl(cursor)) {
    return appErrorResponse({
      status: 400,
      code: "bad_cursor",
      error: "That page link is not an OSF API address.",
      action: "Reload the page to start the check again.",
      logType: "osf",
    });
  }

  try {
    const [page, licences] = await Promise.all([
      getMyLicencePage(cursor ?? undefined),
      cursor ? Promise.resolve(null) : listOsfLicences(),
    ]);
    return Response.json(
      {
        rows: page.rows,
        nextCursor: page.next,
        total: page.total,
        licences: licences ? pickableLicences(licences) : null,
        canWrite: Boolean(session.osfCanWrite),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e, { endpoint: "/v2/users/me/nodes/?embed=license" });
    if (mapped) return mapped;
    return appErrorResponse({
      status: 502,
      code: "licence_check_failed",
      error: "Could not read your projects' licences from OSF.",
      action: "Nothing was changed. Retry — and if it keeps failing, check status.cos.io.",
      cause: e,
      logType: "osf",
      logMessage: "licence check failed",
    });
  }
}

function isOsfApiUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "api.osf.io";
  } catch {
    return false;
  }
}
