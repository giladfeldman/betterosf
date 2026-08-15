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
 * Create the draft that IS a new version of an already-published record.
 *
 * Measured against sandbox.zenodo.org on 2026-08-14: `POST /api/records/{id}/versions`
 * returns **201** with a fresh draft id, and the new draft starts with **zero files**
 * (`GET /records/{new}/draft/files` → `entries: []`). Zenodo offers
 * `POST /records/{new}/draft/actions/files-import` to copy the previous version's files
 * across — **BetterOSF deliberately never calls it.** A transfer is uploading its own
 * verified copy of every file; importing the old version's would consume file slots with
 * bytes this run never checked, and then the deposit would hold two states of the project
 * with no way to tell them apart.
 *
 * A Zenodo *version* means a revision of the SAME work. It is the right verb for "the data
 * changed since I deposited it" and the wrong one for "this is a different project" or
 * "this is part 2 of a split deposit" — the latter is what `IsPartOf` sharding is for. The
 * UI only offers this when the user has explicitly identified a prior record as the same
 * work.
 */
export async function createNewVersion(
  auth: ZenodoAuth,
  publishedRecordId: string,
): Promise<DraftRecord> {
  const res = await zfetch(auth, `/records/${publishedRecordId}/versions`, { method: "POST" });
  const json = await res.json();
  return { id: String(json.id), links: json.links ?? {}, doi: json.pids?.doi?.identifier ?? null };
}

export type ZenodoCommunity = {
  id: string;
  slug: string;
  title: string;
  url: string;
  /** "open" = anyone may submit; "closed"/"restricted" = members only. */
  submissionPolicy: string;
  /** "open" = published on submission; otherwise a curator decides. */
  reviewPolicy: string;
};

/**
 * Search Zenodo's communities.
 *
 * Anonymous and `Access-Control-Allow-Origin: *` (measured 2026-08-14), so the browser can
 * call it without a token — but the auth header is sent anyway when we have one, since a
 * signed-in search also surfaces communities the user belongs to.
 */
export async function searchCommunities(
  auth: ZenodoAuth,
  query: string,
  size = 10,
): Promise<ZenodoCommunity[]> {
  const res = await zfetch(auth, `/communities?q=${encodeURIComponent(query)}&size=${size}`);
  const json = await res.json();
  return ((json.hits?.hits ?? []) as RawCommunity[])
    .filter((c) => typeof c.id === "string" && typeof c.slug === "string")
    .map((c) => ({
      id: String(c.id),
      slug: String(c.slug),
      title: String(c.metadata?.title ?? c.slug),
      url: String(c.links?.self_html ?? ""),
      submissionPolicy: String(c.access?.record_submission_policy ?? "unknown"),
      reviewPolicy: String(c.access?.review_policy ?? "unknown"),
    }));
}

type RawCommunity = {
  id?: string;
  slug?: string;
  metadata?: { title?: string };
  links?: { self_html?: string };
  access?: { record_submission_policy?: string; review_policy?: string };
};

/**
 * Ask a community to take this record, as a `community-submission` review request.
 *
 * **Two measured consequences the caller MUST handle** (sandbox.zenodo.org, 2026-08-14):
 *
 *   1. Once a review request exists, `POST /draft/actions/publish` returns **400 — "You
 *      cannot publish a draft with an open review request. Please cancel the review request
 *      first."** Community and direct publish are alternative paths, not additive ones.
 *   2. `POST /draft/actions/submit-review` returns 202 and the record is **not published**;
 *      it waits for the community to accept. `GET /records/{id}` stayed 404 afterwards.
 *
 * So attaching a community is a *request*, and the transfer never submits it. The files
 * still landed and still verify; the community's answer is a separate, later, human event
 * that must never be able to read as a failed transfer.
 */
