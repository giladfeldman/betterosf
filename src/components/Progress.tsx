"use client";

/**
 * Progress affordances shared across the app.
 *
 * The rule they encode: **a wait must say what is happening and how far along it
 * is.** A page that shows one static line for 27 seconds is indistinguishable
 * from a page that has crashed, and a user with 400 projects reasonably reads it
 * as stuck. (Reported from production, 2026-08-13, on /transition.)
 *
 * Where a real denominator exists, show a determinate bar — a percentage nobody
 * can verify is worse than a count. Where it does not, a spinner plus a live
 * count of what HAS arrived is honest: it says work is happening without
 * inventing an estimate of what is left.
 */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white ${className}`}
    />
  );
}

/**
 * A labelled progress bar.
 *
 * `total === null` means the denominator is genuinely unknown, and the bar goes
 * indeterminate rather than guessing one.
 */
export function ProgressBar({
  done,
  total,
  label,
  sublabel,
}: {
  done: number;
  total: number | null;
  label: string;
  sublabel?: string | null;
}) {
  const known = typeof total === "number" && total > 0;
  const pct = known ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <Spinner />
        <span>{label}</span>
        <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
          {known ? `${done} of ${total} (${pct}%)` : `${done} so far`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={known ? done : undefined}
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-label={label}
        className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"
      >
        {known ? (
          <div
            className="h-full bg-neutral-900 transition-[width] duration-300 dark:bg-white"
            style={{ width: `${pct}%` }}
          />
        ) : (
          // Indeterminate: a stripe that moves, never a width that implies a
          // fraction of a total we do not have.
          <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] bg-neutral-900 dark:bg-white" />
        )}
      </div>
      {sublabel ? (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{sublabel}</p>
      ) : null}
    </div>
  );
}

/** A one-line "working on it" for waits with nothing countable to report. */
export function Working({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
      <Spinner />
      <span>{children}</span>
    </p>
  );
}
