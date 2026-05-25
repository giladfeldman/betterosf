"use client";
export function VideoViewer({ url }: { url: string }) {
  return (
    <div className="p-4">
      <video controls src={url} className="max-w-full h-auto rounded shadow" />
    </div>
  );
}