export async function requestCommunityReview(
  auth: ZenodoAuth,
  recordId: string,
  communityId: string,
): Promise<void> {
  await zfetch(auth, `/records/${recordId}/draft/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receiver: { community: communityId }, type: "community-submission" }),
  });
}

export type ZenodoUserRecord = {
  id: string;
  title: string;
  /** "draft" or "published", straight from Zenodo's own listing. */
  status: string;
  doi: string | null;
  updated: string;
  url: string;
};

/**
 * The user's own records — drafts (`published: false`) or published ones.
 *
 * ⚠️ **This is a SEARCH INDEX, and it lags.** A draft created seconds earlier returned
 * `total: 0`, and the same query a few seconds later returned it (measured 2026-08-14). It
 * is fine for "pick one of your existing deposits" and useless as a source of truth about
 * what a record currently holds: the same listing reported `files.count: 0` for a draft
 * that demonstrably had a committed file. **Never seed a capacity plan from this** — ask
 * `listDraftFileEntries` instead.
 */
export async function listUserRecords(
  auth: ZenodoAuth,
  opts: { published: boolean; size?: number },
): Promise<ZenodoUserRecord[]> {
  const res = await zfetch(
    auth,
    `/user/records?is_published=${opts.published ? "true" : "false"}&size=${opts.size ?? 25}&sort=newest`,
  );
  const json = await res.json();
  return ((json.hits?.hits ?? []) as RawUserRecord[])
    .filter((h) => h.id !== undefined && h.id !== null)
    .map((h) => ({
      id: String(h.id),
      title: String(h.metadata?.title ?? "(untitled)"),
      status: String(h.status ?? ""),
      doi: h.pids?.doi?.identifier ? String(h.pids.doi.identifier) : null,
      updated: String(h.updated ?? ""),
      url: String(h.links?.self_html ?? ""),
    }));
}

type RawUserRecord = {
  id?: string | number;
  status?: string;
  updated?: string;
  metadata?: { title?: string };
  pids?: { doi?: { identifier?: string } };
  links?: { self_html?: string };
};

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

export type DraftFileEntry = {
  key: string;
  /** "completed" once committed; "pending" while declared but not yet committed. */
  status: string;
  /**
   * Bytes Zenodo says it holds, or `null` when it did not say.
   *
   * Null rather than 0: a missing size coerced to zero is an unknown wearing the costume
   * of a fact, and it would satisfy a resume's `size === file.size` check for any
   * genuinely empty file. (Codex consult 2026-08-13.)
   */
  size: number | null;
  /** Bare hex md5, or null when Zenodo reported none (a pending entry has none). */
  md5: string | null;
};

/**
 * Every file entry on a draft, with the state Zenodo believes it is in.
 *
 * This is what makes a resumed run safe. A file that is already `completed` with a
 * checksum matching what we hold locally does not need re-uploading; one that is
 * `pending` was declared and never committed, and must be redone. Deciding that from our
 * own notes alone would trust a record of the past over the destination's account of the
 * present.
 */
export async function listDraftFileEntries(
  auth: ZenodoAuth,
  recordId: string,
): Promise<DraftFileEntry[]> {
  const res = await zfetch(auth, `/records/${recordId}/draft/files`);
  const json = await res.json();
  return ((json.entries ?? []) as { key?: string; status?: string; size?: number; checksum?: unknown }[])
    .filter((e) => typeof e.key === "string")
    .map((e) => ({
      key: String(e.key),
      status: String(e.status ?? ""),
      size: typeof e.size === "number" && Number.isFinite(e.size) ? e.size : null,
      md5: parseChecksum(e.checksum),
    }));
}

/** List the files currently on a draft — the independent check that they really landed. */
export async function listDraftFiles(auth: ZenodoAuth, recordId: string): Promise<string[]> {
  const entries = await listDraftFileEntries(auth, recordId);
  return entries.filter((e) => e.status === "completed").map((e) => e.key);
}

/**
 * Replace a draft's metadata.
 *
 * **The body must be `{metadata}` alone.** Measured against sandbox.zenodo.org on
 * 2026-08-13: `PUT` with the record object echoed back from `GET .../draft` returns a
 * **500** (Invenio rejects the read-only fields it just sent you), while `{metadata}` — or
 * `{metadata, access, files}` — returns 200 and the change is visible on a subsequent GET.
 * Do not "improve" this by round-tripping the full record.
 *
 * Used to link shard records to each other once every shard id is known.
 */
export async function updateDraftMetadata(
  auth: ZenodoAuth,
  recordId: string,
  metadata: ZenodoMetadata,
): Promise<void> {
  await zfetch(auth, `/records/${recordId}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata }),
  });
}

