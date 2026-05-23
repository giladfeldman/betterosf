import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

export type ProviderRoot = {
  provider: string;
  name: string;
  listingUrl: string;
};

export type FileEntry =
  | {
      kind: "file";
      id: string;
      name: string;
      size: number | null;
      modified: string;
      materializedPath: string;
      downloadUrl: string;
    }
  | {
      kind: "folder";
      id: string;
      name: string;
      materializedPath: string;
      listingUrl: string;
    };

type RawEntry = {
  id: string;
  type: string;
  attributes: {
    name?: string;
    kind?: "file" | "folder";
    provider?: string;
    size?: number | null;
    modified?: string;
    materialized_path?: string;
  };
  relationships?: { files?: { links?: { related?: { href?: string } } } };
  links?: { download?: string };
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
  };
}

export async function getProviderRoots(guid: string): Promise<ProviderRoot[]> {
  const raw = await osfGet<CollectionResponse>(`/nodes/${guid}/files/?page[size]=100`, {
    tags: [`node:${guid}`, `files:${guid}`],
  });
  return raw.data.map((r) => ({
    provider: String(r.attributes.provider ?? r.attributes.name ?? r.id),
    name: String(r.attributes.name ?? r.id),
    listingUrl: r.relationships?.files?.links?.related?.href ?? "",
  }));
}

export async function getFolderContents(listingUrl: string, guidForCacheTag: string): Promise<FileEntry[]> {
  return collectAll<FileEntry>(async (nextUrl) => {
    const url = nextUrl ?? `${listingUrl}${listingUrl.includes("?") ? "&" : "?"}page[size]=100`;
    const raw = await osfGetUrl<CollectionResponse>(url, { tags: [`node:${guidForCacheTag}`] });
    return { data: raw.data.map(parseEntry), links: raw.links };
  });
}
