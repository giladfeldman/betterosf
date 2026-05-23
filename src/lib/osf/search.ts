import "server-only";
import { osfGet } from "./client";
import { parseNode, type NodeView } from "./parse";

export type SearchPage<T> = {
  results: T[];
  total: number;
  hasMore: boolean;
};

type RawCollection<R> = {
  data: R[];
  links: { next: string | null };
  meta?: { total?: number };
};

function buildQs(query: string, filterField: string, opts?: { page?: number; perPage?: number }): string {
  const page = opts?.page ?? 1;
  const size = opts?.perPage ?? 20;
  const qs = new URLSearchParams();
  qs.set(`filter[${filterField}]`, query);
  qs.set("page", String(page));
  qs.set("page[size]", String(size));
  return qs.toString();
}

type RawNodeForParse = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: { html?: string };
};

export async function searchNodes(query: string, opts?: { page?: number; perPage?: number }): Promise<SearchPage<NodeView>> {
  const qs = buildQs(query, "title", opts);
  const raw = await osfGet<RawCollection<RawNodeForParse>>(`/nodes/?${qs}`, {
    tags: ["search", `search:nodes:${query}`],
    revalidate: 60,
  });
  return {
    results: raw.data.map((r) => parseNode({ data: r })),
    total: raw.meta?.total ?? raw.data.length,
    hasMore: raw.links.next !== null,
  };
}

export type SearchedFile = {
  id: string;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  materializedPath: string;
  modified: string;
  downloadUrl: string;
  nodeId: string | null;
};

type RawSearchedFile = {
  id: string;
  type: string;
  attributes: { name?: string; kind?: "file" | "folder"; size?: number | null; materialized_path?: string; modified?: string };
  links?: { download?: string };
  relationships?: { node?: { data?: { id?: string } } };
};

export async function searchFiles(query: string, opts?: { page?: number; perPage?: number }): Promise<SearchPage<SearchedFile>> {
  const qs = buildQs(query, "name", opts);
  const raw = await osfGet<RawCollection<RawSearchedFile>>(`/files/?${qs}`, {
    tags: ["search", `search:files:${query}`],
    revalidate: 60,
  });
  return {
    results: raw.data.map((r) => ({
      id: r.id,
      name: String(r.attributes.name ?? ""),
      kind: r.attributes.kind ?? "file",
      size: r.attributes.size ?? null,
      materializedPath: String(r.attributes.materialized_path ?? ""),
      modified: String(r.attributes.modified ?? ""),
      downloadUrl: r.links?.download ?? "",
      nodeId: r.relationships?.node?.data?.id ?? null,
    })),
    total: raw.meta?.total ?? raw.data.length,
    hasMore: raw.links.next !== null,
  };
}

export type SearchedRegistration = {
  id: string;
  title: string;
  dateRegistered: string;
  osfUrl: string;
};

type RawReg = {
  id: string;
  type: string;
  attributes: { title?: string; date_registered?: string };
  links?: { html?: string };
};

export async function searchRegistrations(query: string, opts?: { page?: number; perPage?: number }): Promise<SearchPage<SearchedRegistration>> {
  const qs = buildQs(query, "title", opts);
  const raw = await osfGet<RawCollection<RawReg>>(`/registrations/?${qs}`, {
    tags: ["search", `search:regs:${query}`],
    revalidate: 60,
  });
  return {
    results: raw.data.map((r) => ({
      id: r.id,
      title: String(r.attributes.title ?? ""),
      dateRegistered: String(r.attributes.date_registered ?? ""),
      osfUrl: r.links?.html ?? `https://osf.io/${r.id}/`,
    })),
    total: raw.meta?.total ?? raw.data.length,
    hasMore: raw.links.next !== null,
  };
}

export type SearchedUser = {
  id: string;
  fullName: string;
  osfUrl: string;
};

type RawUser = {
  id: string;
  type: string;
  attributes: { full_name?: string };
  links?: { html?: string };
};

export async function searchUsers(query: string, opts?: { page?: number; perPage?: number }): Promise<SearchPage<SearchedUser>> {
  const qs = buildQs(query, "full_name", opts);
  const raw = await osfGet<RawCollection<RawUser>>(`/users/?${qs}`, {
    tags: ["search", `search:users:${query}`],
    revalidate: 60,
  });
  return {
    results: raw.data.map((r) => ({
      id: r.id,
      fullName: String(r.attributes.full_name ?? r.id),
      osfUrl: r.links?.html ?? `https://osf.io/${r.id}/`,
    })),
    total: raw.meta?.total ?? raw.data.length,
    hasMore: raw.links.next !== null,
  };
}
