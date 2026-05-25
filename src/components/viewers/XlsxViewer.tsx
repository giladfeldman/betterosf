"use client";

import { useEffect, useState } from "react";

type Sheet = { name: string; rows: (string | number | boolean | null)[][] };

export function XlsxViewer({ url }: { url: string }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [XLSX, res] = await Promise.all([import("xlsx"), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const out: Sheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          if (!ws) return { name, rows: [] };
          return {
            name,
            rows: XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, { header: 1, defval: null }),
          };
        });
        if (!cancelled) setSheets(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed: {error}</div>;
  if (!sheets) return <div className="p-4 text-neutral-500">Loading spreadsheet…</div>;
  const active = sheets[activeIdx];
  if (!active) return <div className="p-4 text-neutral-500">Empty workbook</div>;

  return (
    <div className="p-2 overflow-auto h-full">
      {sheets.length > 1 && (
        <div className="flex gap-1 mb-2 border-b border-neutral-200 dark:border-neutral-800">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`px-3 py-1 text-sm ${i === activeIdx ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <table className="text-sm font-mono-files border-collapse">
        <tbody>
          {active.rows.slice(0, 2000).map((row, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-neutral-100 dark:bg-neutral-800 font-semibold sticky top-0" : ""}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-neutral-200 dark:border-neutral-800 px-2 py-1 whitespace-nowrap">
                  {cell == null ? "" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {active.rows.length > 2000 && (
        <p className="text-xs text-neutral-500 mt-2">
          Showing first 2000 of {active.rows.length} rows. Download for the full file.
        </p>
      )}
    </div>
  );
}
