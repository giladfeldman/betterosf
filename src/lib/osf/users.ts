import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { parseNode, type NodeView } from "./parse";
import { collectAll } from "./paginate";
import { parseQuery } from "@/lib/search/parser";
import { compileQuery } from "@/lib/search/compile";

export type UserView = {
  id: string;
  fullName: string;
  osfUrl: string;
};

type RawUser = {
  data: {
    id: string;
    type: string;
    attributes: { full_name?: string; given_name?: string; family_name?: string };
    links?: { html?: string };
  };
};

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
  links: { next: string | null };
};

export async function searchUserNodes(
  userId: string,
  query: string,
  opts?: { page?: number; perPage?: number; sort?: string },
): Promise<{ results: NodeView[]; total: number; hasMore: boolean }> {
  const ast = parseQuery(query);
  const plan = compileQuery(ast, "title");
  const page = opts?.page ?? 1;
  const size = opts?.perPage ?? 20;
  const sort = opts?.sort;

  // OR-union across branches, single user's nodes endpoint
  const userPath = userId === "me" ? "users/me" : `users/${userId}`;
  const branches = plan.requests.slice(0, 5);

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
