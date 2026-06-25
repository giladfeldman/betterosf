import "server-only";
import { auth } from "@/auth";
import { getFolderContents } from "./files";
import {
  OsfWriteError,
  OSF_MAX_FILE_SIZE,
  actionUrl,
  cleanName,
  mapUploadStatus,
  validateUploadTarget,
  type UploadTarget,
} from "./waterbutler-url";

// Re-export the shared types/helpers so existing server-side imports keep working.
export { OsfWriteError, validateUploadTarget };
export type { UploadTarget };

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
