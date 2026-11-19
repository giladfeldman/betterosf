/**
 * d-760cbc: OSF returns titles and descriptions HTML-escaped ("Peer Community In &amp;
 * Journal", measured on df9tj's components). Decoded once at parse; re-escaped only where
 * the text goes back into HTML (Zenodo's description).
 */
import { describe, it, expect } from "vitest";
import { decodeOsfText, escapeHtml } from "@/lib/osf/decode-text";
import { parseNode } from "@/lib/osf/parse";
import { crosswalk } from "@/lib/transition/crosswalk";

describe("decodeOsfText", () => {
  it("decodes the entities OSF emits", () => {
    expect(decodeOsfText("Peer Community In &amp; Journal")).toBe("Peer Community In & Journal");
    expect(decodeOsfText("a &lt;b&gt; &quot;c&quot; &#39;d&#39; &#x27;e&#x27;")).toBe(`a <b> "c" 'd' 'e'`);
  });
  it("decodes only once: an escaped entity stays an entity", () => {
    expect(decodeOsfText("&amp;amp;")).toBe("&amp;");
  });
  it("leaves plain text, a bare &, unknown entities and nullish values alone", () => {
    expect(decodeOsfText("R & D")).toBe("R & D");
    expect(decodeOsfText("&bogus;")).toBe("&bogus;");
    expect(decodeOsfText(undefined)).toBe("");
    expect(decodeOsfText(null)).toBe("");
  });
  it("escapeHtml round-trips decoded text", () => {
    const raw = "Methods &amp; &lt;data&gt;";
    expect(escapeHtml(decodeOsfText(raw))).toBe(raw);
  });
});

describe("parse sites decode", () => {
  it("parseNode decodes title and description", () => {
    const n = parseNode({ data: { id: "abcde", attributes: { title: "A &amp; B", description: "x &lt; y" } } });
    expect(n.title).toBe("A & B");
    expect(n.description).toBe("x < y");
  });
});

describe("Zenodo metadata", () => {
  const base = {
    category: "project", tags: [], dateCreated: "2020-03-04T10:00:00", dateModified: "2026-01-01T10:00:00",
    osfUrl: "https://osf.io/abc12/", doi: null, license: null, contributors: [], resourceTypeId: "dataset", isIdenticalMirror: true,
  } as const;
  it("gets a plain-text title and an HTML-escaped description, so literal markup stays literal", () => {
    const { metadata } = crosswalk({ ...base, title: "A & B", description: "Use <b> & co" } as never);
    expect(metadata.title).toBe("A & B");
    expect(metadata.description).toBe("Use &lt;b&gt; &amp; co");
  });
});

describe("decodeOsfText never produces a lone surrogate or a control character", () => {
  it.each(["&#xD800;", "&#55296;", "&#1;", "&#13;", "&#x7f;"])("%s stays as the entity", (e) => {
    expect(decodeOsfText(`a${e}b`)).toBe(`a${e}b`);
    expect(() => encodeURIComponent(decodeOsfText(`a${e}b`))).not.toThrow();
  });
  it("control: tab, newline and an emoji still decode", () => {
    expect(decodeOsfText("a&#9;b&#10;c&#x1F600;")).toBe("a\tb\nc\u{1F600}");
  });
});
