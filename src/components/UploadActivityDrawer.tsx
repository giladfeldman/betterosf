"use client";

import { useEffect, useRef, useState } from "react";
import { listActivity, subscribeActivity, clearActivity } from "@/lib/upload/log";
import type { ActivityEntry } from "@/lib/upload/types";
import { useFocusTrap } from "./useFocusTrap";

function StatusDot({ status }: { status: ActivityEntry["status"] }) {
  const color =
    status === "success" ? "bg-green-500"
    : status === "partial" ? "bg-amber-500"
    : status === "failed" ? "bg-red-500"
    : "bg-blue-500 animate-pulse";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

export function UploadActivityDrawer() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, open, () => setOpen(false));

  useEffect(() => {
    setEntries(listActivity());
    return subscribeActivity(() => {
      const next = listActivity();
      setEntries(next);
      // Auto-open while uploading or on any failure so problems can't be missed.
      if (next[0] && (next[0].status === "in_progress" || next[0].status === "failed" || next[0].status === "partial")) {
        setOpen(true);
      }
    });
  }, []);

  const latest = entries[0];
  const badge = latest
    ? latest.status === "in_progress" ? "…"
      : latest.status === "failed" || latest.status === "partial" ? "!"
      : "✓"
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Activity"
        title="Upload activity"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-950"
      >
        Activity {badge && <span className="font-semibold">{badge}</span>}
      </button>

      {open && (
        <aside
          ref={drawerRef}
          role="dialog"
          aria-label="Upload activity"
          tabIndex={-1}
          className="fixed right-0 top-0 z-50 flex h-full w-[min(24rem,calc(100vw-1rem))] flex-col border-l border-neutral-200 bg-white shadow-xl outline-none dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
            <h2 className="text-sm font-semibold">Upload activity</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => clearActivity()} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">Clear</button>
              <button type="button" onClick={() => setOpen(false)} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 text-sm">
            {entries.length === 0 && <p className="p-3 text-neutral-500">No uploads yet.</p>}
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={e.id} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    <StatusDot status={e.status} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={e.destinationLabel}>{e.destinationLabel}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                    {e.summary} — {e.confirmed} on OSF{e.skipped ? `, ${e.skipped} skipped` : ""}{e.failed ? `, ${e.failed} failed` : ""}
                  </p>
                  {e.failed > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-red-700 dark:text-red-300">
                      {e.outcomes.filter((o) => o.status === "failed").slice(0, 5).map((o) => (
                        <li key={o.path} title={o.detail}>{o.name} — {o.cause}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {entries.length >= 200 && <p className="p-2 text-xs text-neutral-500">Showing the most recent 200 uploads; older entries were trimmed.</p>}
          </div>
        </aside>
      )}
    </>
  );
}
