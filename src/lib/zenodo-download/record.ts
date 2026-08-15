/**
 * Read a PUBLIC Zenodo record and rebuild the folder tree its file keys encode.
 *
 * Zenodo has no folders. It stores a file key verbatim and its UI renders the key as a flat
 * filename that happens to contain slashes — so an 80-file BetterOSF deposit shows as 80
 * rows of `osfstorage/PCIRR Stage 1/…/Arkes-1996-….docx`. Faithful, and unreadable.
 *
 * Everything needed to undo that is already in the deposit, so this works for **any**
 * record whose keys contain paths, not only the ones BetterOSF created.
 *
 * Runs entirely in the browser against public endpoints. Measured 2026-08-14 on both
 * zenodo.org and sandbox.zenodo.org: `GET /api/records/{id}`, `GET /api/records/{id}/files`
 * and each entry's `links.content` all answer anonymously with
 * `Access-Control-Allow-Origin: *`. No token, no account, no server.
 */

import { safeEntryPath, pathWasRewritten } from "@/lib/paths/entry-path";

export type ZenodoHost = { api: string; site: string; label: string };

export const ZENODO_HOSTS: ZenodoHost[] = [
  { api: "https://zenodo.org/api", site: "https://zenodo.org", label: "zenodo.org" },
  {
    api: "https://sandbox.zenodo.org/api",
    site: "https://sandbox.zenodo.org",
    label: "sandbox.zenodo.org",
  },
];

export type ParsedRecordRef = { recordId: string; host: ZenodoHost };

/**
 * Accept whatever a researcher has to hand: a record URL, a DOI, a DOI URL, or a bare id.
 *
 * Returns null rather than guessing. A wrong id silently downloads someone else's data.
 */
export function parseRecordRef(input: string): ParsedRecordRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare numeric id → production, the only sensible default.
  if (/^\d+$/.test(raw)) return { recordId: raw, host: ZENODO_HOSTS[0]! };

  // A DOI, with or without the doi.org prefix: 10.5281/zenodo.10001, 10.5072/zenodo.587080
  const doi = raw.match(/10\.\d{4,9}\/zenodo\.(\d+)/i);
  if (doi) {
    // The 10.5072 prefix is DataCite's test prefix, which is what sandbox mints.
    const sandbox = raw.includes("10.5072/");
    return { recordId: doi[1]!, host: sandbox ? ZENODO_HOSTS[1]! : ZENODO_HOSTS[0]! };
  }

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = ZENODO_HOSTS.find((h) => new URL(h.site).host === url.host);
    if (!host) return null;
    // /records/123, /record/123 (the older form), /records/123/files/...
    const id = url.pathname.match(/\/records?\/(\d+)/)?.[1];
    return id ? { recordId: id, host } : null;
  } catch {
    return null;
  }
}

export type ZenodoRecordFile = {
  key: string;
  size: number | null;
  /** Bare hex md5, or null when Zenodo reported none. Never coerced to a placeholder. */
  md5: string | null;
  contentUrl: string;
};

export type ZenodoRecordSummary = {
  recordId: string;
  title: string;
  doi: string | null;
  publicationDate: string | null;
  creators: string[];
  htmlUrl: string;
  files: ZenodoRecordFile[];
  /**
   * True when Zenodo says the record's files are restricted.
   *
   * Reported rather than retried: a restricted record's listing comes back empty or short,
   * and an empty file list rendered as "this record has no files" would be a false
   * statement about somebody's deposit.
   */
  filesRestricted: boolean;
};

export async function fetchRecord(
  ref: ParsedRecordRef,
  signal?: AbortSignal,
): Promise<ZenodoRecordSummary> {
  const [recordRes, filesRes] = await Promise.all([
    fetch(`${ref.host.api}/records/${ref.recordId}`, { signal }),
    fetch(`${ref.host.api}/records/${ref.recordId}/files`, { signal }),
  ]);

  if (recordRes.status === 404) {
    throw new Error(`${ref.host.label} has no public record ${ref.recordId}.`);
  }
  if (!recordRes.ok) {
    throw new Error(`${ref.host.label} answered ${recordRes.status} for record ${ref.recordId}.`);
  }
  const record = await recordRes.json();
  const filesBody = filesRes.ok ? await filesRes.json().catch(() => null) : null;

  const entries = (filesBody?.entries ?? []) as RawEntry[];
  return {
    recordId: String(record.id ?? ref.recordId),
    title: String(record.metadata?.title ?? "(untitled)"),
    doi: record.doi ?? record.pids?.doi?.identifier ?? null,
    publicationDate: record.metadata?.publication_date ?? null,
    creators: (record.metadata?.creators ?? [])
      .map((c: { person_or_org?: { name?: string }; name?: string }) =>
        String(c.person_or_org?.name ?? c.name ?? ""),
      )
      .filter(Boolean),
    htmlUrl: `${ref.host.site}/records/${ref.recordId}`,
    files: entries
      .filter((e) => typeof e.key === "string")
      .map((e) => ({
        key: String(e.key),
        size: typeof e.size === "number" && Number.isFinite(e.size) ? e.size : null,
        md5: parseMd5(e.checksum),
        contentUrl:
          e.links?.content ??
          `${ref.host.api}/records/${ref.recordId}/files/${encodeKey(String(e.key))}/content`,
      })),
    filesRestricted:
      record.access?.files === "restricted" || (!filesRes.ok && filesRes.status === 403),
  };
}

type RawEntry = { key?: string; size?: number; checksum?: unknown; links?: { content?: string } };

/** Encode each segment, keeping the slashes that give the deposit its structure. */
export function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function parseMd5(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^md5:([0-9a-f]{32})$/i);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * A Zenodo file key turned into a ZIP entry path that cannot escape the archive.
 *
 * Delegates to `safeEntryPath`, which is the ONE definition shared with the outbound export
 * and transfer paths — see its doc comment for what Zenodo and OSF each actually permit, all
 * measured. A second copy here is exactly the duplication invariant (class 10) that this
 * project keeps paying for.
 */
export function zipEntryPath(key: string): string {
  return safeEntryPath(key);
}

/** Did sanitising change the key? Shown to the user, so a rename is never silent. */
export function wasRewritten(key: string): boolean {
  return pathWasRewritten(key);
}

export type TreeFolder = {
  name: string;
  folders: Map<string, TreeFolder>;
  files: ZenodoRecordFile[];
};

/**
 * Turn flat keys back into the hierarchy they describe.
 *
 * Purely a rendering aid — the ZIP is built from the keys directly, so nothing here can
 * change which bytes land where.
 */
export function buildTree(files: ZenodoRecordFile[]): TreeFolder {
  const root: TreeFolder = { name: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.key.split("/").filter(Boolean);
    const filename = parts.pop();
    if (!filename) continue;
    let cursor = root;
    for (const part of parts) {
      let next = cursor.folders.get(part);
      if (!next) {
        next = { name: part, folders: new Map(), files: [] };
        cursor.folders.set(part, next);
      }
      cursor = next;
    }
    cursor.files.push(file);
  }
  return root;
}

/** A filename stem for the archive, safe on every platform. */
export function archiveName(record: ZenodoRecordSummary): string {
  const stem = record.title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/\.+$/, "");
  return `zenodo-${record.recordId}${stem ? `-${stem}` : ""}.zip`;
}
