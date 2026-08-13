/**
 * Streaming MD5 + SHA-256 over data that never fits in memory.
 *
 * `crypto.subtle.digest()` takes a BufferSource — the WHOLE input at once. That is fine
 * for the pre-delete backups in `src/lib/backup/capture.ts`, which are capped at 20 GB
 * across 2000 small files and hashed one `ArrayBuffer` at a time, but it cannot hash a
 * single 5 GB file without holding 5 GB of it. **Do not reuse `capture.ts`'s `sha256()`
 * here.**
 *
 * `hash-wasm` gives incremental hashers that accept chunk after chunk, so a file is
 * hashed as it streams past on its way to disk and is never resident in full.
 *
 * Both digests are computed in ONE pass because they answer different questions: OSF
 * reports sha256 and md5, while Zenodo reports only md5 at commit. Verifying both ends
 * needs both, and re-reading a multi-gigabyte file to get the second one would double
 * the slowest part of the job.
 */

import { createMD5, createSHA256, type IHasher } from "hash-wasm";

export type DualDigest = { md5: string; sha256: string };

/**
 * An incremental two-digest hasher.
 *
 * Usage is deliberately explicit — `update` per chunk, then `digest()` once — so a caller
 * cannot accidentally finalise early and get a hash of a prefix.
 */
export class DualHasher {
  private constructor(
    private readonly md5: IHasher,
    private readonly sha256: IHasher,
    private bytes = 0,
    private finalised = false,
  ) {}

  static async create(): Promise<DualHasher> {
    const [md5, sha256] = await Promise.all([createMD5(), createSHA256()]);
    md5.init();
    sha256.init();
    return new DualHasher(md5, sha256);
  }

  update(chunk: Uint8Array): void {
    if (this.finalised) {
      // Silently ignoring this would produce a digest that omits real bytes — a hash
      // that looks fine and describes a prefix of the file.
      throw new Error("DualHasher.update called after digest()");
    }
    this.md5.update(chunk);
    this.sha256.update(chunk);
    this.bytes += chunk.byteLength;
  }

  /** Total bytes fed in — cross-checked against the declared size by the verifier. */
  get byteLength(): number {
    return this.bytes;
  }

  digest(): DualDigest {
    this.finalised = true;
    return { md5: this.md5.digest("hex"), sha256: this.sha256.digest("hex") };
  }
}

/**
 * Hash a whole stream, returning the digests and the byte count.
 *
 * The byte count is returned rather than assumed: it is what lets the caller assert the
 * number of bytes hashed equals the number OSF declared, which is the check that catches
 * a truncated body that still parsed cleanly.
 */
export async function hashStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (bytes: number) => void,
): Promise<DualDigest & { byteLength: number }> {
  const hasher = await DualHasher.create();
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        hasher.update(value);
        onProgress?.(hasher.byteLength);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { ...hasher.digest(), byteLength: hasher.byteLength };
}

/** Hash bytes already in memory. For manifests and small side-car files only. */
export async function hashBytes(bytes: Uint8Array): Promise<DualDigest> {
  const hasher = await DualHasher.create();
  hasher.update(bytes);
  return hasher.digest();
}

/** Hash a UTF-8 string. Used for the generated manifest and metadata files. */
export async function hashText(text: string): Promise<DualDigest> {
  return hashBytes(new TextEncoder().encode(text));
}
