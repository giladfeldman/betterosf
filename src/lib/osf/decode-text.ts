/**
 * OSF's API returns user-entered `title` and `description` HTML-escaped: a title typed as
 * "Peer Community In & Journal" arrives as "Peer Community In &amp; Journal" (measured on
 * the df9tj components, 2026-11-16 and 2026-11-18). React escapes text again on render,
 * so the page showed "&amp;", and the same string went into ZIP folder names and Zenodo
 * titles. Decode ONCE, where an OSF title or description is parsed (d-760cbc).
 *
 * Not every OSF endpoint escapes: `/citation/` returns the plain "&" (measured 2026-11-18),
 * so this must not be applied there — decoding twice would corrupt a literal "&amp;".
 *
 * Anything that puts decoded text back into HTML (Zenodo's `description` is HTML) must
 * escape it again: see `escapeHtml`.
 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function decodeOsfText(value: unknown): string {
  const s = String(value ?? "");
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // A lone surrogate breaks encodeURIComponent and JSON consumers; a control character has
      // no business in a title or a file name. Both stay as the entity OSF sent.
      const control = code < 0x20 && code !== 0x09 && code !== 0x0a;
      const surrogate = code >= 0xd800 && code <= 0xdfff;
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !control && !surrogate && code !== 0x7f
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Escape plain text for an HTML field (Zenodo's description). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
