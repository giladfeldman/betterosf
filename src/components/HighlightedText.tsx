import { Fragment } from "react";
import { highlightSegments, snippetAroundMatch } from "@/lib/search/highlight";

/**
 * Render text with case-insensitive matches of any `terms` wrapped in a styled
 * `<mark>`. Use in search result rows so the user sees WHY each result matched.
 *
 * Non-match segments are emitted as raw text nodes (inside a `<Fragment>` for the
 * key) rather than nested `<span>`s. Wrapping them in `<span>`s causes Testing
 * Library's accname computation to drop boundary whitespace ("Replication 1" was
 * computed as "Replication1"), which silently breaks `getByRole("link", { name })`
 * lookups in tests AND screen-reader announcements.
 */
export function HighlightedText({ text, terms, className }: { text: string; terms: string[]; className?: string }) {
  if (!text) return null;
  const segments = highlightSegments(text, terms);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        )
      )}
    </span>
  );
}

/**
 * Like `HighlightedText`, but first builds a snippet around the first match so
 * very long descriptions don't overwhelm the result row.
 */
export function HighlightedSnippet({
  text,
  terms,
  className,
  windowChars = 200,
}: {
  text: string;
  terms: string[];
  className?: string;
  windowChars?: number;
}) {
  if (!text) return null;
  const snippet = snippetAroundMatch(text, terms, windowChars);
  return <HighlightedText text={snippet} terms={terms} className={className} />;
}

/**
 * Render a small "Matched on: title, description" hint line so it's explicit
 * WHICH fields contributed to a result. Pass field-name => text pairs.
 */
export function MatchHints({ fields, terms }: { fields: Record<string, string>; terms: string[] }) {
  if (terms.length === 0) return null;
  const lowered = terms.map((t) => t.toLowerCase());
  const matched: string[] = [];
  for (const [name, text] of Object.entries(fields)) {
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lowered.some((t) => lower.includes(t))) matched.push(name);
  }
  if (matched.length === 0) return null;
  return (
    <p className="text-[10px] uppercase tracking-wide text-neutral-500 mt-1">
      Matched on: {matched.join(", ")}
    </p>
  );
}
