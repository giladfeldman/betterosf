/**
 * Zenodo deposit client — runs IN THE BROWSER.
 *
 * Verified against sandbox.zenodo.org on 2026-08-13, with a real token and a real round
 * trip. Facts the code below depends on, all measured rather than read:
 *
 *   - CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers:
 *     authorization, content-type`, and `PUT` allowed, on `/api/records` AND on
 *     `/api/records/{id}/draft/files/...`. This is why no research byte touches Vercel.
 *   - File keys MAY contain `/`. `sub/dir/nested.txt` declared → PUT → commit returned
 *     `status: completed` with an md5 matching the local one. Deposits keep OSF's folder
 *     structure. **The key must be URL-encoded in the request path** while the stored key
 *     keeps real slashes.
 *   - Multipart upload IS live (not merely on the InvenioRDM roadmap): declaring
 *     `transfer: {type: "M", parts, part_size}` returns per-part URLs. **They expire
 *     after 14 days**, which a long-paused run must handle rather than assume away.
 *   - Limits: 50 GB and 100 files per record; ~100 requests/minute authenticated.
 *
 * Nothing here publishes. Publishing is a separate, explicit, typed-confirmation step —
 * it mints a permanent DOI and cannot be undone.
 */

import { zenodoApiBase, type ZenodoEnv } from "../zenodo-env";
import type { ZenodoMetadata } from "../crosswalk";

/** Above this, use multipart so a dropped connection costs one part, not the file. */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
/** Zenodo's part sizing; 100 MB keeps part counts sane for multi-GB files. */
export const PART_SIZE_BYTES = 100 * 1024 * 1024;

export const ZENODO_MAX_FILES_PER_RECORD = 100;
export const ZENODO_MAX_BYTES_PER_RECORD = 50 * 1024 * 1024 * 1024;

export type ZenodoAuth = { accessToken: string; env: ZenodoEnv };

export class ZenodoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "ZenodoError";
  }
}

export type DraftRecord = {
  id: string;
  links: Record<string, string>;
  /** Populated once a DOI is reserved or the record is published. */
  doi: string | null;
};

async function zfetch(
  auth: ZenodoAuth,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${zenodoApiBase(auth.env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZenodoError(
      `Zenodo returned ${res.status} for ${path}. ${body.slice(0, 400)}`,
      res.status,
      body,
    );
  }
  return res;
}

/** Create a draft. Drafts are private until published and can be deleted. */
export async function createDraft(
  auth: ZenodoAuth,
  metadata: ZenodoMetadata,
  opts: { filesEnabled?: boolean } = {},
): Promise<DraftRecord> {
  const res = await zfetch(auth, "/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access: { record: "public", files: "public" },
      files: { enabled: opts.filesEnabled ?? true },
      metadata,
    }),
  });
  const json = await res.json();
  return { id: String(json.id), links: json.links ?? {}, doi: json.pids?.doi?.identifier ?? null };
}

/**
 * A file key must be URL-encoded in the request path, but the slashes that give the
 * deposit its folder structure must survive — so encode each segment, not the whole key.
 */
export function encodeFileKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export type DeclaredFile = {
  key: string;
  /** "L" = single stream, "M" = multipart. */
  transferType: "L" | "M";
  parts?: { part: number; url: string; expiration: string }[];
  contentUrl?: string;
  commitUrl: string;
};

/**
 * Declare the files a draft will contain.
 *
 * Multipart is chosen per file by size. Below the threshold the extra round trips cost
 * more than a retry would.
 */
