import { decodeOsfText } from "@/lib/osf/decode-text";
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
  /**
   * How many components this node has, when OSF was asked for it
   * (`related_counts=children`). `undefined` = not asked or not reported —
   * never read it as 0.
   */
  childCount?: number;
};

/**
 * Every attribute and relationship `parseNode` reads, sent to OSF as a sparse
 * fieldset (`fields[nodes]=…`). Without it OSF serialises ~40 attributes per node
 * and a node COLLECTION becomes very slow: measured 2026-11-16 on df9tj (100
 * components), `/children/` took 13.7–21 s in full (over our 8 s per-attempt
 * timeout, so the tree showed 0 components) and 3.4 s with this list.
 * Keep it in step with `parseNode` — `tests/unit/node-fields.test.ts` fails if a
 * field `parseNode` reads is missing here.
 */
export const NODE_FIELDS = [
  "title",
  "description",
  "category",
  "public",
  "tags",
  "date_created",
  "date_modified",
  "parent",
  "children",
  "linked_nodes",
  "registrations",
  "files",
  "contributors",
] as const;

/**
 * Append the sparse fieldset to an OSF node-collection path. `childCounts` also asks
 * OSF for each node's component count (`related_counts=children`), which the tree
 * uses to show which components have their own components.
 */
export function withNodeFields(path: string, opts: { childCounts?: boolean } = {}): string {
  const sep = path.includes("?") ? "&" : "?";
  const extra = opts.childCounts ? "&related_counts=children" : "";
  return `${path}${sep}fields[nodes]=${NODE_FIELDS.join(",")}${extra}`;
}

type RelCount = { links?: { related?: { meta?: { count?: unknown } } } };

function relCount(raw: Record<string, unknown> | undefined, key: string): number | undefined {
  const n = (raw?.[key] as RelCount | undefined)?.links?.related?.meta?.count;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

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
    title: decodeOsfText(a.title),
    description: decodeOsfText(a.description),
    category: String(a.category ?? ""),
    public: Boolean(a.public),
    // Tags arrive HTML-escaped like titles: "Inclusive R&amp;D" (dqkh9, measured 2026-11-19, d-e301b8).
    tags: Array.isArray(a.tags) ? (a.tags as unknown[]).map(decodeOsfText) : [],
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
    ...(relCount(r, "children") !== undefined ? { childCount: relCount(r, "children") } : {}),
  };
}
