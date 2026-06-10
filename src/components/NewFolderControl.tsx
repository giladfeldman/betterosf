"use client";

import { useState } from "react";
import type { TreeUploadTarget } from "./UnifiedTreeNode";

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

  function reset() {
    setOpen(false);
    setName("");
    setError("");
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
        const body = await res.json().catch(() => ({ error: "Folder creation failed" }));
        setError(String(body.error ?? "Folder creation failed"));
        setCreating(false);
        return;
      }
      reset();
      onCreated?.(target);
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

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
        className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        {creating ? "..." : "Create"}
      </button>
      <button
        type="button"
        onClick={reset}
        className="shrink-0 rounded border border-neutral-300 px-1.5 text-[11px] hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Cancel
      </button>
      {error && (
        <span className="text-[11px] text-red-600 dark:text-red-400" title={error}>
          {error.length > 48 ? `${error.slice(0, 48)}…` : error}
        </span>
      )}
    </span>
  );
}
