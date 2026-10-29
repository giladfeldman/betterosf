import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { parseNode, type NodeView } from "./parse";
import { collectAll } from "./paginate";
import { parseQuery } from "@/lib/search/parser";
import { compileQuery, MAX_QUERY_BRANCHES } from "@/lib/search/compile";
import { sanitizeSort } from "./sort";

export type UserView = {
  id: string;
  fullName: string;
  osfUrl: string;
  employment?: string;
};

type RawUser = {
  data: {
    id: string;
    type: string;
    attributes: {
      full_name?: string;
      given_name?: string;
      family_name?: string;
      employment?: Array<{ institution?: string; department?: string; title?: string }>;
    };
    links?: { html?: string };
  };
};

/** Fetch any OSF user by guid (used by the /<guid> dispatcher + /users/<guid>). */
export async function getUser(guid: string): Promise<UserView> {
  const raw = await osfGet<RawUser>(`/users/${guid}/`, { tags: [`user:${guid}`], revalidate: 300 });
  const a = raw.data.attributes;
  const joined = [a.given_name, a.family_name].filter(Boolean).join(" ");
  const fullName = a.full_name ?? (joined.length > 0 ? joined : raw.data.id);
  const job = Array.isArray(a.employment) ? a.employment[0] : undefined;
  const employment = job
    ? [job.title, job.department, job.institution].filter(Boolean).join(", ")
    : undefined;
  return {
    id: raw.data.id,
    fullName,
    osfUrl: raw.data.links?.html ?? `https://osf.io/${raw.data.id}/`,
    employment: employment || undefined,
  };
}

export async function getCurrentUser(): Promise<UserView> {
  const raw = await osfGet<RawUser>("/users/me/", { tags: ["users:me"], revalidate: 60 });
  const a = raw.data.attributes;
  const joined = [a.given_name, a.family_name].filter(Boolean).join(" ");
  const fullName = a.full_name ?? (joined.length > 0 ? joined : raw.data.id);
  return {
    id: raw.data.id,
    fullName,
    osfUrl: raw.data.links?.html ?? `https://osf.io/${raw.data.id}/`,
  };
}

type RawNode = Parameters<typeof parseNode>[0]["data"];

type NodeCollectionResponse = {
  data: RawNode[];
  /**
   * ⚠️ The collection total is at **`links.meta.total`**, not top-level `meta`.
   *
   * Measured live 2026-08-13: top-level `meta` is `{"version":"2.0"}`, while
   * `links.meta` is `{"total":443,"per_page":10}`. Code that read `raw.meta.total`
   * therefore always fell through to `data.length` and reported one PAGE as the
   * whole count — an unknown wearing the costume of a fact.
   */
  links: { next: string | null; meta?: { total?: number; per_page?: number } };
};

/** OSF's own count of a collection, or null when it did not say. Never a page length. */
export function collectionTotal(links: NodeCollectionResponse["links"]): number | null {
  const total = links?.meta?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

export async function searchUserNodes(
  userId: string,
  query: string,
  opts?: { page?: number; perPage?: number; sort?: string },
): Promise<{ results: NodeView[]; total: number; hasMore: boolean }> {
  const ast = parseQuery(query);
  const plan = compileQuery(ast, "title");
  const page = opts?.page ?? 1;
  const size = opts?.perPage ?? 20;
  const sort = sanitizeSort(opts?.sort);

  // OR-union across branches, single user's nodes endpoint
  const userPath = userId === "me" ? "users/me" : `users/${userId}`;
  const branches = plan.requests.slice(0, MAX_QUERY_BRANCHES);

  const responses = await Promise.all(branches.map(async (req) => {
    const qs = new URLSearchParams();
    for (const [k, v] of req.filters) qs.append(`filter[${k}]`, v);
    qs.set("page", String(page));
    qs.set("page[size]", String(size));
    if (sort) qs.set("sort", sort);
    return osfGet<NodeCollectionResponse & { meta?: { total?: number } }>(
      `/${userPath}/nodes/?${qs.toString()}`,
      { tags: ["users:me"], revalidate: 60 },
    );
  }));

  let total = 0;
  let hasMore = false;
  const seen = new Set<string>();
  const merged: NodeView[] = [];
  for (const raw of responses) {
    total = Math.max(total, raw.meta?.total ?? raw.data.length);
    if (raw.links.next !== null) hasMore = true;
    for (const r of raw.data) {
      const node = parseNode({ data: r });
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (!plan.exclusions.some((e) => node.title.toLowerCase().includes(e.toLowerCase()))) {
        merged.push(node);
      }
    }
  }

  return { results: merged.slice(0, size), total, hasMore };
}

/** First page (up to 100) of a user's PUBLIC projects, with the total count.
 *  Bounded to one request so a prolific user's profile doesn't fan out. */
export async function getUserNodes(userId: string): Promise<{ results: NodeView[]; total: number }> {
  const raw = await osfGet<NodeCollectionResponse>(`/users/${userId}/nodes/?page[size]=100`, {
    tags: [`user:${userId}`],
    revalidate: 300,
  });
  return {
    results: raw.data.map((r) => parseNode({ data: r })),
    // Falls back to the page length only when OSF gave no total — in which case
    // it is the honest floor, not a claim about the collection.
    total: collectionTotal(raw.links) ?? raw.data.length,
  };
}

export type MyProjectsPage = {
  nodes: NodeView[];
  /** URL for the next page, verbatim from OSF. Null on the last page. */
  next: string | null;
  /** OSF's count of the whole collection, or null when it did not report one. */
  total: number | null;
};

/**
 * ONE page of the signed-in user's projects.
 *
 * The paged form exists because the all-at-once form is a 27-second silent wait
 * on a 443-project account (measured 2026-08-13, 5–7s per upstream page). The
 * inventory now asks for pages and renders each as it lands, so the first
 * hundred projects are on screen in seconds and the progress bar has a real
 * denominator instead of a guess.
 */
export async function getMyProjectsPage(cursor?: string): Promise<MyProjectsPage> {
  const raw = cursor
    ? await osfGetUrl<NodeCollectionResponse>(cursor, { tags: ["users:me"], revalidate: 60 })
    : await osfGet<NodeCollectionResponse>("/users/me/nodes/?page[size]=100", {
        tags: ["users:me"],
        revalidate: 60,
      });

  return {
    nodes: raw.data.map((r) => parseNode({ data: r })),
    next: raw.links?.next ?? null,
    total: collectionTotal(raw.links),
  };
}

export async function getMyProjects(): Promise<NodeView[]> {
  return collectAll<NodeView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<NodeCollectionResponse>(nextUrl, { tags: ["users:me"], revalidate: 60 })
      : await osfGet<NodeCollectionResponse>("/users/me/nodes/?page[size]=100", {
          tags: ["users:me"],
          revalidate: 60,
        });
    return {
      data: raw.data.map((r) => parseNode({ data: r })),
      links: raw.links,
    };
  });
}
