"use client";

/**
 * Header strip shown above rendered text/code content.
 *
 * It exists because a text viewer that renders *nothing* is indistinguishable
 * from a broken page. A genuinely empty file (0 bytes) or a whitespace-only file
 * produces no visible glyphs, so without this the user sees a blank pane and
 * reasonably concludes the app failed — which is exactly what happened with
 * `test.txt` on 3kmr9 (user report 2026-08-04).
 *
 * Stating "this file is empty" is a factual report about the data, not a
 * decoration: it distinguishes "we loaded it and there is nothing in it" from
 * "we failed to load it".
 */

/** True when the content has no visible characters (empty OR whitespace-only). */
export function isBlankText(text: string): boolean {
  return text.trim().length === 0;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "unknown size";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  // A trailing newline shouldn't inflate the count: "a\n" is 1 line, not 2.
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  return normalized.split(/\r\n|\r|\n/).length;
}

export function TextMeta({
  filename,
  text,
  sizeBytes,
}: {
  filename: string;
  text: string;
  sizeBytes: number | null;
}) {
  const empty = text.length === 0;
  const whitespaceOnly = !empty && isBlankText(text);
  const lines = countLines(text);

  return (
    <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-medium text-neutral-800 dark:text-neutral-200">{filename}</span>
        <span>{formatBytes(sizeBytes)}</span>
        {!empty && (
          <>
            <span>
              {lines} line{lines === 1 ? "" : "s"}
            </span>
            <span>
              {text.length} character{text.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>
      {empty && (
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">
          This file is empty — it contains no data on OSF. Nothing is shown below because there is
          nothing to show.
        </p>
      )}
      {whitespaceOnly && (
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">
          This file contains only whitespace, so it appears blank below.
        </p>
      )}
    </div>
  );
}
