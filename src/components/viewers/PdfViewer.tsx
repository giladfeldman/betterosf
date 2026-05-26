"use client";

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
  const layout = defaultLayoutPlugin();
  return (
    <div className="h-full">
      <Worker workerUrl={WORKER_URL}>
        <Viewer fileUrl={url} plugins={[layout]} />
      </Worker>
    </div>
  );
}
