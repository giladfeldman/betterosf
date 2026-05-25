"use client";
export function AudioViewer({ url }: { url: string }) {
  return (
    <div className="p-4">
      <audio controls src={url} className="w-full" />
    </div>
  );
}
