"use client";

// Move one tree row to another folder of the same project's OSF Storage (d-f2a1e2).
//
// Rendered under exactly the same gate as RenameControl — the selection must carry
// deleteUrl + parentListingUrl, which UnifiedTree sets only when canDeleteHere
// (canUploadHere && a confirmed write session). Never gate this on readOnly alone.
// Registrations never get here, and the server refuses them again regardless.
//
// The destination picker walks down ONE folder per click through the existing folder
// route, so opening it costs one OSF listing, not a walk of the whole project.

import { useEffect, useRef, useState } from "react";
import type { TreeSelectionPayload } from "./tree-types";
import { readErrorResponse } from "@/lib/http/read-error";

type Folder = { name: string; materializedPath: string; listingUrl: string };

function rootListingUrl(guid: string): string {
  return `https://api.osf.io/v2/nodes/${guid}/files/osfstorage/`;
}

function withSlash(p: string): string {
  return `${p.replace(/\/+$/, "")}/`;
}

export function MoveControl({
  selection,
  onMoved,
}: {
  selection: TreeSelectionPayload;
  onMoved?: (selection: TreeSelectionPayload, destListingUrl: string) => void;
}) {
  const root: Folder = { name: "OSF Storage", materializedPath: "/", listingUrl: rootListingUrl(selection.guid) };
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<Folder[]>([root]);
  const [subfolders, setSubfolders] = useState<Folder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  const here = trail[trail.length - 1]!;
  const sourcePath = selection.kind === "folder" ? withSlash(selection.path) : null;
  const isCurrentParent = here.listingUrl === selection.parentListingUrl;
  const insideItself = sourcePath !== null && withSlash(here.materializedPath).startsWith(sourcePath);

  async function list(folder: Folder) {
    setLoading(true);
    setError("");
    setSubfolders(null);
    try {
      const res = await fetch(
        `/api/files/${selection.guid}/folder?` + new URLSearchParams({ listingUrl: folder.listingUrl }),
      );
      if (!res.ok) {
        const { message } = await readErrorResponse(res);
        setError(message || "Could not list this folder.");
        return;
      }
      const json: { entries: { kind: string; name: string; materializedPath: string; listingUrl?: string }[] } = await res.json();
      setSubfolders(
        json.entries
          .filter((e) => e.kind === "folder" && e.listingUrl)
          .map((e) => ({ name: e.name, materializedPath: e.materializedPath, listingUrl: e.listingUrl! })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list this folder.");
    } finally {
      setLoading(false);
    }
  }

  function goTo(nextTrail: Folder[]) {
    setTrail(nextTrail);
    void list(nextTrail[nextTrail.length - 1]!);
  }

  function reset() {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    setOpen(false);
    setTrail([root]);
    setSubfolders(null);
    setError("");
    setDone("");
    setMoving(false);
  }

  async function moveHere() {
    if (moving || isCurrentParent || insideItself) return;
    setMoving(true);
    setError("");
    try {
      const res = await fetch(`/api/files/${selection.guid}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selection.provider,
          kind: selection.kind,
          path: selection.path,
          name: selection.name,
          moveUrl: selection.deleteUrl,
          listingUrl: selection.parentListingUrl,
          destListingUrl: here.listingUrl,
          destPath: here.materializedPath,
        }),
      });
      if (!res.ok) {
        const { message } = await readErrorResponse(res);
        setError(message || "Move failed");
        setMoving(false);
        return;
      }
      const json: { ok: boolean; result?: { message?: string } } = await res.json();
      if (!json.ok) {
        // A 200 with a failed result must never render as success.
        setError(json.result?.message || "Move failed");
        setMoving(false);
        return;
      }
      setMoving(false);
      setDone(`✓ Moved to ${here.materializedPath === "/" ? "OSF Storage" : here.materializedPath}`);
      // Refresh the tree only AFTER the confirmation has been seen: the refresh removes
      // this row from its old folder, which unmounts this control and its message.
      const dest = here.listingUrl;
      doneTimer.current = setTimeout(() => {
        reset();
        onMoved?.(selection, dest);
      }, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
      setMoving(false);
    }
  }

  const btn =
    "shrink-0 rounded border border-neutral-300 px-1.5 text-[11px] hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-neutral-700 dark:hover:bg-neutral-900";

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Move ${selection.name}`}
        title={`Move ${selection.name} to another folder (keeps the file and its history)`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
          goTo([root]);
        }}
        className={btn}
      >
        Move
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
    <span
      role="group"
      aria-label={`Choose where to move ${selection.name}`}
      className="flex w-full flex-col gap-1 rounded border border-neutral-300 p-1.5 text-[11px] dark:border-neutral-700"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-neutral-500">Move “{selection.name}” to:</span>
        {trail.map((f, i) => (
          <span key={f.listingUrl} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden>›</span>}
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => goTo(trail.slice(0, i + 1))} disabled={i === trail.length - 1}>
              {f.name}
            </button>
          </span>
        ))}
      </span>
      {loading && <span className="text-neutral-500">Loading folders…</span>}
      {subfolders && subfolders.length === 0 && <span className="text-neutral-500">No folders inside this one.</span>}
      {subfolders && subfolders.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {subfolders.map((f) => {
            const isSelf = sourcePath !== null && withSlash(f.materializedPath) === sourcePath;
            return (
              <button
                key={f.listingUrl}
                type="button"
                className={btn}
                disabled={isSelf}
                title={isSelf ? "This is the folder being moved" : `Open ${f.name}`}
                onClick={() => goTo([...trail, f])}
              >
                📁 {f.name}
              </button>
            );
          })}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => void moveHere()}
          disabled={moving || loading || isCurrentParent || insideItself}
          aria-busy={moving}
          className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          {moving ? "Moving…" : `Move here`}
        </button>
        <button type="button" className={btn} onClick={reset}>
          Cancel
        </button>
        {isCurrentParent && <span className="text-neutral-500">It is already in this folder.</span>}
        {insideItself && <span className="text-neutral-500">A folder cannot be moved inside itself.</span>}
      </span>
      {error && (
        <span role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
