"use client";

import { Worker, Viewer } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

export function PdfViewer({ url }: { url: string }) {
  const layout = defaultLayoutPlugin();
  return (
    <div className="h-full">
      <Worker workerUrl="https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.js">
        <Viewer fileUrl={url} plugins={[layout]} />
      </Worker>
    </div>
  );
}
