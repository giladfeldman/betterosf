/** Byte formatting shared by every transition surface, so two panels cannot disagree. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "an unknown amount";
  if (bytes === 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
