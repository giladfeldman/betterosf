"use client";

import { useRef, useState } from "react";
import { downloadZip } from "client-zip";
import {
  archiveName,
  buildTree,
  fetchRecord,
  parseRecordRef,
  zipEntryPath,
  type TreeFolder,
  type ZenodoRecordSummary,
} from "@/lib/zenodo-download/record";
import { hashBytes } from "@/lib/transition/hash";
import { saveArchive, canChooseSaveLocation, type SaveOutcome } from "@/lib/transition/save-archive";
import { formatBytes } from "@/lib/transition/format";
import { Spinner, Working } from "@/components/Progress";

type State =
  | { phase: "idle" }
  | { phase: "looking" }
  | { phase: "found"; record: ZenodoRecordSummary }
  | { phase: "downloading"; record: ZenodoRecordSummary; done: number; total: number; current: string }
  | {
      phase: "finished";
      record: ZenodoRecordSummary;
      outcome: SaveOutcome;
      verified: number;
      unverified: number;
      failed: { key: string; reason: string }[];
      rewritten: { key: string; storedAs: string }[];
    }
  | { phase: "error"; message: string };

/**
 * Rebuild a Zenodo deposit's folder structure and download it as one ZIP.
 *
 * The structure is already in the deposit — Zenodo stores a file key verbatim, slashes and
 * all, and only its UI flattens them into long filenames. Splitting the key on `/` restores
 * exactly what was uploaded.
 *
 * Every byte goes zenodo.org → this tab → your disk. Nothing is sent to BetterOSF, and no
 * account is needed at either end.
 *
 * **Each file is checked against the md5 Zenodo publishes for it.** A downloader that
 * silently handed back the wrong bytes would be worse than none, and a record whose entries
 * carry no checksum is reported as unverified rather than counted as fine.
 */
