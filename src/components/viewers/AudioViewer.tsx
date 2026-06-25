"use client";
export function AudioViewer({ url, filename }: { url: string; filename?: string }) {
  return (
    <div className="p-4">
      <audio
        controls
        src={url}
        aria-label={filename ? `Audio player: ${filename}` : "Audio player"}
        className="w-full"
      >
        {/* OSF media has no caption track; declare an empty one so AT knows
            captions were considered (and absent) rather than simply omitted. */}
        <track kind="captions" />
      </audio>
    </div>
  );
}
