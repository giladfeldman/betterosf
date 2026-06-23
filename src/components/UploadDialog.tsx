"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { signIn } from "next-auth/react";
import { OSF_UPLOAD_SCOPE } from "@/lib/auth/osf-provider";
import type { TreeUploadTarget } from "./UnifiedTreeNode";
import type { DroppedNode, FileOutcome, ConflictChoice } from "@/lib/upload/types";
import { droppedFileSize } from "@/lib/upload/types";
import { runUploadPlan, type UploadIO } from "@/lib/upload/orchestrate";
import { countDropped } from "@/lib/upload/entries";
import { uploadFileDirect, clearUploadToken } from "@/lib/upload/direct";
import { zipToDroppedNodes } from "@/lib/upload/zip";
import { appendActivity, patchActivity } from "@/lib/upload/log";
import type { FileEntry } from "@/lib/osf/files";
import { readErrorResponse, throwFromResponse } from "@/lib/http/read-error";

type WriteStatus = {
  signedIn: boolean;
  canWrite: boolean;
  needsReconnect?: boolean;
  expiresAt?: number | null;
  writeScope: string;
};

type UploadItem = {
  id: string;
  file: File;
  state: "pending" | "uploading" | "done" | "error";
  error?: string;
  errorCode?: string;
};

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function targetLabel(target: TreeUploadTarget): string {
  const title = target.nodeTitle ?? target.guid;
  const scope = target.sourceKind === "linked" ? "linked project" : target.sourceKind ?? "project";
  const folder = target.path === "/" ? "OSF Storage root" : target.path;
  return `${title} (${scope}) / ${folder}`;
}

type FlatFile = { path: string; name: string; size: number };

/** Flatten a dropped tree into the list of files it will upload (with relative paths). */
function flattenDropped(nodes: DroppedNode[], base = ""): FlatFile[] {
  const out: FlatFile[] = [];
  for (const n of nodes) {
    const p = `${base}${n.name}`;
    if (n.kind === "file") out.push({ path: p, name: n.name, size: droppedFileSize(n) });
    else out.push(...flattenDropped(n.children, `${p}/`));
  }
  return out;
}

/** Remove files whose relative path is in `skip`; report the skipped ones. Empty
 *  folders (no children at all) are kept so they're still created on OSF. */
function pruneSkipped(nodes: DroppedNode[], skip: Set<string>, base = ""): { kept: DroppedNode[]; skipped: FlatFile[] } {
  const kept: DroppedNode[] = [];
  const skipped: FlatFile[] = [];
  for (const n of nodes) {
    const p = `${base}${n.name}`;
    if (n.kind === "file") {
      if (skip.has(p)) skipped.push({ path: p, name: n.name, size: droppedFileSize(n) });
      else kept.push(n);
    } else {
      const r = pruneSkipped(n.children, skip, `${p}/`);
      skipped.push(...r.skipped);
      if (r.kept.length > 0 || n.children.length === 0) kept.push({ kind: "folder", name: n.name, children: r.kept });
    }
  }
  return { kept, skipped };
}

