"use client";

import { useState } from "react";

export type AdminBugReport = {
  id: string;
  kind: string;
  message: string;
  contactEmail: string | null;
  pageUrl: string | null;
  appVersion: string | null;
  osfUserId: string | null;
  status: string;
  createdAt: string;
};

const KIND_BADGE: Record<string, string> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  idea: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  question: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * Only render a page link when it is a genuine same-app relative path.
 *
 * The API filters this on the way in, but rows stored BEFORE that filter existed
 * are still in the database, and the admin inbox is the one place a hostile URL
 * would actually be clicked. So this re-checks independently rather than
 * trusting stored data.
 *
 * `//evil.example` and `/\evil.example` start with "/" but resolve to a
 * different origin — they must not become links.
 */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  if (/^[/\\][/\\]/.test(url)) return null;
  if (url.startsWith("/")) return url;
  return null;
}

export function BugReportRow({ report }: { report: AdminBugReport }) {
  const [status, setStatus] = useState(report.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = safeHref(report.pageUrl);

  async function update(next: string) {
    setBusy(true);
    setError(null);
    const previous = status;
    setStatus(next); // optimistic
    try {
      const res = await fetch(`/api/admin/feedback/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setStatus(previous); // roll back — never show a state the server rejected
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Update failed (HTTP ${res.status}).`);
      }
    } catch {
      setStatus(previous);
      setError("Network error — status not changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${KIND_BADGE[report.kind] ?? KIND_BADGE.bug}`}>
          {report.kind}
        </span>
        <span className="text-neutral-500">{new Date(report.createdAt).toLocaleString()}</span>
        {report.appVersion && <span className="text-neutral-500">v{report.appVersion}</span>}
        {report.osfUserId ? (
          <span className="text-neutral-500">OSF {report.osfUserId}</span>
        ) : (
          <span className="text-neutral-400">signed out</span>
        )}
        <span className="ml-auto rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700">
          {status}
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm">{report.message}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {href ? (
          <a className="text-blue-600 hover:underline dark:text-blue-400" href={href}>
            {report.pageUrl}
          </a>
        ) : (
          // Still SHOW an untrusted URL — it is diagnostic information — but as
          // inert text, never as a clickable link.
          report.pageUrl && (
            <span className="font-mono text-neutral-500" title="Not linked: not a BetterOSF page">
              {report.pageUrl} (external — not linked)
            </span>
          )
        )}
        {report.contactEmail && (
          <a
            className="text-blue-600 hover:underline dark:text-blue-400"
            href={`mailto:${report.contactEmail}?subject=${encodeURIComponent("Re: your BetterOSF report")}`}
          >
            Reply to {report.contactEmail}
          </a>
        )}
        <span className="ml-auto flex gap-2">
          {["new", "triaged", "resolved"]
            .filter((s) => s !== status)
            .map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => update(s)}
                className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Mark {s}
              </button>
            ))}
        </span>
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}