/**
 * The serialization that round-trips. **Not the default.**
 *
 * `GET /records/{id}/draft` with no `Accept` (or `application/json`) answers in Zenodo's
 * LEGACY deposit shape: `access_right`, `creators: [{name, affiliation}]`,
 * `related_identifiers: [{relation: "isIdenticalTo"}]` — and **no `publisher` and no
 * `rights` at all**. Reading that and PUTting it back is silently destructive: measured on
 * 2026-08-14, one such round trip erased `publisher`, `description` and the
 * `isidenticalto` relation while returning a cheerful 200.
 *
 * `application/vnd.inveniordm.v1+json` returns the real RDM shape, and the same round trip
 * measured LOSSLESS across title, publisher, description, creators, ORCID, subjects,
 * rights and relations.
 */
const RDM_JSON = "application/vnd.inveniordm.v1+json";

/**
 * Add related identifiers to a draft **without authoring the rest of its metadata**.
 *
 * Needed because a deposit can now land in a draft BetterOSF did not create — one the user
 * picked, or one inherited from a published record as a new version. Those carry metadata
 * a researcher curated, and replacing it with a fresh crosswalk of the OSF project would
 * quietly undo their edits. Sibling shard links still have to get on there.
 *
 * Verifies the merge by reading the draft back: if a field we did not intend to touch
 * changed, that is reported to the caller rather than left for someone to find on a
 * published record. Returns null on success, or the reason it could not be done safely.
 */
