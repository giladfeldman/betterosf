import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { parseNode, type NodeView } from "./parse";
import { collectAll } from "./paginate";

type SingleResponse = Parameters<typeof parseNode>[0];
type CollectionResponse = { data: SingleResponse["data"][]; links: { next: string | null } };

export async function getNode(guid: string): Promise<NodeView> {
  const raw = await osfGet<SingleResponse>(`/nodes/${guid}/`, { tags: [`node:${guid}`] });
  return parseNode(raw);
}

async function fetchNodeCollectionPage(url: string, defaultPath: string, guid: string): Promise<{ data: NodeView[]; links: { next: string | null } }> {
  const raw = url
    ? await osfGetUrl<CollectionResponse>(url, { tags: [`node:${guid}`] })
    : await osfGet<CollectionResponse>(defaultPath, { tags: [`node:${guid}`] });
  return {
    data: raw.data.map((r) => parseNode({ data: r })),
    links: raw.links,
  };
}

export async function getAllChildren(guid: string): Promise<NodeView[]> {
  return collectAll<NodeView>((nextUrl) =>
    fetchNodeCollectionPage(nextUrl ?? "", `/nodes/${guid}/children/?page[size]=100`, guid)
  );
}

export async function getAllLinkedNodes(guid: string): Promise<NodeView[]> {
  return collectAll<NodeView>((nextUrl) =>
    fetchNodeCollectionPage(nextUrl ?? "", `/nodes/${guid}/linked_nodes/?page[size]=100`, guid)
  );
}
