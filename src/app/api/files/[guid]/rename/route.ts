import { z } from "zod";
import { auth } from "@/auth";
import { requireAppUser } from "@/lib/db/require-user";
import { logEventAwaited } from "@/lib/logger";
import { incrementByWindow } from "@/lib/limits";
import {
  OsfWriteError,
  cleanRenameName,
  renameInOsfStorage,
  requireOsfWriteToken,
  writeErrorResponse,
  type RenameTarget,
} from "@/lib/osf/write";

export const runtime = "nodejs";
// One item per request, one OSF round-trip — the default 30s is plenty, set explicitly.
export const maxDuration = 30;

// Same in-memory caveat as the delete route: Vercel KV is not provisioned, so this is a
// per-lambda speed bump against a runaway client loop, not a distributed security control.
const PER_MINUTE = 60;

const bodySchema = z.object({
  provider: z.literal("osfstorage"),
  kind: z.enum(["file", "folder"]),
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(1024),
  newName: z.string().min(1).max(1024),
  // The item's own Waterbutler URL, from OSF's links (identical under links.move and
  // links.delete). Pinned server-side by resolveRenameUrl — never called as supplied.
  moveUrl: z.string().url().max(4096),
  // Parent listing URL — carried purely for the registration pin.
  listingUrl: z.string().url().max(4096),
});

/**
 * Rename ONE file/folder in place on OSF Storage. Non-destructive by construction:
 * the only Waterbutler call issued is `{"action":"rename"}` against a pinned
 * *.osf.io URL, so the file's identity, history, and download links survive.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> }
): Promise<Response> {
  try {
    // Gate FIRST — before parsing, before any upstream call. An anonymous or read-only
    // caller must never cause a single OSF request.
    const token = await requireOsfWriteToken();
    // Audit rows carry the app user id when the DB is reachable; a missing DB is
    // non-fatal (matches the delete route).
    const appUser = await requireAppUser().catch(() => null);
    const userId = appUser?.ok ? appUser.userId : null;
    // Rate-limit on the OSF id — always present once requireOsfWriteToken passed.
    const session = await auth().catch(() => null);
    const rateKey = session?.osfUserId ?? null;

    const { guid } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new OsfWriteError(400, "invalid", "That rename request was malformed. Refresh the page and try again.");
    }
    const body = parsed.data;

    const newName = cleanRenameName(body.newName);
    if (newName === body.name) {
      throw new OsfWriteError(400, "invalid", "The new name is the same as the current name.");
    }

    if (rateKey) {
      const perMin = await incrementByWindow(`osf:${rateKey}:rename:1min`, 1, 60);
      if (perMin > PER_MINUTE) {
        throw new OsfWriteError(429, "upstream", "You have renamed a lot of items in a short time. Wait a moment and try again.");
      }
    }

    const target: RenameTarget = {
      guid,
      provider: body.provider,
      kind: body.kind,
      path: body.path,
      name: body.name,
      moveUrl: body.moveUrl,
      listingUrl: body.listingUrl,
    };

    // Audit row BEFORE the OSF call, so the intent is recorded even if the request dies
    // midway. Rename is reversible (rename back), but the trail matters for support.
    await logEventAwaited(
      "info",
      "rename",
      `rename requested: "${body.name}" -> "${newName}" on ${guid}`,
      { guid, kind: body.kind, path: body.path, name: body.name, newName },
      userId,
    );

    const result = await renameInOsfStorage(target, newName, token);

    await logEventAwaited(
      result.status === "failed" ? "warn" : "info",
      "rename",
      `rename finished on ${guid}: "${body.name}" -> "${newName}" ${result.status}`,
      { guid, kind: body.kind, path: body.path, status: result.status, code: result.code ?? null, message: result.message ?? null },
      userId,
    );

    return Response.json(
      { ok: result.status === "renamed", result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return writeErrorResponse(e);
  }
}
