"use client";

import { useEffect, useState } from "react";

export function CsvViewer({ url }: { url: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // @ts-expect-error - papaparse has no bundled types; behaviour is well-defined
        const [{ default: Papa }, res] = await Promise.all([import("papaparse"), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = (Papa as { parse: (t: string, o: object) => { data: string[][] } }).parse(text, { delimiter: "", skipEmptyLines: true });
        if (!cancelled) setRows(parsed.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed: {error}</div>;
  if (!rows) return <div className="p-4 text-neutral-500">Loading CSV…</div>;

  return (
    <div className="p-2 overflow-auto h-full">
      <table className="text-sm font-mono-files border-collapse">
        <tbody>
          {rows.slice(0, 5000).map((row, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-neutral-100 dark:bg-neutral-800 font-semibold sticky top-0" : ""}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-neutral-200 dark:border-neutral-800 px-2 py-1 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 5000 && (
        <p className="text-xs text-neutral-500 mt-2">Showing first 5000 of {rows.length} rows. Download for the full file.</p>
      )}
    </div>
  );
}
