import { describe, it, expect } from "vitest";
import { renderProducedContent } from "@/components/viewers/DocxViewer";

// docx-preview renders document content into <article> elements inside each
// page <section>. A malformed multi-body .docx (e.g. Qualtrics survey exports
// with hundreds of <w:body> elements) makes docx-preview read only the first
// body — often empty — and resolve WITHOUT throwing, leaving an empty
// <article>. renderProducedContent() is how DocxViewer detects that blank
// result so it can show "couldn't preview — malformed file" instead of a
// silent gray page. These tests lock both directions in.
function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("renderProducedContent (DOCX empty-render detection)", () => {
  it("returns false when docx-preview produced an empty article (malformed multi-body file)", () => {
    expect(renderProducedContent(container('<section class="docx-render"><article></article></section>'))).toBe(false);
  });

  it("returns false when there are no article elements at all", () => {
    expect(renderProducedContent(container("<section></section>"))).toBe(false);
    expect(renderProducedContent(container(""))).toBe(false);
  });

  it("returns true when an article has element children (normal paragraphs)", () => {
    expect(
      renderProducedContent(container('<section class="docx-render"><article><p>Hello document.</p></article></section>')),
    ).toBe(true);
  });

  it("returns true when an article has only text content", () => {
    expect(renderProducedContent(container("<section><article>some text</article></section>"))).toBe(true);
  });

  it("returns true when an article holds only an image (no text)", () => {
    expect(
      renderProducedContent(container('<section><article><img src="x.png" /></article></section>')),
    ).toBe(true);
  });

  it("returns false when articles exist but are all whitespace-only", () => {
    expect(renderProducedContent(container("<section><article>   \n  </article></section>"))).toBe(false);
  });
});
