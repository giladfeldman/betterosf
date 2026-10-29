import "server-only";
import { auth } from "@/auth";
import { getFolderContents } from "./files";
import {
  OsfWriteError,
  OSF_MAX_FILE_SIZE,
  actionUrl,
  cleanName,
  cleanRenameName,
  mapUploadStatus,
  moveDestinationPath,
  resolveDeleteUrl,
  resolveMoveUrl,
  resolveRenameUrl,
  validateUploadTarget,
  type DeleteTarget,
  type RenameTarget,
  type UploadTarget,
} from "./waterbutler-url";

// Re-export the shared types/helpers so existing server-side imports keep working.
export { OsfWriteError, validateUploadTarget, resolveDeleteUrl, resolveRenameUrl, resolveMoveUrl, moveDestinationPath, cleanRenameName };
export type { UploadTarget, DeleteTarget, RenameTarget };

const MAX_FILE_SIZE = OSF_MAX_FILE_SIZE;

export async function requireOsfWriteToken(): Promise<string> {
  const session = await auth().catch(() => null);
  if (!session?.accessToken) {
    throw new OsfWriteError(401, "unauthorized", "Sign in with OSF to upload files.");
  }
  if (!session.osfCanWrite || session.osfAuthError) {
    // osfAuthError = the OSF connection needs a reconnect (refresh failed / missing
    // refresh token). Matches the /api/osf/upload-token gate so both upload paths
    // reject the reconnect-needed state up front instead of wasting an OSF round-trip.
    throw new OsfWriteError(403, "forbidden", "Enable OSF uploads to grant write access.");
  }
  return session.accessToken;
}

async function ensureNoDuplicate(target: UploadTarget, name: string): Promise<void> {
  const entries = await getFolderContents(target.listingUrl, target.guid);
  if (entries.some((entry) => entry.name === name)) {
    throw new OsfWriteError(409, "conflict", `"${name}" already exists in this folder.`);
  }
}

export async function uploadFileToOsfStorage(
  target: UploadTarget,
  file: File,
  opts: { overwrite?: boolean } = {}
): Promise<unknown> {
  const checked = validateUploadTarget(target);
  const name = cleanName(file.name);
  if (file.size > MAX_FILE_SIZE) {
    throw new OsfWriteError(413, "too_large", "OSF limits uploads to 5 GB per file.");
  }
  const token = await requireOsfWriteToken();
  if (!opts.overwrite) await ensureNoDuplicate(checked, name);
  const res = await fetch(actionUrl(checked, "file", name), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: file,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUploadStatus(res.status, body.slice(0, 500));
  }
  return res.json().catch(() => ({}));
}

export async function createOsfStorageFolder(target: UploadTarget, name: string): Promise<unknown> {
  const checked = validateUploadTarget(target);
  const folderName = cleanName(name);
  const token = await requireOsfWriteToken();
  await ensureNoDuplicate(checked, folderName);
  const res = await fetch(actionUrl(checked, "folder", folderName), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUploadStatus(res.status, body.slice(0, 500));
  }
  return res.json().catch(() => ({}));
}

export type DeleteOutcome = {
  path: string;
  name: string;
  kind: "file" | "folder";
  status: "deleted" | "already_gone" | "failed";
  code?: string;
  message?: string;
};

/**
 * Delete ONE file/folder from OSF Storage.
 *
 * Runs server-side rather than direct-from-browser (unlike uploads). Uploads accept
 * browser token exposure to buy something otherwise impossible — bypassing Vercel's
 * 4.5 MB body limit. A DELETE has a ~0-byte body, so there is no compensating benefit,
 * and a leaked token from a flow the user expects DELETEs from destroys data
 * irreversibly. The registration pin and audit trail also require a server.
 *
 * 404 is reported as `already_gone`, not a failure: the item is absent, which is the
 * requested end state, and it makes retrying a partially-failed batch idempotent.
 */
export async function deleteFromOsfStorage(target: DeleteTarget, token: string): Promise<DeleteOutcome> {
  const base = { path: target.path, name: target.name, kind: target.kind };
  try {
    const url = resolveDeleteUrl(target);
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 204 || res.status === 200) {
      return { ...base, status: "deleted" };
    }
    if (res.status === 404 || res.status === 410) {
      return { ...base, status: "already_gone" };
    }
    const body = await res.text().catch(() => "");
    const mapped = mapUploadStatus(res.status, body.slice(0, 500), "delete");
    return { ...base, status: "failed", code: mapped.code, message: mapped.message };
  } catch (e) {
    if (e instanceof OsfWriteError) {
      return { ...base, status: "failed", code: e.code, message: e.message };
    }
    // Network/DNS/abort — never leak internals to the client.
    console.error("[osf/delete] unexpected error:", e);
    return {
      ...base,
      status: "failed",
      code: "upstream",
      message: "Could not reach OSF to delete this item. It was NOT deleted.",
    };
  }
}

