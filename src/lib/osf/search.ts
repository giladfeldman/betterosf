import "server-only";
import { osfGet } from "./client";
import { parseNode, type NodeView } from "./parse";
import { parseQuery } from "@/lib/search/parser";
import { compileQuery, MAX_QUERY_BRANCHES, type FilterPair } from "@/lib/search/compile";
import { sanitizeSort } from "./sort";

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

const FILE_EXTENSION_TERMS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "csv", "tsv", "xls", "xlsx",
  "mp4", "m4v", "mov", "avi", "webm", "mkv", "mp3", "wav", "m4a", "aac",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp",
  "js", "ts", "tsx", "jsx", "py", "r", "rmd", "ipynb", "json", "yaml", "yml", "sh", "html", "css",
]);

function normalizeSearchTerm(resource: "nodes" | "files" | "registrations" | "users", mode: "filter" | "search", term: string): string {
  if (resource !== "files" || mode !== "search") return term;
  const trimmed = term.trim();
  if (trimmed.startsWith(".")) return trimmed.toLowerCase();
  const lower = trimmed.toLowerCase();
  return FILE_EXTENSION_TERMS.has(lower) ? `.${lower}` : term;
}

async function executeMulti<T>(
  resource: "nodes" | "files" | "registrations" | "users",
  field: string,
  query: string,
  opts: { page?: number; perPage?: number; sort?: string } | undefined,
  parseItems: (raw: RawCollection<unknown>) => T[],
  idOf: (item: T) => string,
  textOf: (item: T) => string,
  tagSuffix: string,
  // Endpoint style:
  //   "filter" → /v2/<resource>/?filter[<field>]=<term>
  //   "search" → /v2/search/<resource>/?q=<term>  (full-text search)
  // OSF's /files/?filter[name]= returns 404 for nearly all queries — the
  // search endpoint is the only thing that actually finds files by name.
  mode: "filter" | "search" = "filter",
): Promise<SearchPage<T>> {
  const ast = parseQuery(query);
  const plan = compileQuery(ast, field);
  const page = opts?.page ?? 1;
  const size = opts?.perPage ?? 20;
  const sort = sanitizeSort(opts?.sort);

  // For OR-union, fetch each request; for intersect (single request) just one fetch.
  // OSF paginates per request; for union we paginate per branch and union page-by-page,
  // taking the first <size> after dedup. compileQuery already caps requests at
  // MAX_QUERY_BRANCHES; the slice is a defensive backstop on the same bound.
  const branches = plan.requests.slice(0, MAX_QUERY_BRANCHES);

  const fetchOne = async (req: { filters: FilterPair[] }) => {
    const qs = new URLSearchParams();
    if (mode === "search") {
      const q = req.filters.map(([, v]) => normalizeSearchTerm(resource, mode, v)).join(" ");
      if (q) qs.set("q", q);
    } else {
      for (const [k, v] of req.filters) qs.append(`filter[${k}]`, v);
    }
    qs.set("page", String(page));
    qs.set("page[size]", String(size));
    if (sort) qs.set("sort", sort);
    const path = mode === "search" ? `/search/${resource}/` : `/${resource}/`;
    return osfGet<RawCollection<unknown>>(
      `${path}?${qs.toString()}`,
      { tags: ["search", `search:${tagSuffix}:${query}`], revalidate: 60 }
    );
  };

  const responses = await Promise.all(branches.map(fetchOne));

  let total = 0;
  let hasMore = false;
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const raw of responses) {
    total = Math.max(total, raw.meta?.total ?? raw.data.length);
    if (raw.links.next !== null) hasMore = true;
    const parsed = parseItems(raw);
    for (const item of parsed) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      const text = textOf(item).toLowerCase();
      if (plan.exclusions.some((e) => text.includes(e.toLowerCase()))) continue;
      merged.push(item);
    }
  }

  return { results: merged.slice(0, size), total, hasMore };
}

type RawNodeForParse = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: { html?: string };
};