export function ZenodoFolderDownloader() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const abort = useRef<AbortController | null>(null);

  async function look() {
    const ref = parseRecordRef(input);
    if (!ref) {
      setState({
        phase: "error",
        message:
          "That is not a Zenodo record. Paste a record URL (https://zenodo.org/records/10001), a DOI (10.5281/zenodo.10001), or just the record number.",
      });
      return;
    }
    setState({ phase: "looking" });
    abort.current = new AbortController();
    try {
      const record = await fetchRecord(ref, abort.current.signal);
      setState({ phase: "found", record });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function download(record: ZenodoRecordSummary) {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const entries: { name: string; input: Blob }[] = [];
    const failed: { key: string; reason: string }[] = [];
    /** Keys the traversal defence had to change, so no file is silently renamed. */
    const rewritten: { key: string; storedAs: string }[] = [];
    let verified = 0;
    let unverified = 0;

    try {
      for (const [i, file] of record.files.entries()) {
        signal.throwIfAborted();
        setState({
          phase: "downloading",
          record,
          done: i,
          total: record.files.length,
          current: file.key,
        });
        try {
          const res = await fetch(file.contentUrl, { signal });
          if (!res.ok) throw new Error(`Zenodo answered ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());

          if (file.md5) {
            const digest = await hashBytes(bytes);
            if (digest.md5 !== file.md5) {
              // Refused rather than included. A file that does not match the checksum
              // Zenodo publishes for it is the one thing this tool must never hand back
              // quietly inside an otherwise ordinary-looking archive.
              failed.push({
                key: file.key,
                reason: `the bytes do not match Zenodo's published md5 (${file.md5})`,
              });
              continue;
            }
            verified += 1;
          } else {
            // Included, and counted separately: no checksum means no way to tell.
            unverified += 1;
          }
          // NEVER the raw key. Zenodo stores traversal-shaped keys verbatim (measured), so
          // the key is untrusted input on its way to becoming a filesystem path.
          const storedAs = zipEntryPath(file.key);
          if (storedAs !== file.key) rewritten.push({ key: file.key, storedAs });
          entries.push({ name: storedAs, input: new Blob([bytes as BlobPart]) });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          failed.push({ key: file.key, reason: e instanceof Error ? e.message : String(e) });
        }
      }

      signal.throwIfAborted();
      const manifest = renderManifest(record, { verified, unverified, failed, rewritten });
      const blob = await downloadZip([
        ...entries,
        { name: "ZENODO-MANIFEST.txt", input: manifest },
      ]).blob();
      const outcome = await saveArchive(blob, archiveName(record));
      setState({ phase: "finished", record, outcome, verified, unverified, failed, rewritten });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setState({ phase: "found", record });
        return;
      }
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void look();
            }
          }}
          placeholder="https://zenodo.org/records/10001, 10.5281/zenodo.10001, or 10001"
          className="flex-1 rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => void look()}
          disabled={!input.trim() || state.phase === "looking" || state.phase === "downloading"}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          Look it up
        </button>
      </div>

      {state.phase === "looking" ? (
        <div className="mt-4">
          <Working>Reading the record from Zenodo…</Working>
        </div>
      ) : null}

      {state.phase === "error" ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {state.message}
        </p>
      ) : null}

      {state.phase === "downloading" ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <Spinner />
            <span>
              File {state.done + 1} of {state.total} — {state.current}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-neutral-900 dark:bg-white"
              style={{ width: `${Math.round((state.done / Math.max(1, state.total)) * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="mt-3 rounded border border-neutral-400 px-3 py-1 text-sm dark:border-neutral-600"
          >
            Stop
          </button>
        </div>
      ) : null}

      {state.phase === "finished" ? (
        <div className="mt-4">
          <p
            className={`rounded border p-3 text-sm ${
              state.failed.length === 0
                ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
                : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
            }`}
          >
            {state.outcome.saved
              ? `Saved as ${state.outcome.name}. `
              : state.outcome.cancelled
                ? "Save cancelled — nothing was written. "
                : `The archive was built but could not be saved: ${state.outcome.error}. `}
            {state.verified} file(s) matched Zenodo&apos;s published checksum
            {state.unverified > 0
              ? `, ${state.unverified} had no checksum to check against and are included anyway`
              : ""}
            {state.failed.length > 0 ? `, and ${state.failed.length} are NOT in the archive` : ""}.
          </p>
          {state.failed.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-red-800 dark:text-red-300">
              {state.failed.map((f) => (
                <li key={f.key}>
                  <code>{f.key}</code> — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {state.rewritten.length > 0 ? (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p>
                {state.rewritten.length} file name(s) had to be changed to keep them inside the
                archive. Zenodo stores a name exactly as its depositor typed it, and these pointed
                outside a folder or used characters a filesystem will not accept. Nothing was
                dropped — the full mapping is in <code>ZENODO-MANIFEST.txt</code>.
              </p>
              <ul className="mt-1 list-disc pl-5">
                {state.rewritten.slice(0, 5).map((r) => (
                  <li key={r.key}>
                    <code>{r.key}</code> → <code>{r.storedAs}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setState({ phase: "found", record: state.record })}
            className="mt-3 text-sm underline"
          >
            Back to the record
          </button>
        </div>
      ) : null}

      {state.phase === "found" ? (
        <RecordView record={state.record} onDownload={() => void download(state.record)} />
      ) : null}
    </div>
  );
}

function RecordView({
  record,
  onDownload,
}: {
  record: ZenodoRecordSummary;
  onDownload: () => void;
}) {
  const totalBytes = record.files.reduce((n, f) => n + (f.size ?? 0), 0);
  const unsized = record.files.filter((f) => f.size === null).length;
  const withoutChecksum = record.files.filter((f) => !f.md5).length;
  const tree = buildTree(record.files);
  const nested = record.files.some((f) => f.key.includes("/"));

  return (
    <div className="mt-6">
      <h2 className="text-base font-semibold">{record.title}</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {record.creators.slice(0, 4).join("; ")}
        {record.creators.length > 4 ? " et al." : ""}
        {record.publicationDate ? ` · ${record.publicationDate}` : ""}
        {record.doi ? ` · ${record.doi}` : ""} ·{" "}
        <a href={record.htmlUrl} className="underline" target="_blank" rel="noopener noreferrer">
          open on Zenodo
        </a>
      </p>

      {record.files.length === 0 ? (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {record.filesRestricted
            ? "This record's files are restricted, so Zenodo will not list them without permission from the depositor. This tool only reads public records."
            : "Zenodo lists no files on this record."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            {record.files.length} file(s), {formatBytes(totalBytes)}
            {unsized > 0 ? ` (${unsized} of them with no size reported, so that total is a lower bound)` : ""}.
          </p>
          {!nested ? (
            <p className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              None of this record&apos;s file names contain a path, so there is no folder structure to
              rebuild — the ZIP will simply hold the files as they are listed.
            </p>
          ) : null}
          {withoutChecksum > 0 ? (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {withoutChecksum} file(s) have no checksum published, so BetterOSF cannot confirm those
              arrived intact. They are included and named in the manifest.
            </p>
          ) : null}

          <div className="mt-4 max-h-80 overflow-auto rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <FolderView folder={tree} depth={0} />
          </div>

          <button
            type="button"
            onClick={onDownload}
            className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Download as a folder tree (ZIP)
          </button>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Files come straight from Zenodo to this tab and are checked against the checksums Zenodo
            publishes.{" "}
            {canChooseSaveLocation() ? "You choose where to save it." : "It lands in your Downloads folder."}
          </p>
        </>
      )}
    </div>
  );
}

function FolderView({ folder, depth }: { folder: TreeFolder; depth: number }) {
  return (
    <ul className={depth === 0 ? "" : "ml-4 border-l border-neutral-200 pl-3 dark:border-neutral-800"}>
      {[...folder.folders.values()].map((child) => (
        <li key={child.name}>
          <span className="font-medium">📁 {child.name}</span>
          <FolderView folder={child} depth={depth + 1} />
        </li>
      ))}
      {folder.files.map((file) => (
        <li key={file.key} className="text-neutral-700 dark:text-neutral-300">
          📄 {file.key.split("/").pop()}{" "}
          <span className="text-xs text-neutral-500">
            {file.size === null ? "size unknown" : formatBytes(file.size)}
            {file.md5 ? "" : " · no checksum"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderManifest(
  record: ZenodoRecordSummary,
  outcome: {
    verified: number;
    unverified: number;
    failed: { key: string; reason: string }[];
    rewritten: { key: string; storedAs: string }[];
  },
): string {
  const lines = [
    `Zenodo record ${record.recordId} — ${record.title}`,
    record.doi ? `DOI: ${record.doi}` : "",
    `Source: ${record.htmlUrl}`,
    "",
    "Rebuilt into folders by BetterOSF from the file keys Zenodo stores. Zenodo has no",
    "folders; the structure was always in the keys, and its UI renders them flat.",
    "",
    `Files matching Zenodo's published md5: ${outcome.verified}`,
    `Files with no published checksum (included, unchecked): ${outcome.unverified}`,
    `Files NOT included: ${outcome.failed.length}`,
    `File names changed so they could not escape this archive: ${outcome.rewritten.length}`,
    "",
    ...outcome.failed.map((f) => `  MISSING  ${f.key} — ${f.reason}`),
    ...(outcome.rewritten.length > 0
      ? [
          "",
          "Zenodo stores a file's name exactly as its depositor typed it, including names that",
          "point outside a folder (\"../x\") or that no filesystem will accept. Those were made",
          "safe before packing. The Zenodo key is on the left, the path in this archive on the",
          "right — nothing was dropped, only renamed.",
          ...outcome.rewritten.map((r) => `  RENAMED  ${r.key}  ->  ${r.storedAs}`),
        ]
      : []),
    "",
    "key\tsize\tmd5",
    ...record.files.map((f) => `${f.key}\t${f.size ?? ""}\t${f.md5 ?? ""}`),
    "",
  ];
  return lines.join("\n");
}
