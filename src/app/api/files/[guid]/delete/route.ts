import { z } from "zod";
import { auth } from "@/auth";
import { requireAppUser } from "@/lib/db/require-user";
import { logEventAwaited } from "@/lib/logger";
import { incrementByWindow, incrementDailyBy } from "@/lib/limits";
import {
  OsfWriteError,
  deleteFromOsfStorage,
  requireOsfWriteToken,
  writeErrorResponse,
  type DeleteOutcome,
  type DeleteTarget,
} from "@/lib/osf/write";
import { TERMS_VERSION, confirmationMatches, requiresAcknowledgement, type ConfirmationSubject } from "@/lib/terms";

export const runtime = "nodejs";
// Deletes run sequentially (see below); 100 items at OSF latency needs headroom.
export const maxDuration = 120;

/** Half the ZIP-selection route's 200 — each item here is an independent irreversible act. */
const MAX_ITEMS = 100;

// Signed-in requests bypass middleware rate limiting entirely (src/middleware.ts), so the
// cap has to live here. NOTE: Vercel KV is not provisioned, so limits.ts falls back to a
// per-lambda in-memory store. This is a SPEED BUMP against a runaway client loop, NOT a
// security control — the typed confirmation is the real gate. Provisioning KV upgrades it.
const PER_MINUTE_ITEMS = 300;
const PER_DAY_ITEMS = 2000;

const itemSchema = z.object({
  kind: z.enum(["file", "folder"]),
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(1024),
  deleteUrl: z.string().url().max(4096),
  listingUrl: z.string().url().max(4096),
});

const subjectSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("file"), name: z.string().min(1).max(1024) }),
  z.object({ mode: z.literal("folder"), name: z.string().min(1).max(1024), itemCount: z.number().int().nonnegative() }),
  z.object({ mode: z.literal("bulk"), itemCount: z.number().int().nonnegative() }),
]);

const bodySchema = z.object({
  provider: z.literal("osfstorage"),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS),
  confirmationPhrase: z.string().min(1).max(4096),
  acknowledged: z.boolean(),
  subject: subjectSchema,
  termsVersion: z.string().min(1).max(64),
  backupStatus: z.enum(["complete", "incomplete", "skipped", "failed"]).optional(),
  backupDownloaded: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  try {
    // Gate FIRST — before parsing, before any upstream call. An anonymous or read-only
    // caller must never cause a single OSF request.
    const token = await requireOsfWriteToken();
    // system_logs.userId is a FK to users.id (the app row), not the OSF id — resolve it
    // via the same helper the bookmarks/prefs routes use. A missing DB is non-fatal here:
    // the delete still proceeds, the audit row just carries a null user.
    const appUser = await requireAppUser().catch(() => null);
    const userId = appUser?.ok ? appUser.userId : null;
    // Rate-limit on the OSF id, not the app-row id: requireOsfWriteToken has already
    // proven a write-capable OSF session exists, so this is always present. Keying on
    // userId would silently drop the cap whenever the database is unreachable.
    const session = await auth().catch(() => null);
    const rateKey = session?.osfUserId ?? null;

    const { guid } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new OsfWriteError(400, "invalid", "That delete request was malformed. Refresh the page and try again.");
    }
    const body = parsed.data;

    if (body.termsVersion !== TERMS_VERSION) {
      throw new OsfWriteError(
        400,
        "invalid",
        "The deletion terms have been updated. Refresh the page and review them before deleting."
      );
    }

    // Re-derive the expected phrase server-side. The client gate is a UX affordance; THIS
    // is the one that counts, and it is what makes the consent record real evidence rather
    // than a client assertion.
    const subject = body.subject as ConfirmationSubject;
    if (!confirmationMatches(body.confirmationPhrase, subject)) {
      throw new OsfWriteError(400, "invalid", "The confirmation phrase did not match. Nothing was deleted.");
    }
    if (requiresAcknowledgement(subject) && !body.acknowledged) {
      throw new OsfWriteError(400, "invalid", "You must acknowledge that this cannot be undone. Nothing was deleted.");
    }

    const count = body.items.length;
    if (rateKey) {
      const perMin = await incrementByWindow(`osf:${rateKey}:delete:1min`, count, 60);
      const perDay = await incrementDailyBy(`osf:${rateKey}:delete:day`, count);
      if (perMin > PER_MINUTE_ITEMS || perDay > PER_DAY_ITEMS) {
        throw new OsfWriteError(429, "upstream", "You have deleted a lot of files in a short time. Wait a moment and try again.");
      }
    }

    // Consent record, written BEFORE the first destructive call so it exists even if the
    // batch dies midway. Paths are truncated deliberately (logger caps context at 4 KB).
    await logEventAwaited(
      "info",
      "delete",
      `delete requested: ${count} item(s) on ${guid}`,
      {
        guid,
        itemCount: count,
        termsVersion: body.termsVersion,
        confirmationPhrase: body.confirmationPhrase,
        subjectMode: subject.mode,
        acknowledged: body.acknowledged,
        backupStatus: body.backupStatus ?? "unknown",
        backupDownloaded: body.backupDownloaded ?? false,
        paths: body.items.slice(0, 20).map((i) => i.path),
      },
      userId,
    );

    // Sequential, not parallel. Partial-failure semantics are the whole point: under a
    // mid-batch 429 the user's only record of what was actually destroyed is this list,
    // and parallel execution makes that nondeterministic.
    const results: DeleteOutcome[] = [];
    for (const item of body.items) {
      const target: DeleteTarget = {
        guid,
        provider: body.provider,
        kind: item.kind,
        path: item.path,
        name: item.name,
        deleteUrl: item.deleteUrl,
        listingUrl: item.listingUrl,
      };
      results.push(await deleteFromOsfStorage(target, token));
    }

    const deleted = results.filter((r) => r.status === "deleted").length;
    const alreadyGone = results.filter((r) => r.status === "already_gone").length;
    const failed = results.filter((r) => r.status === "failed");

    const summary = `delete finished on ${guid}: ${deleted} deleted, ${alreadyGone} already gone, ${failed.length} failed`;
    const summaryContext = {
      guid,
      deleted,
      alreadyGone,
      failed: failed.length,
      failures: failed.slice(0, 20).map((f) => ({ path: f.path, code: f.code, message: f.message })),
    };
    // Awaited in both cases: the outcome record is the authoritative answer to
    // "what did I actually delete?", and it matters most when something failed.
    await logEventAwaited(failed.length > 0 ? "warn" : "info", "delete", summary, summaryContext, userId);

    // Always report per item. A bare 200 that hides partial failure is the exact trap the
    // ZIP-selection route falls into, and it matters far more when the operation is
    // irreversible.
    return Response.json(
      { ok: failed.length === 0, deleted, alreadyGone, failed: failed.length, results },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return writeErrorResponse(e);
  }
}
