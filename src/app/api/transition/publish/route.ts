import { z } from "zod";
import { cookies } from "next/headers";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { getJob, claimPublish } from "@/lib/db/transition-jobs";
import { recordConsent } from "@/lib/db/transition-consents";
import { publishConfirmationPhrase, publishConfirmationMatches } from "@/lib/transition/consent";
import { listDraftFiles, publishDraft, ZenodoError } from "@/lib/transition/targets/zenodo";
import { zenodoEnv, zenodoRecordUrl, zenodoSiteUrl } from "@/lib/transition/zenodo-env";
import { ZENODO_SESSION_COOKIE, readZenodoSession } from "@/lib/transition/zenodo-session";
import { logEventAwaited } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Publishing — the one irreversible act in the toolkit.
 *
 * It mints a permanent DOI and creates a public record that generally cannot be withdrawn.
 * Three properties make that safe to offer at all:
 *
 *   1. **The server re-derives the confirmation phrase.** A client-asserted "they typed
 *      it" is worthless as evidence, and a client-supplied file count would let the phrase
 *      be whatever the client found convenient. The count comes from Zenodo's own listing
 *      of the draft, at the moment of publishing — so a draft that changed since the
 *      dialog opened no longer matches, which is the point of embedding the number.
 *   2. **Only a complete run may publish.** `reconcile()` is the only thing allowed to
 *      call a transfer successful, and a permanent public record of a deposit we KNOW is
 *      missing files is the worst artefact this tool could produce. Someone who genuinely
 *      wants to publish an incomplete deposit can do it in Zenodo's own interface, having
 *      seen the report that says so — we simply will not be the thing that made it easy.
 *
 *      **Be precise about what this proves.** The transfer runs in the browser, so
 *      `job.status` arrives here as a checkpoint the client wrote. It is a safety interlock
 *      against an accidental publish, NOT an authorisation control: a user determined to
 *      publish their own incomplete deposit can forge the checkpoint — or simply press
 *      Publish on zenodo.org, which needs no forgery at all. The record and the account are
 *      theirs. There is no server-side source of truth available for "was this transfer
 *      complete", and claiming otherwise in this comment would be the kind of overstatement
 *      the rest of this module exists to prevent.
 *      (Raised by a Codex review, 2026-08-13.)
 *   3. **The draft must hold at least what the run said it put there.** An independent
 *      cross-check against Zenodo's own listing, which catches a record that was emptied,
 *      partly deleted, or never belonged to this run.
 *   4. **Nothing else calls it.** No pipeline, no retry, no cleanup path publishes.
 */

const bodySchema = z.object({
  jobId: z.string().uuid(),
  recordId: z.string().min(1).max(64),
  typedPhrase: z.string().min(1).max(200),
});

/** GET — what the user must type, derived server-side from the draft's real contents. */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") ?? "";
  const recordId = url.searchParams.get("recordId") ?? "";

  const context = await loadContext(guard.actor.osfUserId, jobId, recordId);
  if ("error" in context) return context.error;

  let fileCount: number;
  try {
    fileCount = (await listDraftFiles(context.auth, recordId)).length;
  } catch (e) {
    return zenodoFailure(e);
  }

  if (fileCount < 1) {
    return Response.json(
      {
        error:
          "This draft has no completed files, so there is nothing to publish. Publishing an empty record would create a permanent citation for nothing.",
        code: "empty_draft",
      },
      { status: 409, headers: noStore },
    );
  }

  return Response.json(
    {
      fileCount,
      phrase: publishConfirmationPhrase({ fileCount }),
      recordId,
      site: zenodoSiteUrl(context.env),
      env: context.env,
      publishable: context.job.status === "complete",
      status: context.job.status,
    },
    { headers: noStore },
  );
}