export async function appendRelatedIdentifiers(
  auth: ZenodoAuth,
  recordId: string,
  additions: ZenodoRelatedIdentifierInput[],
): Promise<string | null> {
  if (additions.length === 0) return null;

  const before = await readDraftMetadata(auth, recordId);
  const existing = new Set(
    ((before.related_identifiers ?? []) as { identifier?: string }[]).map((r) => String(r.identifier)),
  );
  const fresh = additions.filter((a) => !existing.has(a.identifier));
  if (fresh.length === 0) return null;

  const merged = {
    ...before,
    related_identifiers: [...((before.related_identifiers as unknown[]) ?? []), ...fresh],
  };
  await zfetch(auth, `/records/${recordId}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata: merged }),
  });

  const after = await readDraftMetadata(auth, recordId);
  const drift = describeMetadataDrift(before, after);
  if (drift) {
    return `Adding the sibling links to record ${recordId} changed its metadata unexpectedly (${drift}). Check the draft before publishing.`;
  }
  const landed = new Set(
    ((after.related_identifiers ?? []) as { identifier?: string }[]).map((r) => String(r.identifier)),
  );
  const missing = fresh.filter((f) => !landed.has(f.identifier));
  if (missing.length > 0) {
    return `Zenodo accepted the update to record ${recordId} but did not store ${missing.length} of the sibling links.`;
  }
  return null;
}

export type ZenodoRelatedIdentifierInput = {
  identifier: string;
  scheme: string;
  relation_type: { id: string };
};

/** Read a draft's metadata in the shape that survives being written back. */
export async function readDraftMetadata(
  auth: ZenodoAuth,
  recordId: string,
): Promise<Record<string, unknown>> {
  const res = await zfetch(auth, `/records/${recordId}/draft`, { headers: { Accept: RDM_JSON } });
  const json = await res.json();
  return (json.metadata ?? {}) as Record<string, unknown>;
}

/**
 * Did anything OTHER than related identifiers change across the merge?
 *
 * Deliberately compares the fields a researcher would notice on a published record rather
 * than deep-equalling the whole object: Zenodo expands vocabularies with localised titles
 * on read, so a deep comparison would report drift on every successful call.
 */
export function describeMetadataDrift(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string | null {
  const changed: string[] = [];
  for (const key of ["title", "publisher", "description", "publication_date"]) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changed.push(key);
  }
  const count = (v: unknown) => (Array.isArray(v) ? v.length : v == null ? 0 : 1);
  for (const key of ["creators", "subjects", "rights"]) {
    if (count(before[key]) !== count(after[key])) changed.push(key);
  }
  return changed.length > 0 ? changed.join(", ") : null;
}

/** Delete one declared-but-unwanted file entry from a draft. */
export async function deleteDraftFile(
  auth: ZenodoAuth,
  recordId: string,
  key: string,
): Promise<void> {
  await zfetch(auth, `/records/${recordId}/draft/files/${encodeFileKey(key)}`, { method: "DELETE" });
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

export type ShardLimits = { maxFiles: number; maxBytes: number };

export type ShardPlan<T> = {
  /** One entry per record that will be created, in order. Never empty unless there is nothing to send. */
  shards: T[][];
  /** Files that fit in NO record, with the reason. Reported; never silently dropped. */
  unplaceable: { file: T; reason: string }[];
};

/**
 * Split a deposit across as many Zenodo records as its caps require.
 *
 * **The decision, made 2026-08-13:** a project that exceeds 100 files or 50 GB becomes
 * SEVERAL linked records — not archives, and never Zenodo *versions* (a version means a
 * revision of the same work, which would be a false statement about the data).
 *
 * Linked records over archive-per-subtree, because the toolkit's entire claim is per-file
 * verification: zipping a folder replaces 400 checksums that can each be compared against
 * OSF with one checksum of a container OSF never held. The cost is N records instead of
 * one, and N DOIs if published — stated in the preflight before anything starts. The
 * records are tied together with DataCite `HasPart`/`IsPartOf`, which is what that
 * vocabulary is actually for.
 *
 * Input order is preserved rather than optimised. The plan comes from a depth-first walk,
 * so keeping the order keeps folders together; repacking for tighter fits would scatter a
 * directory across records and make a resumed run's shard assignment unstable.
 */
export function planShards<T extends { path: string; size: number }>(
  files: T[],
  limits: ShardLimits = { maxFiles: ZENODO_MAX_FILES_PER_RECORD, maxBytes: ZENODO_MAX_BYTES_PER_RECORD },
  /**
   * What the FIRST record already holds, when the deposit is being added to an existing
   * draft rather than a fresh one.
   *
   * Seeded from `listDraftFileEntries`, never from the search listing — that reported
   * `files.count: 0` for a draft with a committed file (measured 2026-08-14). Assuming an
   * empty record here is how a run discovers Zenodo's 100-file cap at file 101, with the
   * first hundred already uploaded.
   */
  occupied: { files: number; bytes: number } = { files: 0, bytes: 0 },
): ShardPlan<T> {
  const shards: T[][] = [];
  const unplaceable: { file: T; reason: string }[] = [];
  let current: T[] = [];
  // The first record starts partly full. Every later one starts empty, so these are reset
  // to zero at each shard boundary below.
  let currentBytes = Math.max(0, occupied.bytes);
  let currentFiles = Math.max(0, occupied.files);

  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size < 0) {
      // An unknown size cannot be planned around. Saying "it fits" would be inventing a
      // fact; putting it somewhere and hoping would surface at upload time as a rejected
      // record halfway through a run.
      unplaceable.push({
        file,
        reason: `OSF reported no usable size for this file (${file.size}), so it cannot be fitted to a record.`,
      });
      continue;
    }
    if (file.size > limits.maxBytes) {
      unplaceable.push({
        file,
        reason: `This single file is ${(file.size / 1024 ** 3).toFixed(1)} GB, larger than Zenodo's ${Math.round(limits.maxBytes / 1024 ** 3)} GB per-record limit.`,
      });
      continue;
    }

    const wouldExceed =
      currentFiles + 1 > limits.maxFiles || currentBytes + file.size > limits.maxBytes;
    if (wouldExceed) {
      // Pushed even when `current` is EMPTY, which happens only for an anchor draft that
      // was already too full to take a single file. An empty leading shard is the honest
      // representation of "the draft you picked has no room" — `firstShardIsFull` below
      // turns it into a refusal in the preflight, rather than a silent extra record.
      shards.push(current);
      current = [];
      currentBytes = 0;
      currentFiles = 0;
    }
    current.push(file);
    currentBytes += file.size;
    currentFiles += 1;
  }

  if (current.length > 0) shards.push(current);
  return { shards, unplaceable };
}

