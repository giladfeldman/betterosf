/**
 * Trigger a browser download of a backup archive.
 *
 * NOTE for the delete flow: the browser gives no completion callback for an `<a download>`
 * click. When the download is mandatory we unlock the confirm step on the CLICK, and the
 * UI says so plainly rather than implying we verified the file reached the disk. Claiming
 * a guarantee we cannot make is worse than stating the limit.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download in some
  // browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
