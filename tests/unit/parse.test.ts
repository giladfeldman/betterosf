import { describe, it, expect } from "vitest";
import { parseNode } from "@/lib/osf/parse";

const RAW_NODE = {
  data: {
    id: "ezcuj",
    type: "nodes",
    attributes: {
      title: "Many Labs 2",
      description: "Investigating Variation in Replicability…",
      category: "project",
      public: true,
      tags: ["replication", "psychology"],
      date_created: "2014-01-01T00:00:00Z",
      date_modified: "2018-06-01T00:00:00Z",
      node_license: { copyright_holders: [], year: "2018" },
    },
    relationships: {
      children: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/children/" } } },
      linked_nodes: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/linked_nodes/" } } },
      registrations: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/registrations/" } } },
      files: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/files/" } } },
      contributors: { links: { related: { href: "https://api.osf.io/v2/nodes/ezcuj/contributors/" } } },
    },
    links: { html: "https://osf.io/ezcuj/" },
  },
};

describe("parseNode", () => {
  it("extracts core fields", () => {
    const node = parseNode(RAW_NODE);
    expect(node.id).toBe("ezcuj");
    expect(node.title).toBe("Many Labs 2");
    expect(node.public).toBe(true);
    expect(node.category).toBe("project");
    expect(node.tags).toEqual(["replication", "psychology"]);
    expect(node.dateCreated).toBe("2014-01-01T00:00:00Z");
    expect(node.dateModified).toBe("2018-06-01T00:00:00Z");
    expect(node.osfUrl).toBe("https://osf.io/ezcuj/");
  });

  it("exposes related endpoint URLs for follow-up fetches", () => {
    const node = parseNode(RAW_NODE);
    expect(node.related.children).toBe("https://api.osf.io/v2/nodes/ezcuj/children/");
    expect(node.related.linkedNodes).toBe("https://api.osf.io/v2/nodes/ezcuj/linked_nodes/");
    expect(node.related.registrations).toBe("https://api.osf.io/v2/nodes/ezcuj/registrations/");
    expect(node.related.files).toBe("https://api.osf.io/v2/nodes/ezcuj/files/");
    expect(node.related.contributors).toBe("https://api.osf.io/v2/nodes/ezcuj/contributors/");
  });

  it("parses parentId from relationships.parent.data.id", () => {
    const raw = JSON.parse(JSON.stringify(RAW_NODE));
    raw.data.relationships.parent = { data: { type: "nodes", id: "df9tj" } };
    const node = parseNode(raw);
    expect(node.parentId).toBe("df9tj");
  });

  it("sets parentId to null when parent is absent or null", () => {
    expect(parseNode(RAW_NODE).parentId).toBeNull();
    const raw = JSON.parse(JSON.stringify(RAW_NODE));
    raw.data.relationships.parent = { data: null };
    expect(parseNode(raw).parentId).toBeNull();
  });

  it("handles missing description gracefully", () => {
    const raw = JSON.parse(JSON.stringify(RAW_NODE));
    delete raw.data.attributes.description;
    const node = parseNode(raw);
    expect(node.description).toBe("");
  });
});