export function UploadDialog({
  target,
  targets = [],
  initialNodes,
  onTargetChange,
  onClose,
  onComplete,
}: {
  target: TreeUploadTarget | null;
  targets?: TreeUploadTarget[];
  /** When set, the dialog runs in drag-drop payload mode (files/folders dropped
   *  onto a tree folder) with integrity verification, instead of the manual
   *  flat-file picker. */
  initialNodes?: DroppedNode[];
  onTargetChange?: (target: TreeUploadTarget) => void;
  onClose: () => void;
  onComplete: (target: TreeUploadTarget) => void;
}) {
  const [status, setStatus] = useState<WriteStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [folderName, setFolderName] = useState("");
  const [folderState, setFolderState] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [folderError, setFolderError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // ---- Drag-drop payload mode (integrity-first upload of dropped files/folders) ----
  const [running, setRunning] = useState(false);
  const [uploadingPath, setUploadingPath] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [reconciled, setReconciled] = useState<null | { confirmed: number; skipped: number; failed: number }>(null);

  // ---- Tabs (manual picker only; drag-drop payload mode bypasses tabs) ----
  const [tab, setTab] = useState<"files" | "zip">("files");
  const [zipNodes, setZipNodes] = useState<DroppedNode[] | null>(null);
  const [zipMeta, setZipMeta] = useState<{ name: string; totalFiles: number; totalBytes: number; skipped: string[] } | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  // The confirmation/preview UI runs on whichever payload we have: a drag-drop drop
  // (initialNodes) or a ZIP the user just extracted (zipNodes).
  const payloadNodes = initialNodes ?? zipNodes;

  const droppedSummary = useMemo(() => (payloadNodes ? countDropped(payloadNodes) : null), [payloadNodes]);
  const payloadFiles = useMemo(() => (payloadNodes ? flattenDropped(payloadNodes) : []), [payloadNodes]);

  const resetRunState = useCallback(() => {
    setSkip(new Set());
    setOutcomes([]);
    setReconciled(null);
    setAcknowledged(false);
  }, []);

  async function onZipChosen(zipFile: File) {
    setZipBusy(true);
    setZipError(null);
    resetRunState();
    try {
      const { nodes, totalFiles, totalBytes, skipped } = await zipToDroppedNodes(zipFile);
      if (totalFiles === 0) {
        setZipError(skipped.length > 0 ? "That ZIP only contained system/junk files — nothing to upload." : "That ZIP is empty.");
        setZipNodes(null);
        setZipMeta(null);
        return;
      }
      setZipNodes(nodes);
      setZipMeta({ name: zipFile.name, totalFiles, totalBytes, skipped });
    } catch {
      setZipError("BetterOSF could not read that file as a ZIP archive. Make sure it's a valid .zip.");
      setZipNodes(null);
      setZipMeta(null);
    } finally {
      setZipBusy(false);
    }
  }

  function clearZip() {
    setZipNodes(null);
    setZipMeta(null);
    setZipError(null);
    resetRunState();
  }

  // Live HTTP IO over the existing folder / folder-create / upload routes.
  const makeIO = useCallback((guid: string): UploadIO => ({
    list: async (t) => {
      const res = await fetch(`/api/files/${guid}/folder?` + new URLSearchParams({ listingUrl: t.listingUrl, fresh: "1" }), { cache: "no-store" });
      if (!res.ok) await throwFromResponse(res, "Could not read folder");
      const data: { entries: FileEntry[] } = await res.json();
      return data.entries;
    },
    createFolder: async (t, name) => {
      const res = await fetch(`/api/files/${guid}/folder-create`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: t.provider, path: t.path, listingUrl: t.listingUrl, uploadUrl: t.uploadUrl, newFolderUrl: t.newFolderUrl, name }),
      });
      // 409 = the folder already exists → merge into it, not an error.
      if (!res.ok && res.status !== 409) await throwFromResponse(res, "Folder creation failed");
    },
    // File bytes go straight from the browser to OSF Waterbutler (bypassing Vercel's
    // 4.5 MB function-body limit so any size up to OSF's 5 GB/file works and never
    // silently fails). Listing + folder-create above stay on the server routes, so the
    // OSF token is only needed in the browser for this PUT. Forward opts verbatim so the
    // orchestrator's skipDuplicateCheck reaches direct.ts (halves the per-file API calls).
    uploadFile: (t, file, opts) => uploadFileDirect(t, file, opts),
  }), []);

  const execute = useCallback(async (nodesToRun: DroppedNode[], carry: FileOutcome[]) => {
    if (!target) return;
    setRunning(true);
    setReconciled(null);
    const runId = crypto.randomUUID();
    const summary = droppedSummary
      ? `${droppedSummary.files} file${droppedSummary.files === 1 ? "" : "s"}${droppedSummary.folders ? ` in ${droppedSummary.folders} folder${droppedSummary.folders === 1 ? "" : "s"}` : ""}`
      : `${nodesToRun.length} item(s)`;
    appendActivity({ id: runId, ts: Date.now(), guid: target.guid, destinationLabel: targetLabel(target), summary, status: "in_progress", confirmed: 0, skipped: 0, failed: 0, outcomes: [] });

    const live: FileOutcome[] = [...carry];
    setOutcomes([...live]);
    setUploadingPath(null);
    let result;
    try {
      result = await runUploadPlan(
        target, nodesToRun,
        { resolve: () => "new_version" as ConflictChoice },
        makeIO(target.guid),
        {
          onFileStart: (info) => setUploadingPath(info.path),
          onProgress: (o) => { live.push(o); setUploadingPath((p) => (p === o.path ? null : p)); setOutcomes([...live]); },
        }
      );
    } finally {
      setUploadingPath(null);
      // Drop the in-memory OSF token as soon as the batch ends (success or failure).
      clearUploadToken();
    }
    const all = [...carry, ...result.outcomes];
    const confirmed = all.filter((o) => o.status === "confirmed").length;
    const skippedCount = all.filter((o) => o.status === "skipped").length;
    const failed = all.filter((o) => o.status === "failed").length;
    const status = failed > 0 ? (confirmed + skippedCount > 0 ? "partial" : "failed") : "success";
    patchActivity(runId, { status, confirmed, skipped: skippedCount, failed, outcomes: all });
    setReconciled({ confirmed, skipped: skippedCount, failed });
    setRunning(false);
    onComplete(target);
  }, [target, droppedSummary, makeIO, onComplete]);

  const runDropped = useCallback(() => {
    if (!payloadNodes) return;
    const { kept, skipped } = pruneSkipped(payloadNodes, skip);
    const skippedOutcomes: FileOutcome[] = skipped.map((s) => ({ path: s.path, name: s.name, size: s.size, status: "skipped", attempts: 0 }));
    void execute(kept, skippedOutcomes);
  }, [payloadNodes, skip, execute]);

  const retryFailed = useCallback(() => {
    if (!payloadNodes) return;
    const failedPaths = new Set(outcomes.filter((o) => o.status === "failed").map((o) => o.path));
    const carry = outcomes.filter((o) => o.status !== "failed"); // keep confirmed + skipped
    const retrySkip = new Set<string>();
    for (const f of payloadFiles) if (!failedPaths.has(f.path)) retrySkip.add(f.path);
    const { kept } = pruneSkipped(payloadNodes, retrySkip);
    void execute(kept, carry);
  }, [payloadNodes, outcomes, payloadFiles, execute]);

  const selectedToUpload = payloadFiles.length - skip.size;

  useEffect(() => {
    let alive = true;
    fetch("/api/osf/write-status")
      .then((res) => res.json())
      .then((data: WriteStatus) => {
        if (alive) {
          setStatus(data);
          setStatusError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setStatus(null);
          setStatusError("Could not verify your upload session right now. You can still try signing in again.");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!target && targets.length > 0) {
      onTargetChange?.(targets[0]!);
    }
  }, [onTargetChange, target, targets]);

  const pendingCount = useMemo(() => items.filter((item) => item.state === "pending" || item.state === "error").length, [items]);
  const targetOptions = useMemo(() => {
    const seen = new Set<string>();
    return targets.filter((item) => {
      const key = `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}|${item.uploadUrl ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [targets]);
  const selectedTargetKey = target ? `${target.guid}|${target.provider}|${target.path}|${target.listingUrl}|${target.uploadUrl ?? ""}` : "";

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).map((file) => ({
      id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
      file,
      state: "pending" as const,
    }));
    setItems((prev) => [...prev, ...next]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  async function uploadOne(item: UploadItem) {
    if (!target) return;
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, state: "uploading", error: undefined } : x));
    try {
      // Direct browser → OSF upload (bypasses Vercel's 4.5 MB limit so large files work).
      await uploadFileDirect(target, item.file, {});
    } catch (e) {
      const err = e as { message?: string; code?: string };
      setItems((prev) => prev.map((x) => x.id === item.id ? {
        ...x,
        state: "error",
        error: String(err.message ?? "Upload failed"),
        errorCode: typeof err.code === "string" ? err.code : undefined,
      } : x));
      return;
    }
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, state: "done" } : x));
    onComplete(target);
  }

  async function uploadAll() {
    const retryable = items.filter((item) => item.state === "pending" || item.state === "error");
    try {
      for (const item of retryable) {
        await uploadOne(item);
      }
    } finally {
      clearUploadToken();
    }
  }

  async function createFolder() {
    if (!target) return;
    const name = folderName.trim();
    if (!name) return;
    setFolderState("creating");
    setFolderError("");
    const res = await fetch(`/api/files/${target.guid}/folder-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: target.provider,
        path: target.path,
        listingUrl: target.listingUrl,
        uploadUrl: target.uploadUrl,
        newFolderUrl: target.newFolderUrl,
        name,
      }),
    });
    if (!res.ok) {
      // Surface the REAL message (incl. non-JSON 429 text); keep the name for one-click retry.
      const { message } = await readErrorResponse(res);
      setFolderError(message || "Folder creation failed");
      setFolderState("error");
      return;
    }
    setFolderName("");
    setFolderState("done");
    onComplete(target); // forced tree refresh → the new folder appears immediately
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title">
      <div className="w-full max-w-2xl rounded border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
          <div>
            <h2 id="upload-dialog-title" className="text-lg font-semibold">Upload to OSF Storage</h2>
            <p className="mt-1 break-all text-sm text-neutral-600 dark:text-neutral-400">
              {target ? targetLabel(target) : "Choose a writable OSF Storage folder."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running || (!!reconciled && reconciled.failed > 0 && !acknowledged)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          {statusError && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {statusError}
            </div>
          )}

          {targetOptions.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Upload destination</span>
              <select
                value={selectedTargetKey}
                onChange={(e) => {
                  const next = targetOptions.find((item) => `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}|${item.uploadUrl ?? ""}` === e.currentTarget.value);
                  if (next) onTargetChange?.(next);
                }}
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                {targetOptions.map((item) => {
                  const key = `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}|${item.uploadUrl ?? ""}`;
                  return (
                    <option key={key} value={key}>
                      {targetLabel(item)}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {!target && targetOptions.length === 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              BetterOSF has not found an uploadable OSF Storage folder yet. Wait for the folder index to finish, expand OSF Storage in the tree, or open a specific folder and choose Upload here.
            </div>
          )}

          {status && !status.signedIn && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
              <p className="mb-2">Sign in with OSF to upload files.</p>
              <button type="button" onClick={() => signIn("osf")} className="rounded border border-blue-300 bg-white px-3 py-1 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Sign in with OSF
              </button>
            </div>
          )}

          {status?.needsReconnect && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              <p className="mb-2">Your OSF connection needs to be refreshed before uploading.</p>
              <button
                type="button"
                onClick={() => signIn("osf", undefined, { scope: status.writeScope || OSF_UPLOAD_SCOPE })}
                className="rounded border border-amber-300 bg-white px-3 py-1 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                Reconnect OSF
              </button>
            </div>
          )}

          {status?.signedIn && !status.canWrite && !status.needsReconnect && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
              <p className="mb-2">Enable uploads to grant BetterOSF OSF write access for this session.</p>
              <button
                type="button"
                onClick={() => signIn("osf", undefined, { scope: status.writeScope || OSF_UPLOAD_SCOPE })}
                className="rounded border border-blue-300 bg-white px-3 py-1 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
              >
                Enable uploads
              </button>
            </div>
          )}

          {status?.canWrite && target && payloadNodes && (
            <div className="space-y-3">
              {zipMeta && !running && !reconciled && (
                <div className="flex items-start justify-between gap-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
                  <div>
                    <p className="font-medium">Extracted <span className="break-all">{zipMeta.name}</span></p>
                    <p className="mt-0.5 text-neutral-600 dark:text-neutral-300">
                      {zipMeta.totalFiles} file{zipMeta.totalFiles === 1 ? "" : "s"} · {formatBytes(zipMeta.totalBytes)}
                      {zipMeta.skipped.length > 0 ? ` · ${zipMeta.skipped.length} system file${zipMeta.skipped.length === 1 ? "" : "s"} skipped` : ""}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">Confirm the folder tree below, then upload — the hierarchy is recreated on OSF exactly as in the ZIP.</p>
                  </div>
                  <button type="button" onClick={clearZip} className="shrink-0 rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                    Choose a different ZIP
                  </button>
                </div>
              )}
              <div className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <p className="font-medium">
                  Ready to upload {droppedSummary?.files} file{droppedSummary?.files === 1 ? "" : "s"}
                  {droppedSummary && droppedSummary.folders > 0 ? ` across ${droppedSummary.folders} folder${droppedSummary.folders === 1 ? "" : "s"}` : ""}.
                </p>
                <p className="mt-1 text-neutral-600 dark:text-neutral-400">Destination: {targetLabel(target)}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Files that already exist will be uploaded as a <strong>new version</strong> — OSF keeps the previous version in its revision history. Untick any file below to skip it instead.
                </p>
              </div>

              {!reconciled && !running && payloadFiles.length > 0 && (
                <div className="rounded border border-neutral-200 dark:border-neutral-800">
                  <ul className="max-h-56 overflow-auto text-sm">
                    {payloadFiles.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 last:border-b-0 dark:border-neutral-900">
                        <input
                          type="checkbox"
                          aria-label={`Upload ${f.path}`}
                          checked={!skip.has(f.path)}
                          onChange={(e) => setSkip((prev) => {
                            const next = new Set(prev);
                            if (e.currentTarget.checked) next.delete(f.path); else next.add(f.path);
                            return next;
                          })}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate" title={f.path}>{f.path}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{formatBytes(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!running && !reconciled && (
                <button
                  type="button"
                  onClick={runDropped}
                  disabled={selectedToUpload === 0}
                  className="rounded border border-blue-300 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
                >
                  Upload {selectedToUpload} file{selectedToUpload === 1 ? "" : "s"}
                </button>
              )}

              {(running || outcomes.length > 0) && (
                <ul className="max-h-72 overflow-auto rounded border border-neutral-200 text-sm dark:border-neutral-800">
                  {outcomes.map((o) => (
                    <li key={o.path} className="border-b border-neutral-100 px-3 py-1.5 last:border-b-0 dark:border-neutral-900">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate" title={o.detail ? `${o.path} — ${o.detail}` : o.path}>{o.path}</span>
                        <span className={`shrink-0 text-xs ${o.status === "failed" ? "text-red-600 dark:text-red-400" : o.status === "confirmed" ? "text-green-700 dark:text-green-400" : "text-neutral-500"}`}>
                          {o.status === "confirmed" ? "✓ on OSF" : o.status === "skipped" ? "skipped" : `✗ ${o.cause}`}
                        </span>
                      </div>
                      {o.status === "failed" && o.detail && (
                        <div className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{o.detail}</div>
                      )}
                    </li>
                  ))}
                  {running && uploadingPath && !outcomes.some((o) => o.path === uploadingPath) && (
                    <li className="flex items-center gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300" title={uploadingPath}>{uploadingPath}</span>
                      <span className="shrink-0 text-xs text-blue-600 dark:text-blue-400">⤴ uploading…</span>
                    </li>
                  )}
                </ul>
              )}

              {running && (
                <p className="text-xs text-neutral-500">
                  {uploadingPath ? `Uploading ${uploadingPath}…` : "Uploading and verifying each file on OSF…"}
                </p>
              )}

              {reconciled && reconciled.failed === 0 && (
                <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
                  All {reconciled.confirmed} file{reconciled.confirmed === 1 ? "" : "s"} confirmed on OSF{reconciled.skipped ? ` (${reconciled.skipped} skipped)` : ""}. Safe to close.
                </div>
              )}

              {reconciled && reconciled.failed > 0 && (
                <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
                  <p className="font-semibold">{reconciled.failed} file{reconciled.failed === 1 ? "" : "s"} did NOT upload to OSF.</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {outcomes.filter((o) => o.status === "failed").map((o) => (
                      <li key={o.path}><span className="font-medium break-all">{o.path}</span> — {o.detail}</li>
                    ))}
                  </ul>
                  <button type="button" onClick={retryFailed} className="rounded border border-red-400 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-50 dark:bg-red-950 dark:text-red-200">
                    Retry failed
                  </button>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.currentTarget.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>I understand these {reconciled.failed} file{reconciled.failed === 1 ? "" : "s"} did not upload to OSF.</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {status?.canWrite && target && !payloadNodes && (
            <>
              <div role="tablist" aria-label="Upload method" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
                {(["files", "zip"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-blue-500 text-blue-700 dark:text-blue-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
                  >
                    {t === "files" ? "Files & folders" : "Upload a ZIP"}
                  </button>
                ))}
              </div>

              {tab === "files" && (
              <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={`flex min-h-36 flex-col items-center justify-center rounded border border-dashed p-5 text-center ${isDragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}
              >
                <p className="text-sm font-medium">Drop files here</p>
                <label className="mt-3 cursor-pointer rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                  Choose files
                  <input type="file" multiple className="sr-only" onChange={(e) => e.currentTarget.files && addFiles(e.currentTarget.files)} />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.currentTarget.value)}
                  placeholder="New folder name"
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
                <button
                  type="button"
                  onClick={createFolder}
                  disabled={!folderName.trim() || folderState === "creating"}
                  className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:text-neutral-500 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  {folderState === "creating" ? "Creating…" : folderState === "error" ? "Retry" : "Create folder"}
                </button>
                {folderState === "done" && <span className="text-sm font-medium text-green-700 dark:text-green-400">✓ Created</span>}
              </div>
              {folderError && <p className="break-words text-sm text-red-600 dark:text-red-400">{folderError}</p>}

              {items.length > 0 && (
                <div className="rounded border border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                    <span>{items.length} file{items.length === 1 ? "" : "s"} selected</span>
                    <button
                      type="button"
                      onClick={uploadAll}
                      disabled={pendingCount === 0}
                      className="rounded border border-blue-300 px-3 py-1 text-blue-700 hover:bg-blue-50 disabled:border-neutral-300 disabled:text-neutral-500 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
                    >
                      Upload pending
                    </button>
                  </div>
                  {items.some((item) => item.state === "error") && (
                    <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                      Upload failed. Read the message below, then retry after fixing the issue. If the message says your session expired or uploads are not enabled, reconnect OSF and try again.
                    </div>
                  )}
                  <ul className="max-h-72 overflow-auto text-sm">
                    {items.map((item) => (
                      <li key={item.id} className="border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900">
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate font-medium" title={item.file.name}>{item.file.name}</span>
                          <span className="shrink-0 text-xs text-neutral-500">{formatBytes(item.file.size)}</span>
                          <span className={`shrink-0 text-xs ${item.state === "error" ? "text-red-600 dark:text-red-400" : item.state === "done" ? "text-green-700 dark:text-green-400" : "text-neutral-500"}`}>
                            {item.state === "uploading" ? "uploading..." : item.state}
                          </span>
                        </div>
                        {item.error && (
                          <div className="mt-2 whitespace-pre-wrap break-words rounded border border-red-200 bg-red-50 p-2 text-xs leading-relaxed text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                            {item.errorCode && <span className="font-semibold uppercase">{item.errorCode}: </span>}
                            {item.error}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </>
              )}

              {tab === "zip" && (
                <div className="space-y-3">
                  <div className="rounded border border-dashed border-neutral-300 p-5 text-center dark:border-neutral-700">
                    <p className="text-sm font-medium">Upload a ZIP archive</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      BetterOSF reads the folder structure inside the ZIP and recreates it on OSF — exactly like pushing a directory. You confirm the tree before anything uploads.
                    </p>
                    <label className="mt-3 inline-block cursor-pointer rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                      {zipBusy ? "Reading ZIP…" : "Choose a .zip file"}
                      <input
                        type="file"
                        aria-label="Choose a ZIP file"
                        accept=".zip,application/zip,application/x-zip-compressed"
                        className="sr-only"
                        disabled={zipBusy}
                        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void onZipChosen(f); e.currentTarget.value = ""; }}
                      />
                    </label>
                  </div>
                  {zipError && <p className="text-sm text-red-600 dark:text-red-400">{zipError}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
