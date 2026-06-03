"use client";

import { useEffect, useRef, useState } from "react";

export function DocxViewer({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ renderAsync }, res] = await Promise.all([
          import("docx-preview"),
          fetch(url),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        await renderAsync(blob, ref.current, undefined, {
          className: "docx-render",
          renderChanges: true,
        });
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div className="p-4">
      {loading && !error && <div className="text-neutral-500">Loading DOCX…</div>}
      {error && <div className="text-red-600">Failed to load DOCX: {error}</div>}
      <div ref={ref} className="max-w-4xl bg-white text-black [&_.docx-render]:p-6 [&_.docx-render]:shadow [&_.docx-render]:rounded" />
      {!loading && !error && (
        <p className="mt-2 text-xs text-neutral-500">
          Track changes rendering is experimental.{" "}
          <a href={`${url}&dl=1`} download className="underline">Download</a>{" "}
          for full document fidelity in Word.
        </p>
      )}
    </div>
  );
}
