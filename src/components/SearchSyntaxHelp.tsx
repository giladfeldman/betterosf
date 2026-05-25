"use client";

import { useState } from "react";

export function SearchSyntaxHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Search syntax help"
        title="Search syntax help"
        onClick={() => setOpen((o) => !o)}
        className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 border rounded w-6 h-6 inline-flex items-center justify-center"
      >
        ?
      </button>
      {open && (
        <div className="absolute z-20 mt-2 p-3 bg-white dark:bg-neutral-900 border rounded shadow-lg max-w-sm text-sm top-full right-0">
          <h3 className="font-semibold mb-2">Search syntax</h3>
          <ul className="space-y-1">
            <li><code>foo bar</code> &mdash; both must match (AND is default)</li>
            <li><code>foo OR bar</code> &mdash; either matches (uppercase OR)</li>
            <li><code>&quot;social priming&quot;</code> &mdash; exact phrase</li>
            <li><code>-fraud</code> &mdash; exclude results matching</li>
            <li><code>(a OR b) AND c</code> &mdash; group with parentheses</li>
          </ul>
        </div>
      )}
    </>
  );
}
