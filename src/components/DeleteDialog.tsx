"use client";

// Delete confirmation dialog.
//
// Bespoke rather than a generic <ConfirmDialog>: this owns backup capture, quota
// escalation, threshold logic, per-item results, and the restore hand-off. A confirm
// primitive would have exactly one caller and would immediately grow all of those props.
//
// The flow is deliberately slow. OSF cannot restore what this deletes, so every stage
// exists to make an accidental deletion structurally difficult:
//   1. inventory  — you cannot consent to an unknown quantity
//   2. backup     — an incomplete backup HARD-BLOCKS the delete
//   3. confirm    — typed phrase (+ checkbox for folder/bulk) = signature
//   4. result     — per-item outcomes, never one opaque "done"

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFocusTrap } from "./useFocusTrap";
import type { TreeSelectionPayload, TreeUploadTarget } from "./tree-types";
import { OSF_UPLOAD_SCOPE } from "@/lib/auth/osf-provider";
import { signIn } from "next-auth/react";
import {
  TERMS_CLAUSES,
  TERMS_VERSION,
  DIALOG_CLAUSE_HEADINGS,
  confirmationPhrase,
  confirmationMatches,
  requiresAcknowledgement,
  type ConfirmationSubject,
} from "@/lib/terms";
import { planCapture, captureBackup, makeBackupRecord, backupFilename, type CapturePlan } from "@/lib/backup/capture";
import { saveBackup, likelyFits, idbAvailable, attachDeleteSummary, type BackupRecord } from "@/lib/backup/idb";
import { downloadRequirement } from "@/lib/backup/thresholds";
import { downloadBlob } from "@/lib/backup/download";
import { readErrorResponse } from "@/lib/http/read-error";

export type DeleteDialogProps = {
  guid: string;
  projectTitle: string;
  items: TreeSelectionPayload[];
  /** Where a restore would put files back. Absent = restore offered from the drawer only. */
  restoreTarget?: TreeUploadTarget;
  onClose: () => void;
  onDeleted: (items: TreeSelectionPayload[]) => void;
};

type Stage = "inventory" | "backup" | "confirm" | "running" | "done";

type WriteStatus = {
  signedIn: boolean;
  canWrite: boolean;
  needsReconnect: boolean;
  writeScope?: string;
};

