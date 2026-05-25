"use client";
export function HtmlViewer({ url }: { url: string }) {
  return (
    <div className="p-2 h-full">
      <iframe
        src={url}
        sandbox="allow-same-origin"
        className="w-full h-full border rounded"
        title="HTML preview"
      />
    </div>
  );
}
