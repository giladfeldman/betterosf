import { requireAdmin } from "@/lib/admin";
import { setBugReportStatus } from "@/lib/db/bug-reports";
import { logInfo, logError, errorDetails } from "@/lib/logger";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["new", "triaged", "resolved"]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await ctx.params;
  // Reject anything that isn't a plain uuid before it reaches the query layer.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid report id." }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return Response.json(
      { error: `status must be one of: ${[...ALLOWED_STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const updated = await setBugReportStatus(id, status);
    if (!updated) {
      return Response.json({ error: "Report not found." }, { status: 404 });
    }
  } catch (e) {
    logError("admin", "bug report status update failed", { id, ...errorDetails(e) });
    return Response.json({ error: "Could not update that report." }, { status: 500 });
  }

  logInfo("admin", "bug report status changed", { id, status }, gate.session.osfUserId);
  return Response.json({ ok: true, id, status });
}
