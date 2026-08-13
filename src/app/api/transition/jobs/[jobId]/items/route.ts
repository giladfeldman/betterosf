import { z } from "zod";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { getJob, listItems, upsertItems } from "@/lib/db/transition-jobs";

export const runtime = "nodejs";

/** One request per checkpoint batch. 200 is far above the 25-file cadence the runner uses. */
const MAX_ITEMS_PER_BATCH = 200;

const itemSchema = z.object({
  osfFileId: z.string().min(1).max(64),
  path: z.string().min(1).max(1000),
  size: z.number().int().min(0).max(1_000_000_000_000_000),
  state: z.enum(["verified", "unverifiable", "failed"]),
  localSha256: z.string().max(64).nullable(),
  localMd5: z.string().max(32).nullable(),
  remoteMd5: z.string().max(32).nullable(),
  shardIndex: z.number().int().min(0).max(500),
  problems: z.array(z.string().max(500)).max(20),
});

const bodySchema = z.object({ items: z.array(itemSchema).min(1).max(MAX_ITEMS_PER_BATCH) });

/**
 * POST /api/transition/jobs/{jobId}/items — a batch of per-file results.
 *
 * The job must already exist AND belong to this user. Creating one implicitly here would
 * let items accumulate against a job nobody can see, and would skip the guid validation
 * the job route performs.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const { jobId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Malformed item batch." }, { status: 400, headers: noStore });
  }

  try {
    const job = await getJob(guard.actor.osfUserId, jobId);
    if (!job) {
      return Response.json({ error: "No such run." }, { status: 404, headers: noStore });
    }
    const saved = await upsertItems(guard.actor.osfUserId, jobId, parsed.data.items);
    return Response.json({ saved }, { headers: noStore });
  } catch (e) {
    console.error(`[transition/jobs/${jobId}/items] failed:`, e);
    return Response.json(
      { error: "Could not save this batch. The transfer itself is unaffected." },
      { status: 503, headers: noStore },
    );
  }
}

/** GET — the per-file evidence for one run, for a resume on a different device. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const { jobId } = await params;
  try {
    const job = await getJob(guard.actor.osfUserId, jobId);
    if (!job) {
      return Response.json({ error: "No such run." }, { status: 404, headers: noStore });
    }
    return Response.json(
      { job, items: await listItems(guard.actor.osfUserId, jobId) },
      { headers: noStore },
    );
  } catch (e) {
    console.error(`[transition/jobs/${jobId}/items] read failed:`, e);
    return Response.json({ error: "Could not read this run." }, { status: 503, headers: noStore });
  }
}

const noStore = { "Cache-Control": "private, no-store" } as const;
