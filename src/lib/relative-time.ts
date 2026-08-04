/**
 * Compact relative-time formatting for the workspace ("2h ago", "3d ago").
 *
 * Returns null for missing/invalid input so callers render an explicit
 * "unknown" state instead of a fabricated date — entries saved before visit
 * tracking existed genuinely have no timestamp, and showing them as "56y ago"
 * (the epoch) would be worse than admitting we don't know.
 */
export function formatRelativeTime(epochMs: number | undefined, now: number = Date.now()): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return null;

  const diff = now - epochMs;
  // Small negative skew (clock drift between tabs) reads as "just now" rather
  // than a nonsensical future time.
  if (diff < 0 && diff > -60_000) return "just now";
  if (diff < 0) return null;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/** Absolute timestamp for the `title` tooltip, so the exact time is recoverable. */
export function formatAbsoluteTime(epochMs: number | undefined): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