export async function declareFiles(
  auth: ZenodoAuth,
  recordId: string,
  files: { key: string; size: number }[],
): Promise<DeclaredFile[]> {
  const payload = files.map((f) =>
    f.size >= MULTIPART_THRESHOLD_BYTES
      ? {
          key: f.key,
          size: f.size,
          transfer: {
            type: "M",
            parts: Math.ceil(f.size / PART_SIZE_BYTES),
            part_size: PART_SIZE_BYTES,
          },
        }
      : { key: f.key },
  );

  const res = await zfetch(auth, `/records/${recordId}/draft/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  const wanted = new Set(files.map((f) => f.key));

  // Zenodo returns EVERY entry on the draft, not just the ones just declared, so filter
  // to what was asked for — otherwise a second batch would re-upload the first.
  return ((json.entries ?? []) as RawEntry[])
    .filter((e) => wanted.has(e.key))
    .map((e) => parseDeclaredFile(e));
}

type RawEntry = {
  key: string;
  transfer?: { type?: string };
  links?: { content?: string; commit?: string; parts?: { part: number; url: string; expiration: string }[] };
};

export function parseDeclaredFile(entry: RawEntry): DeclaredFile {
  return {
    key: entry.key,
    transferType: entry.transfer?.type === "M" ? "M" : "L",
    parts: entry.links?.parts,
    contentUrl: entry.links?.content,
    commitUrl: entry.links?.commit ?? "",
  };
}

/**
 * Have any multipart part URLs expired?
 *
 * Zenodo issues them with a 14-day expiration. A run paused over a holiday and resumed
 * afterwards must re-declare the file rather than PUT to a dead URL — a defined state,
 * not an error to be surprised by.
 */
export function partsExpired(file: DeclaredFile, now: Date): boolean {
  if (!file.parts || file.parts.length === 0) return false;
  return file.parts.some((p) => {
    const t = Date.parse(p.expiration);
    return Number.isFinite(t) && t <= now.getTime();
  });
}

/** Upload a whole file in one streaming PUT. Used below the multipart threshold. */
export async function uploadSingle(
  auth: ZenodoAuth,
  recordId: string,
  key: string,
  body: Blob,
): Promise<void> {
  await zfetch(auth, `/records/${recordId}/draft/files/${encodeFileKey(key)}/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
}

/** Upload one part of a multipart file. Retryable in isolation — that is the point. */
export async function uploadPart(
  auth: ZenodoAuth,
  partUrl: string,
  body: Blob,
): Promise<void> {
  const res = await fetch(partUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ZenodoError(`Zenodo rejected a part upload (${res.status}).`, res.status, text);
  }
}

export type CommitResult = {
  key: string;
  size: number;
  /** Bare hex md5, with Zenodo's "md5:" prefix stripped. */
  md5: string | null;
  status: string;
};

/** Finalise a file. Zenodo returns the checksum of what it actually stored. */
export async function commitFile(
  auth: ZenodoAuth,
  recordId: string,
  key: string,
): Promise<CommitResult> {
  const res = await zfetch(auth, `/records/${recordId}/draft/files/${encodeFileKey(key)}/commit`, {
    method: "POST",
  });
  const json = await res.json();
  return {
    key: String(json.key ?? key),
    size: Number(json.size ?? 0),
    md5: parseChecksum(json.checksum),
    status: String(json.status ?? ""),
  };
}

/** Zenodo reports `"md5:3833d18e…"`; the verifier compares bare hex. */
export function parseChecksum(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^md5:([0-9a-f]{32})$/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** List the files currently on a draft — the independent check that they really landed. */
export async function listDraftFiles(auth: ZenodoAuth, recordId: string): Promise<string[]> {
  const res = await zfetch(auth, `/records/${recordId}/draft/files`);
  const json = await res.json();
  return (json.entries ?? [])
    .filter((e: { status?: string }) => e.status === "completed")
    .map((e: { key: string }) => e.key);
}

/**
 * Publish. Mints a permanent DOI and creates a public record.
 *
 * Called only after a typed confirmation the server re-derives. Nothing in the transfer
 * pipeline calls this on its own.
 */
export async function publishDraft(auth: ZenodoAuth, recordId: string): Promise<DraftRecord> {
  const res = await zfetch(auth, `/records/${recordId}/draft/actions/publish`, { method: "POST" });
  const json = await res.json();
  return { id: String(json.id), links: json.links ?? {}, doi: json.pids?.doi?.identifier ?? null };
}

/** Delete an unpublished draft. Safe: a published record cannot be deleted this way. */
export async function deleteDraft(auth: ZenodoAuth, recordId: string): Promise<void> {
  await zfetch(auth, `/records/${recordId}/draft`, { method: "DELETE" });
}

// ------------------------------------------------------------------ capacity planning

export type CapacityPlan =
  | { fits: true; files: number; bytes: number }
  | { fits: false; reason: string; files: number; bytes: number; recordsNeeded: number };

/**
 * Does this set of files fit in ONE Zenodo record?
 *
 * Computed before anything starts and shown in the preflight, so a researcher is told
 * their 3000-file project will be packaged BEFORE they commit an afternoon to it —
 * rather than discovering it at file 101.
 */
export function planCapacity(files: { size: number }[]): CapacityPlan {
  const bytes = files.reduce((n, f) => n + f.size, 0);
  const count = files.length;

  if (count > ZENODO_MAX_FILES_PER_RECORD) {
    return {
      fits: false,
      reason: `Zenodo allows ${ZENODO_MAX_FILES_PER_RECORD} files per record; this deposit has ${count}. Folders will be packaged into archives.`,
      files: count,
      bytes,
      recordsNeeded: 1,
    };
  }
  if (bytes > ZENODO_MAX_BYTES_PER_RECORD) {
    return {
      fits: false,
      reason: `Zenodo allows ${Math.round(ZENODO_MAX_BYTES_PER_RECORD / 1024 ** 3)} GB per record; this deposit is ${(bytes / 1024 ** 3).toFixed(1)} GB. It will be split across linked records.`,
      files: count,
      bytes,
      recordsNeeded: Math.ceil(bytes / ZENODO_MAX_BYTES_PER_RECORD),
    };
  }
  return { fits: true, files: count, bytes };
}
