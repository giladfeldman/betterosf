"use client";

import Link from "next/link";
import type { OsfSoftFailureKind } from "@/lib/osf/backpressure";

/**
 * Soft, friendly HTTP-200 state shown when OSF applies *backpressure* to a
 * critical render-path fetch — a rate limit (429) or a persistent OSF outage
 * (5xx). Returning this from a server component (instead of rethrowing the
 * OsfError) keeps the response a 200, so OSF throttling no longer registers as
 * a Vercel 5xx. See `@/lib/osf/backpressure` for the classifier and the
 * incident background.
 *
 * It is a client component purely so "Retry" can re-request the page; the copy
 * mirrors the rate_limited / upstream branches of `[guid]/error.tsx`.
 */
export function OsfBackpressureNotice({
  kind,
  resourceLabel = "this page",
}: {
  kind: OsfSoftFailureKind;
  /** What the user was trying to open, e.g. "this project" — used in the copy. */
  resourceLabel?: string;
}) {
  const needsReconnect = kind === "needs_reconnect";
  const heading = needsReconnect ? "Your OSF connection expired" : "BetterOSF is waiting on OSF";
  const message = needsReconnect
    ? `OSF rejected the connection saved in this browser, so ${resourceLabel} couldn't be loaded. Reconnect OSF to continue — public content stays readable if you sign out instead.`
    : kind === "rate_limited"
      ? `OSF asked BetterOSF to slow down (rate limit) while loading ${resourceLabel}. This is temporary — wait a moment, then retry.`
      : `OSF didn't respond cleanly while loading ${resourceLabel}. This is usually temporary — retry, or open the resource on OSF while it recovers.`;
  return (
    <div className="max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">{heading}</h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-4">{message}</p>
      <div className="flex flex-wrap gap-2">
        {needsReconnect && (
          <Link
            href="/login"
            className="border px-3 py-1 rounded font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Reconnect OSF
          </Link>
        )}
        <button
          onClick={() => location.reload()}
          className="border px-3 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          Retry
        </button>
        <Link
          href="/"
          className="border px-3 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
