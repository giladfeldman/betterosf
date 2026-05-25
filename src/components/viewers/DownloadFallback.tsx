export function DownloadFallback({
  filename,
  downloadUrl,
  sizeBytes,
  reason,
  forceOpenHref,
}: {
  filename: string;
  downloadUrl: string;
  sizeBytes: number | null;
  reason: "too-large" | "unknown-format";
  forceOpenHref?: string;
}) {
  const sizeMB = sizeBytes != null ? (sizeBytes / 1024 / 1024).toFixed(1) : null;
  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-xl font-semibold mb-2">{filename}</h2>
      {sizeMB && <p className="text-sm text-neutral-500 mb-4">{sizeMB} MB</p>}
      <p className="text-neutral-700 dark:text-neutral-300 mb-4">
        {reason === "too-large"
          ? "This file is larger than BetterOSF's in-browser preview cap. Download to view it."
          : "No in-browser viewer for this file type yet. Download to view it."}
      </p>
      <div className="flex gap-3">
        <a
          href={downloadUrl}
          download={filename}
          className="inline-flex items-center border rounded px-3 py-2 bg-blue-600 text-white hover:bg-blue-700"
        >
          <span aria-hidden="true">⬇</span> <span>Download {filename}</span>
        </a>
        {forceOpenHref && (
          <a href={forceOpenHref} className="inline-flex items-center border rounded px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            Open anyway (may freeze)
          </a>
        )}
      </div>
    </div>
  );
}
