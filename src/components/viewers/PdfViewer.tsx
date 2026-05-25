"use client";

// PDF viewer placeholder using native browser iframe.
// Will be upgraded to @react-pdf-viewer/core once dep install finishes.
export function PdfViewer({ url }: { url: string }) {
  return (
    <div className="h-full">
      <iframe src={url} className="w-full h-full border-0" title="PDF preview" />
    </div>
  );
}
