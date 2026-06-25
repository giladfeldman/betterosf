"use client";

import { useEffect, useRef, useState } from "react";
import type { TreeUploadTarget } from "./tree-types";
import { readErrorResponse } from "@/lib/http/read-error";

export function NewFolderControl({
  target,
  onCreated,
}: {
  target: TreeUploadTarget;
  onCreated?: (target: TreeUploadTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  function reset() {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    setOpen(false);
    setName("");
    setError("");
    setDone("");
    setCreating(false);
  }

  async function submit() {
    const folderName = name.trim();
    if (!folderName || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/files/${target.guid}/folder-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: target.provider,
          path: target.path,
          listingUrl: target.listingUrl,
          uploadUrl: target.uploadUrl,
          newFolderUrl: target.newFolderUrl,
          name: folderName,
        }),
      });
      if (!res.ok) {
        // Surface the REAL server/OSF message (incl. non-JSON 429 text), not a generic string.
        const { message } = await readErrorResponse(res);
        setError(message || "Folder creation failed");
        setCreating(false);
        return;
      }
      // Success: confirm explicitly, refresh the tree so the folder appears, then close.
      setCreating(false);
      setDone(`✓ Created "${folderName}"`);
      onCreated?.(target);
      doneTimer.current = setTimeout(reset, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Folder creation failed");
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`New folder in ${target.name}`}
        title={`New folder in ${target.name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
      >
        + Folder
      </button>
    );
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300" onClick={(e) => e.stopPropagation()}>
        {done}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={name}
        aria-label="New folder name"
        placeholder="Folder name"
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            reset();
          }
        }}
        className="w-32 rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-950"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!name.trim() || creating}
        aria-busy={creating}
        className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        {creating ? "Creating…" : error ? "Retry" : "Create"}
      </button>
      <button
        type="button"
        onClick={reset}
        className="shrink-0 rounded border border-neutral-300 px-1.5 text-[11px] hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Cancel
      </button>
      {error && (
        <span className="basis-full break-words text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
