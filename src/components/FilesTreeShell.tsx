"use client";

import { useState } from "react";
import type { FileEntry, ProviderRoot } from "@/lib/osf/files";

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

  return (
    <div className="font-mono-files text-sm">
      {providers.map((p) => (
        <div key={p.provider} className="mb-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => ({ ...e, [p.provider]: !e[p.provider] }))}
            className="font-semibold text-left w-full hover:underline"
          >
            <span aria-hidden="true">{expanded[p.provider] ? "▼" : "▶"}</span>{" "}
            <span>{p.name}</span>
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
