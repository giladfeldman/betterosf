/**
 * Staging files in the Origin Private File System, resumably.
 *
 * Browser-only. OPFS gives disk-backed storage the page can stream into, so a 5 GB file
 * never has to be resident in memory — and a `Blob` taken from an OPFS file can be
 * PUT straight to Zenodo, which works in every browser (unlike `fetch` with a
 * `ReadableStream` body, which needs `duplex: "half"` and is Chromium-only).
 *
 * Downloads are strictly sequential and append-only — see `range.ts` for why. That keeps
 * written coverage contiguous, which removes the class of bug where a resumed file has
 * the right length and the wrong bytes.
 *
 * The hash is computed in a SEPARATE pass over the finished file rather than
 * incrementally during download. That costs one extra disk read and buys correctness
 * across resumes: an incremental hasher's state cannot survive a closed tab, so a resumed
 * file would otherwise be hashed from the wrong starting point.
 */

import { planRange, checkRangeResponse } from "./range";
import { hashStream, type DualDigest } from "./hash";

export type StagedFile = {
  /** OPFS name, derived from the immutable OSF file id — never from a path. */
  handleName: string;
  size: number;
  digest: DualDigest;
  /**
   * What the server SAID the bytes were, carried forward so `verifyFile` can weigh it
   * against the checksum. Null on a resumed file that made no request this time.
   */
  contentType: string | null;
};

export type StageProgress = {
  bytesDone: number;
  totalBytes: number;
  /** Bytes/second over the last window, or null before there is enough to say. */
  bytesPerSecond: number | null;
};

export type StageOptions = {
  url: string;
  /** OSF access token, held in memory only. */
  token: string;
  osfFileId: string;
  declaredSize: number;
  signal?: AbortSignal;
  onProgress?: (p: StageProgress) => void;
  /** Internal: set when retrying from zero after an unverifiable resume. */
  forceRestart?: boolean;
};

export class StagingUnavailableError extends Error {}

/** Is OPFS usable here? Safari and older browsers may not offer it. */
export function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined"
  );
}

