"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import type { ApiError } from "@/lib/api-error";

/**
 * The one way BetterOSF shows a failure.
 *
 * Three layers, because three different people read an error message:
 *
 *   1. **What happened**, in a sentence, for the person in front of it.
 *   2. **What to do**, when there is something — an expired token needs a
 *      reconnect, and telling that person to "try again" is advice that can
 *      never work.
 *   3. **Technical details**, collapsed. Status, code, endpoint, timestamp and
 *      a request id that matches the server-side log entry. Collapsed because
 *      most people do not want it; present because the ones who do are usually
 *      the ones who can fix it, and "it just said error" is how a report
 *      arrives with nothing actionable in it.
 *
 * The request id is the bridge to the admin view: the user quotes it, and an
 * admin finds the full entry — including anything too detailed to put in a
 * browser — at /admin/logs.
 */
export function ErrorNotice({
  error,
  title,
  onRetry,
  retryLabel = "Try again",
  children,
}: {
  error: ApiError;
  /** Optional heading. Omit when the message alone reads fine in context. */
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra context the calling surface can add, e.g. "nothing on OSF changed". */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  // An expired OSF token has exactly one fix, and it is not "try again". Offering the
  // retry button alone would be advice that can never work — the user presses it, sees the
  // same error, and concludes the app is broken.
  const needsReconnect = error.code === "osf_unauthorized";

  const technical = [
    `status: ${error.status === 0 ? "no response" : error.status}`,
    error.code ? `code: ${error.code}` : null,
    error.endpoint ? `endpoint: ${error.endpoint}` : null,
    error.requestId ? `request id: ${error.requestId}` : null,
    error.at ? `at: ${error.at}` : null,
    error.detail,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      role="alert"
      className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <p className={title ? "mt-1" : undefined}>{error.message}</p>
      {error.action ? <p className="mt-2">{error.action}</p> : null}
      {children ? <div className="mt-2">{children}</div> : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {needsReconnect ? (
          <button
            type="button"
            onClick={() => void signIn("osf")}
            className="rounded bg-neutral-900 px-3 py-1 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Reconnect OSF
          </button>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-red-400 px-3 py-1 text-sm font-medium dark:border-red-700"
          >
            {retryLabel}
          </button>
        ) : null}
        <Link href="/feedback" className="text-sm underline">
          Report this
        </Link>
      </div>

      {technical ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs opacity-80">Technical details</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-red-100 p-2 text-xs dark:bg-red-900/40">
            {technical}
          </pre>
          <button
            type="button"
            onClick={() => {
              // Best-effort: clipboard access can be denied, and a failed copy
              // must not look like a successful one.
              navigator.clipboard
                ?.writeText(technical)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
            className="mt-2 text-xs underline"
          >
            {copied ? "Copied" : "Copy details"}
          </button>
          {error.requestId ? (
            <p className="mt-2 text-xs opacity-80">
              Quote <code>{error.requestId}</code> in a bug report — it matches the server log entry
              for this exact failure.
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
