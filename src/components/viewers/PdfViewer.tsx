"use client";

import { useEffect, useState } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

// Self-hosted from public/pdf.worker.min.mjs (see scripts/copy-pdfjs-worker.mjs).
// Two failure modes the old unpkg URL hit:
//   1. The hardcoded version (5.7.284) drifted from the installed pdfjs-dist.
//   2. pdfjs-dist v5 deprecated `.js` workers — only `.mjs` ships now, so the
//      unpkg URL returned 404 and pdf.js's fake-worker fallback also failed.
// Same-origin + version-locked-to-package is the only durable fix.
const WORKER_URL = "/pdf.worker.min.mjs";

export function PdfViewer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Read the full file as an ArrayBuffer, tracking download progress
        // so users see something happening instead of a blank spinner.
        const contentLength = res.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        const reader = res.body!.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;

        if (total > 0) setProgress({ loaded: 0, total });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) return;
          chunks.push(value!);
          loaded += value!.byteLength;
          if (total > 0) setProgress({ loaded, total });
        }

        const blob = new Blob(chunks, { type: "application/pdf" });
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        setBlobUrl(objectUrl);
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  const layout = defaultLayoutPlugin();

  return (
    <div className="h-full">
      {loading && !error && (
        <div className="p-4">
          <div className="text-neutral-500 mb-2">Loading PDF…</div>
          {progress && (
            <div className="w-full max-w-md bg-neutral-200 dark:bg-neutral-700 rounded h-2 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-[width] duration-150"
                style={{ width: `${Math.min(100, (progress.loaded / progress.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {error && <div className="p-4 text-red-600">Failed to load PDF: {error}</div>}
      {blobUrl && (
        <Worker workerUrl={WORKER_URL}>
          <Viewer fileUrl={blobUrl} plugins={[layout]} />
        </Worker>
      )}
    </div>
  );
}
