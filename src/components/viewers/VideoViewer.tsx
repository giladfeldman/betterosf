"use client";
export function VideoViewer({ url, filename }: { url: string; filename?: string }) {
  return (
    <div className="p-4">
      <video
        controls
        src={url}
        aria-label={filename ? `Video player: ${filename}` : "Video player"}
        className="max-w-full h-auto rounded shadow"
      >
        {/* OSF media has no caption track; declare an empty one so AT knows
            captions were considered (and absent) rather than simply omitted. */}
        <track kind="captions" />
      </video>
    </div>
  );
}
