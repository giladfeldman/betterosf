"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { signIn } from "next-auth/react";
import { OSF_UPLOAD_SCOPE } from "@/lib/auth/osf-provider";
import type { TreeUploadTarget } from "./UnifiedTreeNode";

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

export function UploadDialog({
  target,
  targets = [],
  onTargetChange,
  onClose,
  onComplete,
}: {
  target: TreeUploadTarget | null;
  targets?: TreeUploadTarget[];
  onTargetChange?: (target: TreeUploadTarget) => void;
  onClose: () => void;
  onComplete: (target: TreeUploadTarget) => void;
}) {
  const [status, setStatus] = useState<WriteStatus | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [folderName, setFolderName] = useState("");
  const [folderState, setFolderState] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [folderError, setFolderError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/osf/write-status")
      .then((res) => res.json())
      .then((data: WriteStatus) => {
        if (alive) setStatus(data);
      })
      .catch(() => {
        if (alive) setStatus({ signedIn: false, canWrite: false, writeScope: OSF_UPLOAD_SCOPE });
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
      const key = `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [targets]);
  const selectedTargetKey = target ? `${target.guid}|${target.provider}|${target.path}|${target.listingUrl}` : "";

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
    const form = new FormData();
    form.set("file", item.file);
    form.set("provider", target.provider);
    form.set("path", target.path);
    form.set("listingUrl", target.listingUrl);
    const res = await fetch(`/api/files/${target.guid}/upload`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Upload failed" }));
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, state: "error", error: String(body.error ?? "Upload failed") } : x));
      return;
    }
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, state: "done" } : x));
    onComplete(target);
  }

  async function uploadAll() {
    const retryable = items.filter((item) => item.state === "pending" || item.state === "error");
    for (const item of retryable) {
      await uploadOne(item);
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
      body: JSON.stringify({ provider: target.provider, path: target.path, listingUrl: target.listingUrl, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Folder creation failed" }));
      setFolderError(String(body.error ?? "Folder creation failed"));
      setFolderState("error");
      return;
    }
    setFolderName("");
    setFolderState("done");
    onComplete(target);
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
          <button type="button" onClick={onClose} className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          {targetOptions.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Upload destination</span>
              <select
                value={selectedTargetKey}
                onChange={(e) => {
                  const next = targetOptions.find((item) => `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}` === e.currentTarget.value);
                  if (next) onTargetChange?.(next);
                }}
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                {targetOptions.map((item) => {
                  const key = `${item.guid}|${item.provider}|${item.path}|${item.listingUrl}`;
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

          {status?.canWrite && target && (
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
                  {folderState === "creating" ? "Creating..." : "Create folder"}
                </button>
                {folderState === "done" && <span className="text-sm text-green-700 dark:text-green-400">Created</span>}
              </div>
              {folderError && <p className="text-sm text-red-600 dark:text-red-400">{folderError}</p>}

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
                  <ul className="max-h-60 overflow-auto text-sm">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900">
                        <span className="min-w-0 flex-1 truncate" title={item.file.name}>{item.file.name}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{formatBytes(item.file.size)}</span>
                        <span className={`shrink-0 text-xs ${item.state === "error" ? "text-red-600 dark:text-red-400" : item.state === "done" ? "text-green-700 dark:text-green-400" : "text-neutral-500"}`}>
                          {item.state === "uploading" ? "uploading..." : item.state}
                        </span>
                        {item.error && <span className="min-w-24 max-w-56 truncate text-xs text-red-600 dark:text-red-400" title={item.error}>{item.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
