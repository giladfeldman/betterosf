import { describe, it, expect } from "vitest";
import { parseNode, NODE_FIELDS, withNodeFields } from "@/lib/osf/parse";

// A node as OSF sends it WITHOUT a sparse fieldset: every attribute and relationship,
// most of which BetterOSF never reads.
const fullRaw = {
  id: "abc12",
  attributes: {
    title: "A project",
    description: "Some description",
    category: "data",
    public: true,
    tags: ["x", "y"],
    date_created: "2021-03-26T11:23:00",
    date_modified: "2026-08-14T11:35:00",
    // Fields OSF sends but parseNode ignores:
    custom_citation: null,
    registration: false,
    preprint: false,
    fork: false,
    collection: false,
    access_requests_enabled: true,
    node_license: { year: "2021" },
    analytics_key: "k",
    current_user_permissions: ["read"],
    wiki_enabled: true,
  },
  relationships: {
    parent: { data: { id: "par01" }, links: { related: { href: "https://api.osf.io/v2/nodes/par01/" } } },
    children: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/children/", meta: { count: 3 } } } },
    linked_nodes: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/linked_nodes/" } } },
    registrations: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/registrations/" } } },
    files: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/files/" } } },
    contributors: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/contributors/" } } },
    // Relationships parseNode ignores:
    wikis: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/wikis/" } } },
    logs: { links: { related: { href: "https://api.osf.io/v2/nodes/abc12/logs/" } } },
  },
  links: { html: "https://osf.io/abc12/" },
};

/** What OSF returns when asked for `fields[nodes]=NODE_FIELDS`: only those keys. */
function sparse(raw: typeof fullRaw) {
  const keep = new Set<string>(NODE_FIELDS);
  const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => keep.has(k)));
  return { ...raw, attributes: pick(raw.attributes), relationships: pick(raw.relationships) };
}

describe("NODE_FIELDS sparse fieldset", () => {
  it("covers every field parseNode reads: the sparse response parses identically to the full one", () => {
    expect(parseNode({ data: sparse(fullRaw) })).toEqual(parseNode({ data: fullRaw }));
  });

  it("fails if a field parseNode reads is dropped from the fieldset (control: the check can fail)", () => {
    // Drop each field in turn; at least the ones parseNode reads must change the result.
    const read = ["title", "description", "category", "public", "tags", "date_created", "date_modified", "parent", "children", "linked_nodes", "registrations", "files", "contributors"];
    for (const field of read) {
      const keep = new Set<string>(NODE_FIELDS.filter((f) => f !== field));
      const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => keep.has(k)));
      const without = { ...fullRaw, attributes: pick(fullRaw.attributes), relationships: pick(fullRaw.relationships) };
      expect(parseNode({ data: without }), `dropping ${field}`).not.toEqual(parseNode({ data: fullRaw }));
    }
  });

  it("withNodeFields appends the fieldset with the right separator", () => {
    expect(withNodeFields("/nodes/x/children/")).toBe(`/nodes/x/children/?fields[nodes]=${NODE_FIELDS.join(",")}`);
    expect(withNodeFields("/nodes/x/children/?page[size]=100")).toBe(
      `/nodes/x/children/?page[size]=100&fields[nodes]=${NODE_FIELDS.join(",")}`
    );
    expect(withNodeFields("/nodes/x/children/?page[size]=100", { childCounts: true })).toBe(
      `/nodes/x/children/?page[size]=100&fields[nodes]=${NODE_FIELDS.join(",")}&related_counts=children`
    );
  });
});

describe("parseNode childCount", () => {
  it("reads OSF's related count", () => {
    expect(parseNode({ data: fullRaw }).childCount).toBe(3);
  });

  it("keeps a real 0 as 0", () => {
    const zero = structuredClone(fullRaw);
    zero.relationships.children.links.related.meta.count = 0;
    expect(parseNode({ data: zero }).childCount).toBe(0);
  });

  it("leaves it undefined (unknown) when OSF did not report a count — never 0", () => {
    const noMeta = structuredClone(fullRaw) as unknown as { relationships: { children: { links: { related: { meta?: unknown } } } } };
    delete noMeta.relationships.children.links.related.meta;
    const parsed = parseNode({ data: noMeta as unknown as typeof fullRaw });
    expect(parsed.childCount).toBeUndefined();
    expect("childCount" in parsed).toBe(false);
  });
});