type DeleteResult = {
  path: string;
  name: string;
  status: "deleted" | "already_gone" | "failed";
  message?: string;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function DeleteDialog({ guid, projectTitle, items, restoreTarget, onClose, onDeleted }: DeleteDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("inventory");
  const [status, setStatus] = useState<WriteStatus | null>(null);

  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [foundCount, setFoundCount] = useState(0);

  const [backup, setBackup] = useState<BackupRecord | null>(null);
  const [backupProgress, setBackupProgress] = useState<{ done: number; total: number } | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [storageFits, setStorageFits] = useState(true);

  const [typed, setTyped] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [results, setResults] = useState<DeleteResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const containsFolder = items.some((i) => i.kind === "folder");
  const singleFile = items.length === 1 && items[0]!.kind === "file";

  const subject: ConfirmationSubject = useMemo(() => {
    if (singleFile) return { mode: "file", name: items[0]!.name };
    if (items.length === 1 && items[0]!.kind === "folder") {
      return { mode: "folder", name: items[0]!.name, itemCount: plan?.files.length ?? 0 };
    }
    return { mode: "bulk", itemCount: plan?.files.length ?? items.length };
  }, [singleFile, items, plan]);

  const expectedPhrase = confirmationPhrase(subject);
  const needsAck = requiresAcknowledgement(subject);

  const requirement = useMemo(
    () =>
      downloadRequirement(
        { totalBytes: plan?.totalBytes ?? 0, fileCount: plan?.files.length ?? 0, containsFolder },
        { idbAvailable: idbAvailable(), likelyFits: storageFits }
      ),
    [plan, containsFolder, storageFits]
  );

  // Escape/backdrop are blocked while deletes are in flight — closing mid-run would hide
  // the only record of what was destroyed.
  const attemptClose = useCallback(() => {
    if (stage === "running") return;
    onClose();
  }, [stage, onClose]);

  useFocusTrap(dialogRef, true, attemptClose);

  useEffect(() => {
    fetch("/api/osf/write-status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Stage 1: expand folders so the user sees a real count before consenting.
  useEffect(() => {
    let cancelled = false;
    setExpanding(true);
    planCapture(items, guid, (n) => {
      if (!cancelled) setFoundCount(n);
    })
      .then(async (p) => {
        if (cancelled) return;
        setPlan(p);
        setStorageFits(await likelyFits(p.totalBytes));
      })
      .catch((e: unknown) => {
        if (!cancelled) setPlanError(e instanceof Error ? e.message : "Could not inspect what you selected.");
      })
      .finally(() => {
        if (!cancelled) setExpanding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [items, guid]);

  const startBackup = useCallback(async () => {
    if (!plan) return;
    setStage("backup");
    setBackupError(null);
    try {
      const capture = await captureBackup(plan, guid, (p) => setBackupProgress({ done: p.done, total: p.total }));
      const record = makeBackupRecord({ guid, projectTitle, capture });
      setBackup(record);

      if (capture.status === "complete") {
        const saved = await saveBackup(record);
        setSavedLocally(saved.ok);
        if (!saved.ok) {
          setSaveMessage(saved.message);
          setStorageFits(false); // escalate the ZIP to mandatory
        }
      }
    } catch (e: unknown) {
      setBackupError(e instanceof Error ? e.message : "The backup failed.");
    }
  }, [plan, guid, projectTitle]);

  function doDownload() {
    if (!backup) return;
    downloadBlob(backup.blob, backupFilename(guid, projectTitle));
    setDownloaded(true);
  }

  // An empty selection (e.g. deleting an empty folder) has nothing to back up. There is
  // no data at risk, so the backup stage is skipped rather than producing an empty
  // archive and asking the user to keep it.
  const nothingToBackUp = Boolean(plan) && plan!.files.length === 0;
  const backupComplete = backup?.status === "complete" || nothingToBackUp;
  const downloadSatisfied = !requirement.mandatory || downloaded;
  const canConfirm =
    backupComplete &&
    downloadSatisfied &&
    confirmationMatches(typed, subject) &&
    (!needsAck || acknowledged) &&
    Boolean(status?.canWrite);

  async function runDelete() {
    if (!canConfirm || !plan) return;
    setStage("running");
    setRunError(null);
    try {
      const res = await fetch(`/api/files/${guid}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "osfstorage",
          items: items.map((i) => ({
            kind: i.kind,
            path: i.path,
            name: i.name,
            deleteUrl: i.deleteUrl,
            listingUrl: i.parentListingUrl,
          })),
          confirmationPhrase: typed.trim(),
          acknowledged,
          subject,
          termsVersion: TERMS_VERSION,
          backupStatus: backup?.status ?? "failed",
          backupDownloaded: downloaded,
        }),
      });
      if (!res.ok) {
        // Never assume an error Response is JSON — a 429 is text/plain and a crashed
        // function is an HTML page. readErrorResponse handles all three.
        const err = await readErrorResponse(res);
        setRunError(err.message);
        setStage("confirm");
        return;
      }
      const json: { results: DeleteResult[]; deleted: number; alreadyGone: number; failed: number } = await res.json();
      setResults(json.results);
      setStage("done");
      if (backup) {
        void attachDeleteSummary(backup.id, {
          deleted: json.deleted,
          alreadyGone: json.alreadyGone,
          failed: json.failed,
        });
      }
      const removed = items.filter((_, idx) => json.results[idx]?.status !== "failed");
      if (removed.length > 0) onDeleted(removed);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "The deletion failed.");
      setStage("confirm");
    }
  }

  const dialogClauses = TERMS_CLAUSES.filter((c) => DIALOG_CLAUSE_HEADINGS.includes(c.heading));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) attemptClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete from OSF"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">Delete from OSF</h2>

        <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
          <p className="font-semibold text-red-800 dark:text-red-200">
            OSF has no trash. Deleted files cannot be recovered from OSF.
          </p>
        </div>

        {status && !status.canWrite && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
            {status.signedIn ? (
              <>
                <p>BetterOSF needs write access to delete files.</p>
                <button
                  type="button"
                  className="mt-2 rounded bg-amber-600 px-3 py-1 text-white"
                  onClick={() => void signIn("osf", undefined, { scope: status.writeScope || OSF_UPLOAD_SCOPE })}
                >
                  Reconnect OSF
                </button>
              </>
            ) : (
              <>
                <p>Sign in with OSF to delete files.</p>
                <button type="button" className="mt-2 rounded bg-amber-600 px-3 py-1 text-white" onClick={() => void signIn("osf")}>
                  Sign in
                </button>
              </>
            )}
          </div>
        )}

        {/* Stage 1 — inventory */}
        <section className="mt-4">
          <h3 className="text-sm font-semibold">What will be deleted</h3>
          {expanding && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Checking what this includes… found {foundCount} file(s) so far.</p>}
          {planError && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{planError}</p>}
          {plan?.tooLarge && (
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              This selection is too large for BetterOSF to back up safely, so it will not delete it. Delete smaller
              parts of it instead.
            </p>
          )}
          {plan && !plan.tooLarge && (
            <ul className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              <li>
                {items.length} selected item(s) — <strong>{plan.files.length} file(s)</strong>, {formatBytes(plan.totalBytes)} in total.
              </li>
              {nothingToBackUp && (
                <li className="text-neutral-600 dark:text-neutral-400">
                  {containsFolder
                    ? "This folder is empty, so there is nothing to back up."
                    : "There is nothing to back up."}
                </li>
              )}
              {/* Only warn about hidden contents when there ARE hidden contents. */}
              {containsFolder && !nothingToBackUp && (
                <li className="text-amber-700 dark:text-amber-300">Includes a folder, so this may cover more than you can see in the tree.</li>
              )}
            </ul>
          )}
        </section>

        {/* Stage 2 — backup */}
        {plan && !plan.tooLarge && stage === "inventory" && (
          <button
            type="button"
            className="mt-4 rounded bg-neutral-800 px-3 py-1.5 text-sm text-white dark:bg-neutral-200 dark:text-neutral-900"
            onClick={() => (nothingToBackUp ? setStage("confirm") : void startBackup())}
          >
            {nothingToBackUp ? "Continue" : "Back up these files first"}
          </button>
        )}

        {/* No backup section at all when there was nothing to copy. */}
        {stage !== "inventory" && !nothingToBackUp && (
          <section className="mt-4">
            <h3 className="text-sm font-semibold">Backup</h3>
            {backupProgress && !backup && (
              <p className="mt-1 text-sm">Copying {backupProgress.done} of {backupProgress.total}…</p>
            )}
            {backupError && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{backupError}</p>}

            {backup?.status === "incomplete" && (
              <div className="mt-1 rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
                <p className="font-semibold text-red-800 dark:text-red-200">
                  The backup is incomplete — {backup.missing.length} file(s) could not be copied.
                </p>
                <p className="mt-1 text-red-800 dark:text-red-200">
                  Deletion is blocked. Close this dialog and try again, or delete a smaller selection.
                </p>
                <ul className="mt-2 list-disc pl-5 text-red-800 dark:text-red-200">
                  {backup.missing.slice(0, 5).map((m) => (
                    <li key={m.path}>
                      {m.path} — {m.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {backup?.status === "complete" && (
              <div className="mt-1 text-sm">
                <p>
                  {backup.items.length} file(s) copied, {formatBytes(backup.totalBytes)}.{" "}
                  {savedLocally ? (
                    <span className="text-green-700 dark:text-green-300">Kept in this browser.</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">{saveMessage ?? "Not kept in this browser."}</span>
                  )}
                </p>
                {requirement.mandatory && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950">
                    <p className="font-medium text-amber-900 dark:text-amber-200">You must download this backup before deleting:</p>
                    <ul className="mt-1 list-disc pl-5 text-amber-900 dark:text-amber-200">
                      {requirement.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-2 rounded border border-neutral-400 px-3 py-1.5 text-sm dark:border-neutral-600"
                  onClick={doDownload}
                >
                  {requirement.mandatory ? "Download backup ZIP (required)" : "Download backup ZIP (recommended)"}
                </button>
                {downloaded && (
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    Download started. BetterOSF cannot confirm it finished — please check your downloads folder.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Stage 3 — typed confirmation = signature */}
        {backupComplete && stage !== "running" && stage !== "done" && (
          <section className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <h3 className="text-sm font-semibold">Confirm</h3>

            <details className="mt-2 rounded border border-neutral-300 p-2 text-xs dark:border-neutral-700">
              <summary className="cursor-pointer font-medium">Terms that apply to this deletion (version {TERMS_VERSION})</summary>
              <ul className="mt-2 space-y-2">
                {dialogClauses.map((c) => (
                  <li key={c.heading}>
                    <strong>{c.heading}.</strong> {c.body}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                <Link href="/terms" className="underline" target="_blank">
                  Read the full deletion terms
                </Link>
              </p>
            </details>

            <p className="mt-3 text-sm">
              By typing the confirmation below, you acknowledge that you have read and agree to the{" "}
              <Link href="/terms" className="underline" target="_blank">
                deletion terms
              </Link>
              , that this deletion is permanent and cannot be undone by BetterOSF or by OSF, that you are solely
              responsible for it, and that you accept all risk of data loss.{" "}
              <strong>Your typed confirmation is your electronic signature to these terms.</strong>
            </p>

            <label className="mt-3 block text-sm">
              Type <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{expectedPhrase}</code> to confirm:
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Confirmation phrase"
                autoComplete="off"
                className="mt-1 w-full rounded border border-neutral-400 px-2 py-1 dark:border-neutral-600 dark:bg-neutral-800"
              />
            </label>

            {needsAck && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1" />
                <span>I have a backup and I understand OSF cannot restore these files.</span>
              </label>
            )}

            {runError && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{runError}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!canConfirm}
                onClick={() => void runDelete()}
                className="rounded bg-red-700 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete permanently
              </button>
              <button type="button" onClick={attemptClose} className="rounded border border-neutral-400 px-4 py-1.5 text-sm dark:border-neutral-600">
                Cancel
              </button>
            </div>
          </section>
        )}

        {stage === "running" && <p className="mt-4 text-sm">Deleting… please do not close this window.</p>}

        {/* Stage 4 — per-item outcomes */}
        {stage === "done" && results && (
          <section className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <h3 className="text-sm font-semibold">Result</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {results.map((r) => (
                <li key={r.path}>
                  <span
                    className={
                      r.status === "deleted"
                        ? "text-green-700 dark:text-green-300"
                        : r.status === "already_gone"
                          ? "text-neutral-600 dark:text-neutral-400"
                          : "text-red-700 dark:text-red-300"
                    }
                  >
                    {r.status === "deleted" ? "Deleted" : r.status === "already_gone" ? "Already gone" : "Failed"}
                  </span>{" "}
                  — {r.name}
                  {r.message ? ` (${r.message})` : ""}
                </li>
              ))}
            </ul>
            {backup && restoreTarget && (
              <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
                A backup is kept in this browser. You can restore a copy from the Backups panel. Restoring uploads new
                files — it does not undo the deletion or bring back the original file history.
              </p>
            )}
            <button type="button" onClick={onClose} className="mt-4 rounded border border-neutral-400 px-4 py-1.5 text-sm dark:border-neutral-600">
              Close
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
