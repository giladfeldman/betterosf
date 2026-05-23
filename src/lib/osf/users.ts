import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { parseNode, type NodeView } from "./parse";
import { collectAll } from "./paginate";

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
