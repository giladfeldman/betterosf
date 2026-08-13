import { z } from "zod";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { listJobs, upsertJob } from "@/lib/db/transition-jobs";
import { isValidGuid } from "@/lib/osf/guid";

export const runtime = "nodejs";

/**
 * The coarse server-side checkpoint for a transfer run.
 *
 * IndexedDB is the primary ledger — this exists so a run can be found from another
 * device, and so the evidence survives a browser that clears its storage. It is written
 * roughly every 25 files or 30 seconds, never per file.
 */

const jobSchema = z.object({
  jobId: z.string().uuid(),
  guid: z.string().min(1).max(20),
  destination: z.literal("zenodo"),
  env: z.enum(["sandbox", "production"]),
  status: z.enum(["running", "complete", "incomplete", "abandoned"]),
  records: z
    .array(z.object({ recordId: z.string().min(1).max(64), fileCount: z.number().int().min(0) }))
    .max(500),
  fileCount: z.number().int().min(0).max(100_000),
  // Number.MAX_SAFE_INTEGER would overflow a bigint column's practical range long before
  // it overflows JS. 1 PB is far beyond anything OSF holds and still safely representable.
  bytesTotal: z.number().int().min(0).max(1_000_000_000_000_000),
});

export async function POST(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const parsed = jobSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Malformed job checkpoint." }, { status: 400, headers: noStore });
  }
  if (!isValidGuid(parsed.data.guid)) {
    return Response.json({ error: "Not a valid OSF id." }, { status: 400, headers: noStore });
  }

  try {
    await upsertJob({
      jobId: parsed.data.jobId,
      userId: guard.actor.userId,
      osfUserId: guard.actor.osfUserId,
      guid: parsed.data.guid,
      destination: parsed.data.destination,
      env: parsed.data.env,
      status: parsed.data.status,
      records: parsed.data.records,
      fileCount: parsed.data.fileCount,
      bytesTotal: parsed.data.bytesTotal,
    });
  } catch (e) {
    // A checkpoint is a convenience, not a precondition — but say so honestly rather than
    // returning 200 for a write that did not happen. The client keeps running either way.
    console.error("[transition/jobs] checkpoint failed:", e);
    return Response.json(
      { error: "Could not save this run's checkpoint. The transfer itself is unaffected." },
      { status: 503, headers: noStore },
    );
  }

  return Response.json({ saved: true }, { headers: noStore });
}

/** GET /api/transition/jobs — this user's recent runs, for the resume list. */
export async function GET(): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  try {
    return Response.json({ jobs: await listJobs(guard.actor.osfUserId) }, { headers: noStore });
  } catch (e) {
    console.error("[transition/jobs] list failed:", e);
    return Response.json(
      { error: "Could not read your previous runs." },
      { status: 503, headers: noStore },
    );
  }
}

const noStore = { "Cache-Control": "private, no-store" } as const;
