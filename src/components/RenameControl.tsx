"use client";

// Inline rename affordance for a single tree row.
//
// Renders ONLY when the row's selection payload carries deleteUrl + parentListingUrl —
// the same canDeleteHere gating (canUploadHere && confirmed write session) the Delete
// button uses, threaded through UnifiedTree's emitters. Never gate this on readOnly
// alone: that is true for signed-out visitors (see the 2026-08-03 leaked-Delete
// incident in KNOWN_ISSUES.md).
//
// The rename itself is a safe, in-place Waterbutler `{"action":"rename"}` on the
// server route — file identity and history survive, unlike delete + re-upload.

import { useEffect, useRef, useState } from "react";
import type { TreeSelectionPayload } from "./tree-types";
import { readErrorResponse } from "@/lib/http/read-error";

export function RenameControl({
  selection,
  onRenamed,
}: {
  selection: TreeSelectionPayload;
  onRenamed?: (selection: TreeSelectionPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(selection.name);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  function reset() {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    setOpen(false);
    setName(selection.name);
    setError("");
    setDone("");
    setRenaming(false);
  }

  async function submit() {
    const newName = name.trim();
    if (!newName || renaming) return;
    if (newName === selection.name) {
      reset();
      return;
    }
    // The server re-checks all of this; failing fast here just saves a round-trip.
    if (newName === "." || newName === ".." || newName.includes("/") || newName.includes("\\")) {
      setError("Names cannot be '.' or '..' or contain slashes.");
      return;
    }
    setRenaming(true);
    setError("");
    try {
      const res = await fetch(`/api/files/${selection.guid}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selection.provider,
          kind: selection.kind,
          path: selection.path,
          name: selection.name,
          newName,
          // The item's own Waterbutler URL — OSF serves the identical URL under
          // links.move and links.delete; the tree carries it as deleteUrl.
          moveUrl: selection.deleteUrl,
          listingUrl: selection.parentListingUrl,
        }),
      });
      if (!res.ok) {
        // Surface the REAL server/OSF message (incl. non-JSON 429 text), not a generic string.
        const { message } = await readErrorResponse(res);
        setError(message || "Rename failed");
        setRenaming(false);
        return;
      }
      const json: { ok: boolean; result?: { status: string; message?: string } } = await res.json();
      if (!json.ok) {
        // Per-item outcome — a 200 with a failed result must never render as success.
        setError(json.result?.message || "Rename failed");
        setRenaming(false);
        return;
      }
      setRenaming(false);
      setDone(`✓ Renamed to "${newName}"`);
      onRenamed?.(selection);
      doneTimer.current = setTimeout(reset, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
      setRenaming(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Rename ${selection.name}`}
        title={`Rename ${selection.name} (keeps the file and its history — no delete involved)`}
        onClick={(e) => {
          e.stopPropagation();
          setName(selection.name);
          setOpen(true);
        }}
        className="shrink-0 rounded border border-neutral-300 px-1.5 text-[11px] hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Rename
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
        aria-label={`New name for ${selection.name}`}
        placeholder="New name"
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
        className="w-40 rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-950"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!name.trim() || renaming}
        aria-busy={renaming}
        className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
      >
        {renaming ? "Renaming…" : error ? "Retry" : "Save"}
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
