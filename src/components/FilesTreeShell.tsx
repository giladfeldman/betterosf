"use client";

import { useState, useMemo, useEffect } from "react";
import type { FileEntry, ProviderRoot } from "@/lib/osf/files";
import type { RecursiveEntry } from "@/lib/osf/files-recursive";
import { WithinProjectSearch } from "./WithinProjectSearch";

type ProviderInitial = ProviderRoot & { initialEntries: FileEntry[] };

export function FilesTreeShell({
  guid,
  providers,
}: {
  guid: string;
  providers: ProviderInitial[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(providers.map((p) => [p.provider, true]))
  );
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);
  const [deepEntries, setDeepEntries] = useState<RecursiveEntry[] | null>(null);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [loadingDeep, setLoadingDeep] = useState(false);

  // Load deep entries when toggle flips on; reuse cached on subsequent flips
  useEffect(() => {
    if (!deep || deepEntries !== null) return;
    let cancelled = false;
    (async () => {
      setLoadingDeep(true);
      setDeepError(null);
      try {
        const res = await fetch(`/api/files/${guid}/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { entries: RecursiveEntry[] } = await res.json();
        if (!cancelled) setDeepEntries(data.entries);
      } catch (e) {
        if (!cancelled) setDeepError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingDeep(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deep, deepEntries, guid]);

  const topFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.map((p) => ({
      ...p,
      initialEntries: p.initialEntries.filter((e) => e.name.toLowerCase().includes(q)),
    }));
  }, [providers, query]);

  const deepMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !deep || !deepEntries) return [];
    return deepEntries.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 500);
  }, [query, deep, deepEntries]);

  return (
    <div>
      <div className="mb-3">
        <WithinProjectSearch
          value={query}
          onChange={setQuery}
          deep={deep}
          onDeepChange={setDeep}
          loadingDeep={loadingDeep}
        />
        {deepError && (
          <p className="text-xs text-red-600 mt-1">Deep-search load failed: {deepError}</p>
        )}
        {query && !deep && (
          <p className="text-xs text-neutral-500 mt-1">
            Filtering top-level entries only. Enable &ldquo;Include collapsed folders&rdquo; to search the whole tree.
          </p>
        )}
      </div>

      {query && deep && deepEntries && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-1">Deep matches ({deepMatches.length}{deepMatches.length === 500 ? "+" : ""})</h3>
          <ul className="font-mono-files text-sm space-y-0.5">
            {deepMatches.map((e) => (
              <li key={`${e.provider}:${e.materializedPath}`}>
                {e.kind === "folder" ? (
                  <a
                    href={`/${guid}/files/${e.provider}${e.materializedPath}`}
                    className="text-blue-600 hover:underline"
                  >
                    <span aria-hidden="true">📁</span> <span>{e.provider}{e.materializedPath}</span>
                  </a>
                ) : (
                  <a href={e.downloadUrl} className="hover:underline">
                    <span aria-hidden="true">📄</span> <span>{e.provider}{e.materializedPath}</span>
                  </a>
                )}
              </li>
            ))}
            {deepMatches.length === 0 && <li className="text-neutral-500">(no matches)</li>}
          </ul>
        </div>
      )}

      <div className="font-mono-files text-sm">
        {topFiltered.map((p) => (
          <div key={p.provider} className="mb-3">
            <button
              type="button"
              onClick={() => setExpanded((e) => ({ ...e, [p.provider]: !e[p.provider] }))}
              className="font-semibold text-left w-full hover:underline"
            >
              <span aria-hidden="true">{expanded[p.provider] ? "▼" : "▶"}</span> <span>{p.name}</span>
              <a
                href={`/api/zip/${guid}/${p.provider}`}
                className="ml-3 text-xs text-blue-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                [⬇ ZIP]
              </a>
            </button>
            {expanded[p.provider] && (
              <ul className="ml-4 mt-1 space-y-0.5">
                {p.initialEntries.map((entry) => (
                  <li key={entry.id}>
                    {entry.kind === "folder" ? (
                      <a
                        href={`/${guid}/files/${p.provider}${entry.materializedPath}`}
                        className="text-blue-600 hover:underline"
                      >
                        <span aria-hidden="true">📁</span> <span>{entry.name}</span>
                      </a>
                    ) : (
                      <a href={entry.downloadUrl} className="hover:underline">
                        <span aria-hidden="true">📄</span> <span>{entry.name}</span>
                        {entry.size !== null && (
                          <span className="ml-2 text-neutral-500 text-xs">{formatSize(entry.size)}</span>
                        )}
                      </a>
                    )}
                  </li>
                ))}
                {p.initialEntries.length === 0 && <li className="text-neutral-500">(empty)</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
