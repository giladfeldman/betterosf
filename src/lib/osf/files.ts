import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

export type ProviderRoot = {
  provider: string;
  name: string;
  listingUrl: string;
  uploadUrl?: string;
  newFolderUrl?: string;
};

export type FileEntry =
  | {
      kind: "file";
      id: string;
      name: string;
      size: number | null;
      modified: string;
      materializedPath: string;
      /**
       * OSF's `links.download` (`https://osf.io/download/<id>/`).
       *
       * SERVER-SIDE ONLY. That host sends no CORS headers, so a browser cannot fetch it —
       * see `waterbutlerDownloadUrl` for the form that works from a browser, and use that
       * for anything the client will fetch itself.
       */
      downloadUrl: string;
      /**
       * Storage provider ("osfstorage", "dropbox", …) and the provider-side path, both
       * needed to build a browser-fetchable Waterbutler URL.
       *
       * Optional because a few call sites synthesise a FileEntry from a URL they already
       * hold. A consumer that needs a Waterbutler URL must REFUSE when they are absent
       * rather than build one from an empty string — see the transition plan route.
       */
      provider?: string;
      providerPath?: string;
      /** OSF's own Waterbutler delete link. Optional: absent means no delete affordance. */
      deleteUrl?: string;
      /**
       * Checksums OSF reports for this file, when it has them.
       *
       * osfstorage supplies both; add-on providers (Dropbox, Drive, S3, GitHub) generally
       * supply NEITHER, because OSF only proxies those bytes and never hashes them. That
       * absence is load-bearing: the export verifier uses it to mark a file
       * `unverifiable` rather than pretending it was checked, so these must stay
       * `null` when missing and must never be defaulted to an empty string.
       */
      md5: string | null;
      sha256: string | null;
    }
  | {
      kind: "folder";
      id: string;
      name: string;
      materializedPath: string;
      listingUrl: string;
      uploadUrl?: string;
      newFolderUrl?: string;
      /** OSF's own Waterbutler delete link. Optional: absent means no delete affordance. */
      deleteUrl?: string;
    };

type RawEntry = {
  id: string;
  type: string;
  attributes: {
    name?: string;
    kind?: "file" | "folder";
    provider?: string;
    /** Provider-side id/path, e.g. "/659f816…". Needed to build a Waterbutler URL. */
    path?: string;
    size?: number | null;
    modified?: string;
    materialized_path?: string;
    extra?: { hashes?: { md5?: string; sha256?: string } };
  };
  relationships?: { files?: { links?: { related?: { href?: string } } } };
  links?: { download?: string; upload?: string; new_folder?: string; delete?: string };
};

type CollectionResponse = { data: RawEntry[]; links: { next: string | null } };

function parseEntry(raw: RawEntry): FileEntry {
  if (raw.attributes.kind === "folder") {
    return {
      kind: "folder",
      id: raw.id,
      name: String(raw.attributes.name ?? ""),
      materializedPath: String(raw.attributes.materialized_path ?? ""),
      listingUrl: raw.relationships?.files?.links?.related?.href ?? "",
      uploadUrl: raw.links?.upload,
      newFolderUrl: raw.links?.new_folder,
      deleteUrl: raw.links?.delete,
    };
  }
  return {
    kind: "file",
    id: raw.id,
    name: String(raw.attributes.name ?? ""),
    size: raw.attributes.size ?? null,
    modified: String(raw.attributes.modified ?? ""),
    materializedPath: String(raw.attributes.materialized_path ?? ""),
    downloadUrl: raw.links?.download ?? "",
    provider: raw.attributes.provider ?? undefined,
    providerPath: raw.attributes.path ?? undefined,
    deleteUrl: raw.links?.delete,
    md5: raw.attributes.extra?.hashes?.md5 ?? null,
    sha256: raw.attributes.extra?.hashes?.sha256 ?? null,
  };
}

export type FilesKind = "node" | "registration";

export async function getProviderRoots(guid: string, opts: { kind?: FilesKind } = {}): Promise<ProviderRoot[]> {
  const resource = opts.kind === "registration" ? "registrations" : "nodes";
  const tagKey = opts.kind === "registration" ? `registration:${guid}` : `node:${guid}`;
  const raw = await osfGet<CollectionResponse>(`/${resource}/${guid}/files/?page[size]=100`, {
    tags: [tagKey, `files:${guid}`],
  });
  return raw.data.map((r) => ({
    provider: String(r.attributes.provider ?? r.attributes.name ?? r.id),
    name: String(r.attributes.name ?? r.id),
    listingUrl: r.relationships?.files?.links?.related?.href ?? "",
    uploadUrl: r.links?.upload,
    newFolderUrl: r.links?.new_folder,
  }));
}

/**
 * Resolve a guid that could be either a node or a registration. Tries the node
 * endpoint first (the common case) and falls back to the registration endpoint
 * on a 404. Lets the file-view route serve registration files via the same
 * `/<guid>/files/view/<path>` URL pattern as node files.
 */
export async function getProviderRootsAuto(guid: string): Promise<{ roots: ProviderRoot[]; kind: FilesKind }> {
  try {
    const roots = await getProviderRoots(guid, { kind: "node" });
    return { roots, kind: "node" };
  } catch (e) {
    // Lazy import to avoid circular deps via client.ts.
    const { OsfError } = await import("./types");
    if (e instanceof OsfError && e.code === "not_found") {
      const roots = await getProviderRoots(guid, { kind: "registration" });
      return { roots, kind: "registration" };
    }
    throw e;
  }
}

export async function getFolderContents(
  listingUrl: string,
  guidForCacheTag: string,
  opts: { fresh?: boolean } = {}
): Promise<FileEntry[]> {
  return collectAll<FileEntry>(async (nextUrl) => {
    const url = nextUrl ?? `${listingUrl}${listingUrl.includes("?") ? "&" : "?"}page[size]=100`;
    const raw = await osfGetUrl<CollectionResponse>(url, {
      tags: [`node:${guidForCacheTag}`],
      ...(opts.fresh ? { revalidate: 0 } : {}),
    });
    return { data: raw.data.map(parseEntry), links: raw.links };
  });
}