export async function POST(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Malformed publish request." }, { status: 400, headers: noStore });
  }
  const { jobId, recordId, typedPhrase } = parsed.data;

  const context = await loadContext(guard.actor.osfUserId, jobId, recordId);
  if ("error" in context) return context.error;

  if (context.job.status !== "complete") {
    return Response.json(
      {
        error:
          `This run reconciled as "${context.job.status}", so BetterOSF will not publish it. ` +
          `Read the report, fix what is missing and run the transfer again — the draft is still there and nothing was lost.`,
        code: "run_not_complete",
      },
      { status: 409, headers: noStore },
    );
  }

  // The count comes from the destination, now — never from the client, and never from a
  // number cached when the dialog opened.
  let fileCount: number;
  try {
    fileCount = (await listDraftFiles(context.auth, recordId)).length;
  } catch (e) {
    return zenodoFailure(e);
  }

  if (fileCount < 1) {
    return Response.json(
      { error: "This draft has no completed files, so there is nothing to publish.", code: "empty_draft" },
      { status: 409, headers: noStore },
    );
  }

  // Cross-check the draft against what the run said it put in this record. Both numbers
  // ultimately came from the browser, so this is not proof of a complete transfer — but a
  // draft holding FEWER files than the run recorded means something removed them since,
  // and publishing that permanently is not a thing to do quietly.
  const expected = context.job.records.find((r) => r.recordId === recordId)?.fileCount ?? 0;
  if (fileCount < expected) {
    return Response.json(
      {
        error:
          `This draft now holds ${fileCount} file(s), but the transfer recorded ${expected} for it. ` +
          `Something was removed from the draft after the run. Open it on Zenodo and check before publishing.`,
        code: "draft_shrank",
        fileCount,
        expected,
      },
      { status: 409, headers: noStore },
    );
  }

  if (!publishConfirmationMatches(typedPhrase, { fileCount })) {
    return Response.json(
      {
        error: `That is not the confirmation phrase. Type exactly: ${publishConfirmationPhrase({ fileCount })}`,
        code: "phrase_mismatch",
        phrase: publishConfirmationPhrase({ fileCount }),
        fileCount,
      },
      { status: 409, headers: noStore },
    );
  }

  // Claim the publish BEFORE calling Zenodo. A replayed or double-submitted request loses
  // the claim and is refused here rather than being handed to a service whose behaviour on
  // re-publishing this codebase has never measured. Publishing mints a permanent DOI, so
  // "it probably errors" is not good enough. (Sonnet consult 2026-08-13.)
  let claimed: boolean;
  try {
    claimed = await claimPublish(guard.actor.osfUserId, jobId, recordId, {
      recordId,
      doi: null,
      publishedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[transition/publish] could not claim:", e);
    return Response.json(
      { error: "Could not record this publication, so nothing was published. Try again." },
      { status: 503, headers: noStore },
    );
  }
  if (!claimed) {
    const already = context.job.publishedRecords.find((r) => r.recordId === recordId);
    return Response.json(
      {
        error: "This record has already been published from BetterOSF.",
        code: "already_published",
        recordId,
        doi: already?.doi ?? null,
        url: zenodoRecordUrl(context.env, recordId),
      },
      { status: 409, headers: noStore },
    );
  }

  // Awaited, never fire-and-forget: the record of consent must exist BEFORE the act it
  // authorises. Same rule the delete route follows.
  await recordConsent({
    userId: guard.actor.userId,
    osfUserId: guard.actor.osfUserId,
    scope: "publish",
    jobId,
    typedPhrase,
    itemCount: fileCount,
    userAgent: req.headers.get("user-agent"),
  });

  let published;
  try {
    published = await publishDraft(context.auth, recordId);
  } catch (e) {
    return zenodoFailure(e);
  }

  await logEventAwaited(
    "info",
    "transition",
    "Zenodo record published",
    { jobId, recordId, env: context.env, fileCount, doi: published.doi },
    guard.actor.userId,
  );

  return Response.json(
    {
      recordId: published.id,
      doi: published.doi,
      url: zenodoRecordUrl(context.env, published.id),
      fileCount,
    },
    { headers: noStore },
  );
}

type Context =
  | { error: Response }
  | {
      job: Awaited<ReturnType<typeof getJob>> & object;
      auth: { accessToken: string; env: ReturnType<typeof zenodoEnv> };
      env: ReturnType<typeof zenodoEnv>;
    };

/**
 * Everything the two handlers need, with every ownership check in one place.
 *
 * The record id must be one this run actually created. Without that check, a valid session
 * plus any record id would publish somebody else's draft — or one of this user's own
 * drafts that BetterOSF never made and knows nothing about.
 */
async function loadContext(osfUserId: string, jobId: string, recordId: string): Promise<Context> {
  const env = zenodoEnv();

  let job;
  try {
    job = await getJob(osfUserId, jobId);
  } catch {
    return {
      error: Response.json(
        { error: "Could not read this run." },
        { status: 503, headers: noStore },
      ),
    };
  }
  if (!job) {
    return { error: Response.json({ error: "No such run." }, { status: 404, headers: noStore }) };
  }
  if (!job.records.some((r) => r.recordId === recordId)) {
    return {
      error: Response.json(
        { error: "That record is not part of this run.", code: "record_not_in_job" },
        { status: 403, headers: noStore },
      ),
    };
  }
  if (job.env !== env) {
    // A job created against sandbox must never be published against production, or the
    // reverse. The environments mint entirely different things.
    return {
      error: Response.json(
        {
          error: `This run was made against Zenodo "${job.env}" but BetterOSF is now configured for "${env}".`,
          code: "env_mismatch",
        },
        { status: 409, headers: noStore },
      ),
    };
  }

  const jar = await cookies();
  const session = readZenodoSession(jar.get(ZENODO_SESSION_COOKIE)?.value, {
    osfUserId,
    env,
    now: new Date(),
  });
  if (!session) {
    return {
      error: Response.json(
        { error: `Connect your ${zenodoSiteUrl(env)} account again to publish.`, code: "zenodo_not_connected" },
        { status: 403, headers: noStore },
      ),
    };
  }

  return { job, auth: { accessToken: session.accessToken, env }, env };
}

/** Zenodo's own refusal, passed through rather than replaced with a guess. */
function zenodoFailure(e: unknown): Response {
  if (e instanceof ZenodoError) {
    return Response.json(
      {
        error: `Zenodo refused this (HTTP ${e.status}). ${e.body.slice(0, 300)}`,
        code: "zenodo_error",
        status: e.status,
      },
      { status: 502, headers: noStore },
    );
  }
  console.error("[transition/publish] failed:", e);
  return Response.json(
    { error: "Could not reach Zenodo. Nothing was published." },
    { status: 502, headers: noStore },
  );
}

const noStore = { "Cache-Control": "private, no-store" } as const;
