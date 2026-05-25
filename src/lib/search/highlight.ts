import type { SearchAst } from "./parser";

/**
 * Collect every positive (non-NOT) term from a parsed search AST. Quoted phrases
 * are returned verbatim as multi-word strings; bare tokens come back individually.
 * NOT terms are intentionally excluded — they don't justify a result and shouldn't
 * be highlighted as if they did.
 */
export function collectPositiveTerms(ast: SearchAst): string[] {
  const out: string[] = [];
  function walk(n: SearchAst): void {
    if (n.type === "term") {
      const v = n.value.trim();
      if (v) out.push(v);
      return;
    }
    if (n.type === "not") {
      // Skip — caller shouldn't highlight NOT terms
      return;
    }
    for (const c of n.children) walk(c);
  }
  walk(ast);
  // Dedup, case-insensitive
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const t of out) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(t);
  }
  return dedup;
}

/** Escape a string for use in a RegExp literal. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type HighlightSegment = { text: string; match: boolean };

/**
 * Split `text` into alternating non-match / match segments based on `terms`. Case-
 * insensitive substring match; longest terms preferred first to avoid sub-term
 * shadows (e.g. "social priming" beats "social").
 */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  if (!text) return [{ text: "", match: false }];
  const cleanTerms = terms.filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  if (cleanTerms.length === 0) return [{ text, match: false }];

  // Build one alternation regex with the terms in order
  const pattern = new RegExp(cleanTerms.map(escapeRegExp).join("|"), "gi");

  const result: HighlightSegment[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) result.push({ text: text.slice(lastIndex, idx), match: false });
    result.push({ text: m[0], match: true });
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < text.length) result.push({ text: text.slice(lastIndex), match: false });
  return result;
}

/**
 * Build a short context snippet around the first match of any term in `text`. If
 * no terms match, returns the first `windowChars` characters as a fallback. Used
 * to show "where the keywords appear" in result rows.
 */
export function snippetAroundMatch(text: string, terms: string[], windowChars = 200): string {
  if (!text) return "";
  const cleanTerms = terms.filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  if (cleanTerms.length === 0) {
    return text.length > windowChars ? text.slice(0, windowChars) + "…" : text;
  }

  const pattern = new RegExp(cleanTerms.map(escapeRegExp).join("|"), "i");
  const m = pattern.exec(text);
  if (!m) {
    return text.length > windowChars ? text.slice(0, windowChars) + "…" : text;
  }
  const start = Math.max(0, (m.index ?? 0) - Math.floor(windowChars / 3));
  const end = Math.min(text.length, start + windowChars);
  const leadEllipsis = start > 0 ? "…" : "";
  const trailEllipsis = end < text.length ? "…" : "";
  return leadEllipsis + text.slice(start, end) + trailEllipsis;
}
