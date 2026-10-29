"use client";

import { useState } from "react";

type Formats = { apa: string; mla: string; chicago: string; bibtex: string; ris: string };

/**
 * "Cite this" panel — loads citation formats ON DEMAND.
 *
 * Previously the parent server component fetched all five formats (4 OSF calls)
 * on every project-overview render, whether or not anyone looked at them. That
 * was ~40% of the OSF requests spent painting an overview, spent on a panel most
 * visitors never scroll to, and it made the page materially more likely to trip
 * OSF's rate limit.
 *
 * Now the overview paints immediately and the calls happen only when a user
 * actually asks for a citation.
 */
export function CitationExport({ guid }: { guid: string }) {
  const [formats, setFormats] = useState<Formats | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  // The route's own message ("Your OSF connection expired. Sign out and sign in again…"),
  // so an expired token is never shown as a generic, retry-forever failure.
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/osf/citation/${guid}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; action?: string } | null;
        setErrorText(body?.error ? [body.error, body.action].filter(Boolean).join(" ") : null);
        throw new Error(`HTTP ${res.status}`);
      }
      setErrorText(null);
      setFormats((await res.json()) as Formats);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (formats === null) {
    return (
      <section className="mt-6">
        <h3 className="font-semibold mb-2">Cite this</h3>
        {state === "error" ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {errorText ?? "Couldn’t load citations from OSF."}{" "}
            <button type="button" onClick={load} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 disabled:text-neutral-500 dark:hover:bg-neutral-900"
          >
            {state === "loading" ? "Loading citations…" : "Show citation formats"}
          </button>
        )}
      </section>
    );
  }

  // Only show formats that actually have content — empty cells with "Not
  // available" looked broken in production. OSF sometimes returns 200 with
  // empty body for MLA/Chicago on projects without contributor metadata.
  const rows: Array<{ label: string; value: string }> = [
    { label: "APA", value: formats.apa },
    { label: "MLA", value: formats.mla },
    { label: "Chicago", value: formats.chicago },
    { label: "BibTeX", value: formats.bibtex },
    { label: "RIS", value: formats.ris },
  ].filter((f) => f.value.trim().length > 0);

  if (rows.length === 0) {
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
        {rows.map((f) => (
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