/**
 * Did the chosen anchor draft have no room at all?
 *
 * `planShards` says so by emitting an empty first shard. Callers turn that into "pick a
 * different draft" before anything is uploaded.
 */
export function firstShardIsFull<T>(plan: ShardPlan<T>): boolean {
  return plan.shards.length > 0 && plan.shards[0]!.length === 0;
}

/**
 * How much of a record the files already on it consume, for seeding `planShards`.
 *
 * Keys that our own run is going to write are NOT counted: Waterbutler-sourced paths are
 * stable, so re-sending `osfstorage/data.csv` REPLACES the entry rather than adding a
 * second one, and counting it twice would shard a deposit that fits.
 */
export function occupancyExcluding(
  entries: { key: string; size: number | null }[],
  ourKeys: Iterable<string>,
): { files: number; bytes: number; unsizedFiles: number } {
  const ours = new Set(ourKeys);
  let files = 0;
  let bytes = 0;
  let unsizedFiles = 0;
  for (const e of entries) {
    if (ours.has(e.key)) continue;
    files += 1;
    if (typeof e.size === "number" && Number.isFinite(e.size)) {
      bytes += e.size;
    } else {
      // A size Zenodo did not report is NOT zero, and pretending otherwise makes the byte
      // plan optimistic by an unknown amount. It is counted separately and surfaced, so
      // the preflight can say the byte figure is a lower bound rather than a fact.
      unsizedFiles += 1;
    }
  }
  return { files, bytes, unsizedFiles };
}

/**
 * Sibling links for one shard: `IsPartOf` every other record in the set.
 *
 * Emitted only when there is more than one record — a lone deposit that declared itself
 * part of a set of one would be a puzzle rather than a fact.
 */
export function shardRelatedIdentifiers(
  recordUrls: string[],
  selfIndex: number,
): { identifier: string; scheme: string; relation_type: { id: string } }[] {
  if (recordUrls.length < 2) return [];
  return recordUrls
    .map((identifier, i) => ({ identifier, i }))
    .filter(({ i }) => i !== selfIndex)
    .map(({ identifier }) => ({
      identifier,
      scheme: "url",
      // "ispartof" both ways: every shard is part of the same deposit, and no shard is the
      // privileged whole. Nominating one as the parent would make the others look like
      // supplements to it.
      relation_type: { id: "ispartof" },
    }));
}

/**
 * A cheap authenticated call, made BEFORE a transfer starts.
 *
 * It exists to turn an opaque failure into a diagnosis. A browser that cannot reach
 * zenodo.org reports only `TypeError: NetworkError when attempting to fetch resource` —
 * no host, no status, no clue — and if that arrives at file 1 of 79 after the drafts were
 * created, the researcher is left with litter in their Zenodo account and no idea why.
 *
 * Distinguishes the three things it can be, which need three different responses:
 *   - `unreachable` — the request never completed. Nothing to do with credentials: an
 *     extension, a VPN, a corporate proxy or an offline machine.
 *   - `rejected`    — Zenodo answered, and said no. The token is wrong, expired or revoked.
 *   - `ok`          — reachable and authenticated.
 */
export type ZenodoReachability =
  | { ok: true }
  | { ok: false; kind: "unreachable"; detail: string }
  | { ok: false; kind: "rejected"; status: number; detail: string };

export async function checkZenodoReachable(auth: ZenodoAuth): Promise<ZenodoReachability> {
  let res: Response;
  try {
    res = await fetch(`${zenodoApiBase(auth.env)}/user/records?size=1`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
  } catch (e) {
    return {
      ok: false,
      kind: "unreachable",
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
  if (res.ok) return { ok: true };
  return {
    ok: false,
    kind: "rejected",
    status: res.status,
    detail: (await res.text().catch(() => "")).slice(0, 200),
  };
}
