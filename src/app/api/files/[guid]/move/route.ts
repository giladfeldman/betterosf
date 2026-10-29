import { z } from "zod";
import { auth } from "@/auth";
import { requireAppUser } from "@/lib/db/require-user";
import { logEventAwaited } from "@/lib/logger";
import { incrementByWindow } from "@/lib/limits";
import {
  OsfWriteError,
  moveDestinationPath,
  moveInOsfStorage,
  requireOsfWriteToken,
  writeErrorResponse,
  type RenameTarget,
} from "@/lib/osf/write";

export const runtime = "nodejs";
// One item per request, one OSF round-trip.
export const maxDuration = 30;

// Same in-memory caveat as the rename and delete routes: a per-lambda speed bump against a
// runaway client loop, not a distributed security control.
const PER_MINUTE = 60;

const bodySchema = z.object({
  provider: z.literal("osfstorage"),
  kind: z.enum(["file", "folder"]),
  // The item's materialized path ("/A/data.csv", "/A/") — used for the into-itself check.
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(1024),
  // The item's own Waterbutler URL. Pinned server-side by resolveMoveUrl.
  moveUrl: z.string().url().max(4096),
  // Parent listing URL — the registration pin, and the "already there" check.
  listingUrl: z.string().url().max(4096),
  // The destination folder's OSF API listing URL. The Waterbutler path is DERIVED from
  // it (moveDestinationPath), pinned to this node and osfstorage.
  destListingUrl: z.string().url().max(4096),
  // The destination's materialized path ("/" or "/B/"), for the into-itself check.
  destPath: z.string().min(1).max(4096),
});

/**
 * Move ONE file/folder to another folder of the same project's OSF Storage (d-f2a1e2).
 * Reversible (move it back) and never overwrites: Waterbutler is asked with
 * `conflict: "warn"`, so a name clash moves nothing.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  try {
    // Gate FIRST — an anonymous or read-only caller must never cause an OSF request.
    const token = await requireOsfWriteToken();
    const appUser = await requireAppUser().catch(() => null);
    const userId = appUser?.ok ? appUser.userId : null;
    const session = await auth().catch(() => null);
    const rateKey = session?.osfUserId ?? null;

    const { guid } = await params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new OsfWriteError(400, "invalid", "That move request was malformed. Refresh the page and try again.");
    }
    const body = parsed.data;

    const destProviderPath = moveDestinationPath(guid, body.destListingUrl);
    if (body.destListingUrl === body.listingUrl) {
      throw new OsfWriteError(400, "invalid", `"${body.name}" is already in that folder.`);
    }
    if (body.kind === "folder") {
      const source = `${body.path.replace(/\/+$/, "")}/`;
      const dest = `${body.destPath.replace(/\/+$/, "")}/`;
      if (dest.startsWith(source)) {
        throw new OsfWriteError(400, "invalid", `A folder cannot be moved inside itself.`);
      }
    }

    if (rateKey) {
      const perMin = await incrementByWindow(`osf:${rateKey}:move:1min`, 1, 60);
      if (perMin > PER_MINUTE) {
        throw new OsfWriteError(429, "upstream", "You have moved a lot of items in a short time. Wait a moment and try again.");
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

    await logEventAwaited(
      "info",
      "move",
      `move requested: "${body.path}" -> "${body.destPath}" on ${guid}`,
      { guid, kind: body.kind, path: body.path, destPath: body.destPath },
      userId,
    );

    const result = await moveInOsfStorage(target, destProviderPath, token);

    await logEventAwaited(
      result.status === "failed" ? "warn" : "info",
      "move",
      `move finished on ${guid}: "${body.path}" -> "${body.destPath}" ${result.status}`,
      { guid, kind: body.kind, path: body.path, destPath: body.destPath, status: result.status, code: result.code ?? null },
      userId,
    );

    return Response.json({ ok: result.status === "moved", result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return writeErrorResponse(e);
  }
}
