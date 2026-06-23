// Browser-side direct upload to OSF Waterbutler.
//
// File bytes PUT straight from the browser to `files.osf.io`, bypassing Vercel's
// 4.5 MB function-body limit so uploads of any size (up to OSF's 5 GB/file) succeed
// and never silently fail. Folder listing + folder creation stay on the server
// routes (small payloads), so the OSF access token is only ever needed in the
// browser for the file-bytes PUT.
//
// Token handling: fetched on demand from /api/osf/upload-token, cached in memory
// only for the active batch (never localStorage/cookie), pinned to files.osf.io
// via the shared `actionUrl` validation, and cleared after the batch.

import {
  OsfWriteError,
  OSF_MAX_FILE_SIZE,
  actionUrl,
  cleanName,
  mapUploadStatus,
  validateUploadTarget,
  type UploadTarget,
} from "@/lib/osf/waterbutler-url";
import type { FileEntry } from "@/lib/osf/files";

type CachedToken = { token: string; expiresAt: number | null };

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

/** Refetch when within this margin of expiry so a long upload doesn't 401 mid-stream. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function tokenStillFresh(c: CachedToken): boolean {
  if (c.expiresAt == null) return true; // unknown expiry: trust until a 401 forces a refetch
  return Date.now() < c.expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

async function fetchUploadToken(): Promise<CachedToken> {
  const res = await fetch("/api/osf/upload-token", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const code = body.code === "unauthorized" ? "unauthorized" : "forbidden";
    const status = res.status === 401 ? 401 : 403;
    throw new OsfWriteError(status, code, String(body.error ?? "Could not authorize this upload."));
  }
  const data = (await res.json()) as { token: string; expiresAt: number | null };
  return { token: data.token, expiresAt: data.expiresAt ?? null };
}

/** Get the OSF access token for direct upload, caching it in memory for the batch. */
export async function getUploadToken(opts: { force?: boolean } = {}): Promise<string> {
  if (!opts.force && cached && tokenStillFresh(cached)) return cached.token;
  if (opts.force) {
    cached = null;
    inflight = null;
  }
  if (!inflight) {
    inflight = fetchUploadToken().then(
      (c) => { cached = c; inflight = null; return c; },
      (e) => { inflight = null; throw e; }
    );
  }
  return (await inflight).token;
}

/** Drop the in-memory token. Call after an upload batch finishes (success or fail). */
export function clearUploadToken(): void {
  cached = null;
  inflight = null;
}

async function existingNames(guid: string, listingUrl: string): Promise<Set<string>> {
  const res = await fetch(`/api/files/${guid}/folder?` + new URLSearchParams({ listingUrl, fresh: "1" }), { cache: "no-store" });
  if (!res.ok) {
    const e = new Error(await res.text().catch(() => "Could not read folder")) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  const data = (await res.json()) as { entries: FileEntry[] };
  return new Set(data.entries.map((entry) => entry.name));
}

async function putBytes(url: string, file: File): Promise<void> {
  const send = (token: string) => fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: file,
    cache: "no-store",
  });
  let res = await send(await getUploadToken());
  // Token may have expired mid-batch (large GB upload): refetch once and retry.
  if (res.status === 401) {
    res = await send(await getUploadToken({ force: true }));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUploadStatus(res.status, body.slice(0, 500));
  }
}

/**
 * Upload one file's bytes directly to OSF Waterbutler from the browser.
 * Drop-in replacement for the server `uploadFileToOsfStorage` (and the old
 * POST /api/files/[guid]/upload proxy), with identical validation + error mapping.
 */
export async function uploadFileDirect(
  target: UploadTarget,
  file: File,
  opts: { overwrite?: boolean } = {}
): Promise<void> {
  const checked = validateUploadTarget(target);
  const name = cleanName(file.name);
  if (file.size > OSF_MAX_FILE_SIZE) {
    throw new OsfWriteError(413, "too_large", "OSF limits uploads to 5 GB per file.");
  }
  // Mirror the server's duplicate guard so a manual upload never silently overwrites.
  // The orchestrated path passes overwrite=true once it has resolved the conflict.
  if (!opts.overwrite) {
    const names = await existingNames(checked.guid, checked.listingUrl);
    if (names.has(name)) {
      throw new OsfWriteError(409, "conflict", `"${name}" already exists in this folder.`);
    }
  }
  await putBytes(actionUrl(checked, "file", name), file);
}
