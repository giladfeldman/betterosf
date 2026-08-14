"use client";

import { downloadBlob } from "@/lib/backup/download";
import type { RunLogEntry } from "@/lib/transition/run-export";

/**
 * The run diary, rendered.
 *
 * Collapsed, because most runs succeed and nobody wants it then. Present, because when a
 * run fails the difference between a useful bug report and another round trip is whether
 * the reporter can say *which file, which phase, which attempt*. "AbortError: The operation
 * was aborted" is none of those.
 */
export function RunLog({ entries }: { entries: RunLogEntry[] }) {
  if (entries.length === 0) return null;

  const text = entries
    .map((e) => {
      const where = e.index ? ` [${e.index}]` : "";
      const path = e.path ? ` ${e.path}` : "";
      const attempt = e.attempt ? ` (attempt ${e.attempt})` : "";
      const ms = typeof e.ms === "number" ? ` ${e.ms}ms` : "";
      const err = e.error ? ` — ${e.error}` : "";
      return `${e.at} ${e.phase}${where}${path}${attempt}: ${e.message}${ms}${err}`;
    })
    .join("\n");

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm">Run log ({entries.length} steps)</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
        {text}
      </pre>
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([text], { type: "text/plain" }), "betterosf-run-log.txt")}
          className="text-xs underline"
        >
          Download the run log
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}
          className="text-xs underline"
        >
          Copy the run log
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
        This is what BetterOSF did, step by step. It contains your file paths and no credentials.
      </p>
    </details>
  );
}
