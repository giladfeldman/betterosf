export type NodeView = {
  id: string;
  title: string;
  description: string;
  category: string;
  public: boolean;
  tags: string[];
  dateCreated: string;
  dateModified: string;
  osfUrl: string;
  /** Parent project/component guid, or null when this node is a root. */
  parentId: string | null;
  related: {
    children: string;
    linkedNodes: string;
    registrations: string;
    files: string;
    contributors: string;
  };
};

type RelLink = { links?: { related?: { href?: string } } };
type RelData = { data?: { id?: string } | null };

function rel(raw: Record<string, unknown> | undefined, key: string): string {
  const r = raw?.[key] as RelLink | undefined;
  return r?.links?.related?.href ?? "";
}

function relId(raw: Record<string, unknown> | undefined, key: string): string | null {
  const r = raw?.[key] as RelData | undefined;
  const id = r?.data?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function parseNode(raw: { data: { id: string; attributes: Record<string, unknown>; relationships?: Record<string, unknown>; links?: { html?: string } } }): NodeView {
  const a = raw.data.attributes;
  const r = raw.data.relationships;
  return {
    id: raw.data.id,
    title: String(a.title ?? ""),
    description: String(a.description ?? ""),
    category: String(a.category ?? ""),
    public: Boolean(a.public),
    tags: Array.isArray(a.tags) ? (a.tags as string[]) : [],
    dateCreated: String(a.date_created ?? ""),
    dateModified: String(a.date_modified ?? ""),
    osfUrl: raw.data.links?.html ?? `https://osf.io/${raw.data.id}/`,
    parentId: relId(r, "parent"),
    related: {
      children: rel(r, "children"),
      linkedNodes: rel(r, "linked_nodes"),
      registrations: rel(r, "registrations"),
      files: rel(r, "files"),
      contributors: rel(r, "contributors"),
    },
  };
}
