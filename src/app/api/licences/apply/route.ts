import { auth } from "@/auth";
import { applyLicence, listOsfLicences } from "@/lib/osf/licences";
import { APPLY_BATCH_SIZE, validateApply, type ApplyResult } from "@/lib/licence/check";
import { OsfWriteError } from "@/lib/osf/write";
import { appErrorResponse } from "@/lib/osf/error-response";
import { isValidGuid } from "@/lib/osf/guid";
import { daysUntil } from "@/lib/transition/deadlines";

export const runtime = "nodejs";
export const maxDuration = 60;

const READ_ONLY_DATE = "2027-02-19";

/**
 * Set one licence on up to APPLY_BATCH_SIZE nodes. The page splits a larger bulk apply
 * into several calls so no invocation runs long. Each node is PATCHed then read back; the
 * read-back alone decides "confirmed".
 *
 * Nodes run one after another, not in parallel: OSF rate-limits, and a bulk relicense is
 * a one-off that does not need to be fast.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth().catch(() => null);
  if (!session?.accessToken) {
    return appErrorResponse({ status: 401, code: "unauthorized", error: "Sign in with OSF first.", logType: "osf" });
  }
  if (daysUntil(READ_ONLY_DATE, new Date()) <= 0) {
    return appErrorResponse({
      status: 410,
      code: "osf_read_only",
      error: "OSF projects are read-only now, so their licences can no longer be changed.",
      action: "Set the licence at your new repository when you deposit there.",
      logType: "osf",
    });
  }

  let body: { guids?: unknown; licenceId?: unknown; copyrightHolders?: unknown; year?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("The request was not valid JSON.");
  }
  const guids = Array.isArray(body.guids) ? body.guids.filter((g): g is string => typeof g === "string") : [];
  if (guids.length === 0 || guids.length > APPLY_BATCH_SIZE || guids.length !== (body.guids as unknown[]).length) {
    return badRequest(`Send between 1 and ${APPLY_BATCH_SIZE} project ids.`);
  }
  if (!guids.every(isValidGuid)) return badRequest("One of the project ids is not an OSF id.");
  const input = {
    licenceId: typeof body.licenceId === "string" ? body.licenceId : "",
    copyrightHolders: Array.isArray(body.copyrightHolders)
      ? body.copyrightHolders.filter((h): h is string => typeof h === "string").slice(0, 50)
      : [],
    year: typeof body.year === "string" ? body.year : "",
  };

  const options = await listOsfLicences().catch(() => null);
  if (!options) {
    return appErrorResponse({
      status: 502,
      code: "licence_list_failed",
      error: "Could not read OSF's licence list, so nothing was changed.",
      action: "Retry in a minute.",
      logType: "osf",
    });
  }
  const problems = validateApply(input, options.find((o) => o.id === input.licenceId));
  if (problems.length > 0) return badRequest(problems.join(" "));

  const results: ApplyResult[] = [];
  for (const guid of guids) {
    try {
      results.push(await applyLicence(guid, input));
    } catch (e) {
      if (e instanceof OsfWriteError) {
        return appErrorResponse({
          status: e.status,
          code: "osf_write_needed",
          error: e.message,
          action: "Give BetterOSF write access to OSF, then retry.",
          logType: "osf",
        });
      }
      results.push({ guid, ok: false, reason: "Could not confirm the change. Run the check again to see." });
    }
  }
  return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}

function badRequest(error: string): Response {
  return appErrorResponse({ status: 400, code: "bad_request", error, logType: "osf" });
}
