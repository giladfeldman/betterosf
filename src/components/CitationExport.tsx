"use client";

import { useState } from "react";

export function CitationExport({
  apa,
  mla,
  chicago,
  bibtex,
  ris,
}: {
  apa: string;
  mla: string;
  chicago: string;
  bibtex: string;
  ris: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  // Only show formats that actually have content — empty cells with "Not
  // available" looked broken in production. OSF sometimes returns 200 with
  // empty body for MLA/Chicago on projects without contributor metadata.
  const formats: Array<{ label: string; value: string }> = [
    { label: "APA", value: apa },
    { label: "MLA", value: mla },
    { label: "Chicago", value: chicago },
    { label: "BibTeX", value: bibtex },
    { label: "RIS", value: ris },
  ].filter((f) => f.value.trim().length > 0);

  if (formats.length === 0) {
    return (
      <section className="mt-6">
        <h3 className="font-semibold mb-2">Cite this</h3>
        <p className="text-xs text-neutral-500">No citation metadata available from OSF for this project.</p>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h3 className="font-semibold mb-2">Cite this</h3>
      <ul className="space-y-2 text-sm">
        {formats.map((f) => (
          <li key={f.label} className="border rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs uppercase">{f.label}</span>
              <button
                type="button"
                onClick={() => copy(f.label, f.value)}
                className="text-xs border rounded px-2 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {copied === f.label ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono">{f.value}</pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