export type RenameOutcome = {
  path: string;
  name: string;
  newName: string;
  kind: "file" | "folder";
  status: "renamed" | "failed";
  code?: string;
  message?: string;
};

/**
 * Rename ONE file/folder in place on OSF Storage (Waterbutler intra-provider move
 * with an unchanged parent): POST to the item's own Waterbutler URL with
 * `{"action": "rename", "rename": "<newName>"}`.
 *
 * Server-side for the same reasons deletes are (see deleteFromOsfStorage): the body
 * is tiny so there is no Vercel-limit benefit to a browser call, and the registration
 * pin + audit trail require a server. Unlike delete, a 404 here is a FAILURE — the
 * item the user pointed at no longer exists, and reporting success would hide that.
 */
export async function renameInOsfStorage(target: RenameTarget, newName: string, token: string): Promise<RenameOutcome> {
  const base = { path: target.path, name: target.name, newName, kind: target.kind };
  try {
    const url = resolveRenameUrl(target);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "rename", rename: newName }),
      cache: "no-store",
    });
    // Waterbutler answers 200 (replaced) or 201 (created) for a successful move/rename.
    if (res.status === 200 || res.status === 201) {
      return { ...base, status: "renamed" };
    }
    if (res.status === 404 || res.status === 410) {
      return {
        ...base,
        status: "failed",
        code: "upstream",
        message: "This item no longer exists on OSF. Refresh the tree and try again.",
      };
    }
    const body = await res.text().catch(() => "");
    const mapped = mapUploadStatus(res.status, body.slice(0, 500), "rename");
    return { ...base, status: "failed", code: mapped.code, message: mapped.message };
  } catch (e) {
    if (e instanceof OsfWriteError) {
      return { ...base, status: "failed", code: e.code, message: e.message };
    }
    // Network/DNS/abort — never leak internals to the client.
    console.error("[osf/rename] unexpected error:", e);
    return {
      ...base,
      status: "failed",
      code: "upstream",
      message: "Could not reach OSF to rename this item. It was NOT renamed.",
    };
  }
}

export function writeErrorResponse(error: unknown): Response {
  if (error instanceof OsfWriteError) {
    // OsfWriteError messages are deliberately user-facing and safe to return.
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  // Unexpected exception — log the detail server-side, return a generic body so
  // we never leak internal strings (stack fragments, upstream URLs) to the client.
  console.error("[osf/write] unexpected error:", error);
  return Response.json({ error: "Upload failed due to an unexpected server error. Please try again.", code: "upstream" }, { status: 500 });
}

export type MoveOutcome = {
  path: string;
  name: string;
  kind: "file" | "folder";
  status: "moved" | "failed";
  code?: string;
  message?: string;
};

/**
 * Move ONE file/folder to another folder in the same project's OSF Storage.
 *
 * `conflict` is always "warn": a same-named item in the destination makes Waterbutler
 * answer 409 and move nothing. "replace" would overwrite that item, and OSF has no trash.
 */
export async function moveInOsfStorage(
  target: RenameTarget,
  destProviderPath: string,
  token: string,
): Promise<MoveOutcome> {
  const base = { path: target.path, name: target.name, kind: target.kind };
  try {
    const url = resolveMoveUrl(target);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "move", path: destProviderPath, conflict: "warn" }),
      cache: "no-store",
    });
    if (res.status === 200 || res.status === 201) return { ...base, status: "moved" };
    if (res.status === 409) {
      return {
        ...base,
        status: "failed",
        code: "conflict",
        message: `Something named "${target.name}" is already in that folder. Nothing was moved. Rename one of them first.`,
      };
    }
    if (res.status === 404 || res.status === 410) {
      return {
        ...base,
        status: "failed",
        code: "upstream",
        message: "This item no longer exists on OSF. Refresh the tree and try again.",
      };
    }
    const body = await res.text().catch(() => "");
    const mapped = mapUploadStatus(res.status, body.slice(0, 500), "move");
    return { ...base, status: "failed", code: mapped.code, message: mapped.message };
  } catch (e) {
    if (e instanceof OsfWriteError) return { ...base, status: "failed", code: e.code, message: e.message };
    console.error("[osf/move] unexpected error:", e);
    return { ...base, status: "failed", code: "upstream", message: "Could not reach OSF to move this item. It was NOT moved." };
  }
}