export async function searchNodes(query: string, opts?: { page?: number; perPage?: number; sort?: string }): Promise<SearchPage<NodeView>> {
  return executeMulti<NodeView>(
    "nodes",
    "title",
    query,
    opts,
    (raw) => (raw.data as RawNodeForParse[]).map((r) => parseNode({ data: r })),
    (item) => item.id,
    (item) => item.title ?? "",
    "nodes",
  );
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
  attributes: {
    name?: string;
    kind?: "file" | "folder";
    size?: number | null;
    materialized_path?: string;
    modified?: string;
    // /search/files/ uses date_modified; /files/?filter[name]= used modified.
    date_modified?: string | null;
    guid?: string;
  };
  links?: { download?: string };
  relationships?: { node?: { data?: { id?: string } }; target?: { data?: { id?: string } } };
};

export async function searchFiles(query: string, opts?: { page?: number; perPage?: number; sort?: string }): Promise<SearchPage<SearchedFile>> {
  return executeMulti<SearchedFile>(
    "files",
    "name",
    query,
    opts,
    (raw) => (raw.data as RawSearchedFile[]).map((r) => ({
      id: r.id,
      name: String(r.attributes.name ?? ""),
      kind: r.attributes.kind ?? "file",
      size: r.attributes.size ?? null,
      materializedPath: String(r.attributes.materialized_path ?? ""),
      modified: String(r.attributes.modified ?? r.attributes.date_modified ?? ""),
      downloadUrl: r.links?.download ?? "",
      // /search/files/ exposes the containing node via `target` (or sometimes
      // via the file's `guid`); /files/?filter[]= used `node`. Try all.
      nodeId:
        r.relationships?.node?.data?.id ??
        r.relationships?.target?.data?.id ??
        null,
    })),
    (item) => item.id,
    (item) => item.name,
    "files",
    "search",
  );
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

export async function searchRegistrations(query: string, opts?: { page?: number; perPage?: number; sort?: string }): Promise<SearchPage<SearchedRegistration>> {
  return executeMulti<SearchedRegistration>(
    "registrations",
    "title",
    query,
    opts,
    (raw) => (raw.data as RawReg[]).map((r) => ({
      id: r.id,
      title: String(r.attributes.title ?? ""),
      dateRegistered: String(r.attributes.date_registered ?? ""),
      osfUrl: r.links?.html ?? `https://osf.io/${r.id}/`,
    })),
    (item) => item.id,
    (item) => item.title,
    "regs",
  );
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

export async function searchUsers(query: string, opts?: { page?: number; perPage?: number; sort?: string }): Promise<SearchPage<SearchedUser>> {
  return executeMulti<SearchedUser>(
    "users",
    "full_name",
    query,
    opts,
    (raw) => (raw.data as RawUser[]).map((r) => ({
      id: r.id,
      fullName: String(r.attributes.full_name ?? r.id),
      osfUrl: r.links?.html ?? `https://osf.io/${r.id}/`,
    })),
    (item) => item.id,
    (item) => item.fullName,
    "users",
  );
}

// Scoped search within a project: post-filters children/linked/registrations of a root node.
import { getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { fetchAllProjectEntries } from "@/lib/osf/files-recursive";
import { mapWithConcurrency } from "@/lib/util/concurrency";

function buildIncludeFn(query: string, field: string): (text: string) => boolean {
  const ast = parseQuery(query);
  const plan = compileQuery(ast, field);
  return (text: string) => {
    const t = text.toLowerCase();
    if (plan.exclusions.some((e) => t.includes(e.toLowerCase()))) return false;
    if (plan.requests.length === 0 || plan.requests[0]?.filters.length === 0) return true;
    // Test text against each request branch; OR-union means any branch matching is OK
    return plan.requests.some((req) =>
      req.filters.every(([, val]) => t.includes(val.toLowerCase()))
    );
  };
}

export async function searchInProjectScope(rootGuid: string, query: string): Promise<{
  components: NodeView[];
  linked: NodeView[];
  registrations: { id: string; title: string; dateRegistered: string; osfUrl: string }[];
}> {
  const include = buildIncludeFn(query, "title");

  const [children, linked, registrations] = await Promise.all([
    getAllChildren(rootGuid).catch((): NodeView[] => []),
    getAllLinkedNodes(rootGuid).catch((): NodeView[] => []),
    getNodeRegistrations(rootGuid).catch((): { id: string; title: string; dateRegistered: string; public: boolean; osfUrl: string }[] => []),
  ]);

  return {
    components: children.filter((c) => include(c.title || c.id)),
    linked: linked.filter((l) => include(l.title || l.id)),
    registrations: registrations.filter((r) => include(r.title || r.id)).map((r) => ({
      id: r.id, title: r.title, dateRegistered: r.dateRegistered, osfUrl: r.osfUrl,
    })),
  };
}

/**
 * What a project-scope file search actually covered (d-3fadc2 / d-f8599c).
 *
 * The walk is bounded (`maxEntries` per node), a component's walk can fail, and the
 * component list itself can fail to load. Each of those used to collapse into "no
 * matches" — `.catch(() => [])` — so an incomplete search looked complete, or looked
 * empty. The page now states every gap.
 */
export type ProjectSearchCoverage = {
  /** True only when every node was walked to the end. */
  complete: boolean;
  /** Nodes whose walk stopped at `maxEntries`. */
  truncated: string[];
  /** Nodes whose files could not be listed at all. */
  failed: string[];
  /** The component list could not be read, so only the root project was searched. */
  componentsUnknown: boolean;
  maxEntries: number;
  entriesSearched: number;
};

/**
 * Search files within a project's storage by walking every folder under every provider of
 * the project and of its components, filtering by name. Bounded per node by `maxEntries`.
 *
 * Returns SearchedFile-shaped rows so FileResult renders them unchanged, plus `coverage`.
 */
export async function searchFilesInProjectScope(
  rootGuid: string,
  query: string,
  opts?: { maxEntries?: number; maxConcurrency?: number }
): Promise<{ files: SearchedFile[]; coverage: ProjectSearchCoverage }> {
  const include = buildIncludeFn(query, "name");
  const maxEntries = opts?.maxEntries ?? 5000;
  const coverage: ProjectSearchCoverage = {
    complete: true,
    truncated: [],
    failed: [],
    componentsUnknown: false,
    maxEntries,
    entriesSearched: 0,
  };

  const walk = async (guid: string): Promise<SearchedFile[]> => {
    let result;
    try {
      result = await fetchAllProjectEntries(guid, { maxEntries });
    } catch {
      coverage.failed.push(guid);
      return [];
    }
    if (result.truncated) coverage.truncated.push(guid);
    coverage.entriesSearched += result.entries.length;
    return result.entries
      .filter((e) => e.kind === "file" && include(e.name))
      .map((e) => ({
        id: `${guid}:${e.provider}:${e.materializedPath}`,
        name: e.name,
        kind: "file" as const,
        size: null,
        materializedPath: e.materializedPath,
        modified: "",
        downloadUrl: e.downloadUrl ?? "",
        nodeId: guid,
      }));
  };

  const [results, children] = await Promise.all([
    walk(rootGuid),
    getAllChildren(rootGuid).catch((): NodeView[] | null => null),
  ]);
  if (children === null) coverage.componentsUnknown = true;

  // Two components at a time; each walk lists up to three folders at once, so a search
  // never has more than ~6 OSF requests in flight.
  const componentResults = await mapWithConcurrency(children ?? [], opts?.maxConcurrency ?? 2, (c) => walk(c.id));
  for (const list of componentResults) results.push(...list);

  coverage.complete = coverage.truncated.length === 0 && coverage.failed.length === 0 && !coverage.componentsUnknown;
  return { files: results, coverage };
}