async function stagingDir(): Promise<FileSystemDirectoryHandle> {
  if (!opfsAvailable()) {
    throw new StagingUnavailableError(
      "This browser does not provide the private file storage BetterOSF needs to stage large files. " +
        "Try a recent Chrome, Edge or Firefox.",
    );
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("betterosf-transition", { create: true });
}

/**
 * OPFS filename for a file.
 *
 * Keyed by the OSF file id, never the path. Two files can share a name in different
 * folders, and a path can change between runs; the id cannot. This is the same
 * immutable-binding rule the verifier enforces.
 */
export function stagingName(osfFileId: string): string {
  return `f_${osfFileId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** Ask the browser to stop evicting our data under pressure. Best-effort. */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export type QuotaCheck = { ok: true; availableBytes: number } | { ok: false; message: string };

/**
 * Is there room for this file?
 *
 * Checked BEFORE each file rather than once at the start, because the budget changes as
 * files are staged and released. A short write that fails at 90% of a 4 GB download is a
 * much worse experience than a refusal up front.
 */
export async function checkQuota(neededBytes: number): Promise<QuotaCheck> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    // Unknown is not the same as fine, but refusing outright would block browsers that
    // simply do not implement estimate(). Proceed and let a short write fail loudly.
    return { ok: true, availableBytes: Number.POSITIVE_INFINITY };
  }
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const available = Math.max(0, quota - usage);
  // Keep headroom: filling the quota exactly tends to make the browser evict something.
  if (available < neededBytes * 1.1) {
    return {
      ok: false,
      message:
        `Not enough space in this browser's storage: ${formatBytes(neededBytes)} needed, ` +
        `about ${formatBytes(available)} free. Free up disk space, or export in smaller selections.`,
    };
  }
  return { ok: true, availableBytes: available };
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "an unknown amount";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(Math.max(n, 1)) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** How many bytes of this file are already staged. */
export async function stagedSize(osfFileId: string): Promise<number> {
  try {
    const dir = await stagingDir();
    const handle = await dir.getFileHandle(stagingName(osfFileId), { create: false });
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}

export async function discardStaged(osfFileId: string): Promise<void> {
  try {
    const dir = await stagingDir();
    await dir.removeEntry(stagingName(osfFileId));
  } catch {
    /* already gone */
  }
}

/** The staged file as a Blob, for uploading. Disk-backed — not a memory copy. */
export async function stagedBlob(osfFileId: string): Promise<Blob> {
  const dir = await stagingDir();
  const handle = await dir.getFileHandle(stagingName(osfFileId), { create: false });
  return handle.getFile();
}

/**
 * Download a file into OPFS, resuming if part of it is already there, and hash the
 * result.
 *
 * Returns the digest computed over the FINAL staged bytes — which is what the verifier
 * compares against OSF's declared hashes and, later, against what the destination stored.
 */
export async function stageFile(opts: StageOptions): Promise<StagedFile> {
  let contentType: string | null = null;
  const name = stagingName(opts.osfFileId);
  const dir = await stagingDir();

  // An empty URL would `fetch("")`, which resolves against the current page and returns
  // this app's own HTML — caught downstream by the content-type check, but as a confusing
  // "that is an error page" rather than the truth. The plan leaves this empty when OSF
  // described a file without the provider and path a Waterbutler URL needs.
  if (!opts.url) {
    throw new Error(
      "OSF did not say where this file's bytes live, so it cannot be downloaded. It is recorded as failed rather than skipped.",
    );
  }

  let already = opts.forceRestart ? 0 : await stagedSize(opts.osfFileId);
  let decision = opts.forceRestart
    ? planRange(0, opts.declaredSize)
    : planRange(already, opts.declaredSize);

  if (decision.action === "restart") {
    await discardStaged(opts.osfFileId);
    already = 0;
    decision = planRange(0, opts.declaredSize);
  }

  if (decision.action === "resume") {
    const quota = await checkQuota(opts.declaredSize - already);
    if (!quota.ok) throw new Error(quota.message);

    const res = await fetch(opts.url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(decision.from > 0 ? { Range: decision.header } : {}),
      },
      signal: opts.signal,
    });

    if (!res.ok) {
      throw new Error(`OSF returned ${res.status} for this file.`);
    }

    contentType = res.headers.get("content-type");

    const check = checkRangeResponse({
      status: res.status,
      requestedFrom: decision.from,
      contentRange: res.headers.get("content-range"),
      expectedTotal: opts.declaredSize,
    });
    if (!check.ok) {
      // Any doubt about what the server sent means the stage is untrustworthy. Throw it
      // away rather than append to it — a wrong file is worse than a slow one.
      await discardStaged(opts.osfFileId);

      // If the only problem is that the resume could not be VERIFIED, start the file
      // again from zero instead of failing it. Waterbutler's `?direct=` form answers a
      // ranged request with `200` and no `Content-Range` — the bytes are in fact the
      // requested range (measured 2026-08-14), but a server that does not say so cannot
      // be taken at its word. `checkRangeResponse` already said "the transfer restarts
      // instead"; this is the code that makes that sentence true, rather than throwing
      // and failing a file that only needed downloading again.
      if (decision.from > 0) {
        return stageFile({ ...opts, forceRestart: true });
      }
      throw new Error(check.problem);
    }

    const handle = await dir.getFileHandle(name, { create: true });
    // `keepExistingData` + explicit seek is what makes this an APPEND rather than a
    // truncating rewrite. Getting this wrong silently discards the resumed prefix.
    const writable = await handle.createWritable({ keepExistingData: decision.from > 0 });
    try {
      if (decision.from > 0) await writable.seek(decision.from);
      let bytesDone = decision.from;
      const started = Date.now();

      const reader = res.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          await writable.write(value);
          bytesDone += value.byteLength;
          const elapsed = (Date.now() - started) / 1000;
          opts.onProgress?.({
            bytesDone,
            totalBytes: opts.declaredSize,
            bytesPerSecond: elapsed > 1 ? (bytesDone - decision.from) / elapsed : null,
          });
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      await writable.close();
    }
  }

  // Size is checked against OSF's declared value BEFORE hashing. A truncated body that
  // hashed cleanly would otherwise produce a confident digest of the wrong file.
  const file = await (await dir.getFileHandle(name, { create: false })).getFile();
  if (file.size !== opts.declaredSize) {
    throw new Error(
      `Staged ${file.size} bytes but OSF declared ${opts.declaredSize}. The download is incomplete.`,
    );
  }

  const digest = await hashStream(file.stream() as ReadableStream<Uint8Array>);
  if (digest.byteLength !== opts.declaredSize) {
    throw new Error(`Hashed ${digest.byteLength} bytes but expected ${opts.declaredSize}.`);
  }

  return {
    handleName: name,
    size: file.size,
    digest: { md5: digest.md5, sha256: digest.sha256 },
    contentType,
  };
}

/** Remove every staged file. Called when a job finishes or is abandoned. */
export async function clearStaging(): Promise<void> {
  if (!opfsAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("betterosf-transition", { recursive: true });
  } catch {
    /* nothing staged */
  }
}
