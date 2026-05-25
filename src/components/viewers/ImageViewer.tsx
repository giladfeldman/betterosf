"use client";
export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="p-4 flex justify-center items-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="max-w-full h-auto rounded shadow" />
    </div>
  );
}
