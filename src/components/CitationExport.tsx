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

  const formats: Array<{ label: string; value: string }> = [
    { label: "APA", value: apa },
    { label: "MLA", value: mla },
    { label: "Chicago", value: chicago },
    { label: "BibTeX", value: bibtex },
    { label: "RIS", value: ris },
  ];

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
                disabled={!f.value}
              >
                {copied === f.label ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {f.value || <span className="text-neutral-500">Not available.</span>}
            </pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
