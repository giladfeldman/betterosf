"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runExport, type ExportPlan, type ExportProgress, type ExportResult } from "@/lib/transition/run-export";
import { opfsAvailable } from "@/lib/transition/stage-opfs";
import { clausesByIds, TRANSITION_DIALOG_CLAUSE_IDS, TERMS_VERSION } from "@/lib/terms";
import { downloadBlob } from "@/lib/backup/download";
import { saveArchive, canChooseSaveLocation, type SaveOutcome } from "@/lib/transition/save-archive";
import { keepScreenAwake } from "@/lib/transition/wake-lock";
import { createBrowserLedger } from "@/lib/transition/ledger";
import { ZenodoTransferPanel } from "./ZenodoTransferPanel";
import { formatBytes } from "@/lib/transition/format";
import { readApiError, networkError, type ApiError } from "@/lib/api-error";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Working } from "@/components/Progress";
import { fetchExtras } from "./plan-extras";
import { Stat } from "./Stat";
import type { PlanResponse } from "./plan-types";

type Phase = "loading" | "preflight" | "running" | "done" | "error";

/** Where a project's copy is going. "Leave it alone" is always the third option. */
type Destination = "local" | "zenodo";

/**
 * Preflight and run for a single-project export.
 *
 * The preflight is a contract: everything the run will and will not do is on screen
 * before anything starts — file count, total bytes, how many files cannot be verified and
 * why, and whether the plan was truncated. Nobody should discover any of that at file 400.
 */
export function ExportRunner({ guid, appVersion }: { guid: string; appVersion: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [destination, setDestination] = useState<Destination>("local");
  const [saveState, setSaveState] = useState<SaveOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch(`/api/transition/plan/${guid}`, { cache: "no-store" });
      if (!res.ok) {
        setError(await readApiError(res, `/api/transition/plan/${guid}`));
        setPhase("error");
        return;
      }
      setPlan(await res.json());
      setPhase("preflight");
    } catch (e) {
      setError(networkError(`/api/transition/plan/${guid}`, e));
      setPhase("error");
    }
  }, [guid]);

  useEffect(() => {
    void load();
  }, [load]);

  // A run can take hours. Warn before a reload throws away staged work.
  useEffect(() => {
    if (phase !== "running") return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  async function start() {
    if (!plan) return;
    setPhase("running");
    setError(null);
    abort.current = new AbortController();

    // Best-effort: a laptop that sleeps mid-run stalls the transfer. Released in `finally`.
    const wakeLock = await keepScreenAwake();

    try {
      // READ scope, deliberately: /api/osf/upload-token requires write, which the
      // transition sign-in does not ask for — so using it here 403'd every user who
      // arrived through /transition.
      const tokenRes = await fetch("/api/transition/osf-token", { cache: "no-store" });
      if (!tokenRes.ok) {
        const err = await readApiError(tokenRes, "/api/transition/osf-token");
        throw new Error(err.action ? `${err.message} ${err.action}` : err.message);
      }
      const { token } = await tokenRes.json();

      const exportPlan: ExportPlan = {
        guid: plan.guid,
        projectTitle: plan.title,
        osfUrl: plan.osfUrl,
        doi: plan.doi,
        files: plan.files.map((f) => ({ ...f, provider: f.path.split("/")[0] ?? "osfstorage" })),
        extras: await fetchExtras(plan),
        contributors: plan.contributors ?? [],
        crateInput: {
          description: plan.description,
          datePublished: plan.dateCreated.slice(0, 10),
          dateModified: plan.dateModified.slice(0, 10),
          keywords: plan.tags,
          license: null,
        },
      };

      const r = await runExport({
        plan: exportPlan,
        token,
        appVersion,
        now: () => new Date(),
        signal: abort.current.signal,
        onProgress: setProgress,
      });
      setResult(r);
      setPhase("done");

      // Record the run, so the inventory can answer "which of these have I already
      // dealt with" for an account with hundreds of projects. Best-effort: a
      // checkpoint that fails must never turn a completed export into an error, and
      // the archive is already in the browser either way.
      await createBrowserLedger()
        .saveJob({
          jobId: crypto.randomUUID(),
          guid: plan.guid,
          destination: "local",
          // A local export has no Zenodo instance, and saying "sandbox" would be a
          // false statement about where this person's data went.
          env: "none",
          status: r.verdict.status === "complete" ? "complete" : "incomplete",
          records: [],
          fileCount: plan.files.length,
          bytesTotal: totalBytes,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : "The export failed.",
        action: "Nothing on OSF was changed. Anything already downloaded is still on your computer.",
        code: "export_failed",
        status: 0,
        detail: e instanceof Error ? `${e.name}: ${e.message}` : null,
        requestId: null,
        at: new Date().toISOString(),
        endpoint: null,
      });
      setPhase("error");
    } finally {
      await wakeLock.release();
    }
  }

  if (phase === "loading") {
    return (
      <Working>
        Reading this project from OSF — files, wikis, contributors and checksums…
      </Working>
    );
  }

  if (phase === "error" && error) {
    return <ErrorNotice error={error} title="Could not read this project" onRetry={() => void load()} />;
  }

  if (!plan) return null;

  const totalBytes = plan.files.reduce((n, f) => n + f.size, 0);

  if (phase === "done" && result) {
    const v = result.verdict;
    const complete = v.status === "complete";
    return (
      <div>
        <div
          className={`rounded border p-4 ${
            complete
              ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
              : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
          }`}
        >
          <h2 className="text-base font-semibold">
            {complete ? "Export complete" : "Export INCOMPLETE"}
          </h2>
          <p className="mt-1 text-sm">{v.summary}</p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Stat label="Expected">{v.counts.expected}</Stat>
          <Stat label="Verified">{v.counts.verified}</Stat>
          <Stat label="Unverifiable">{v.counts.unverifiable}</Stat>
          <Stat label="Failed">{v.counts.failed}</Stat>
          <Stat label="Missing">{v.counts.missing}</Stat>
        </dl>

        {result.interrupted ? (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p>
              <strong>
                {result.interrupted.stoppedByUser ? "You stopped this export." : "This export was cut short."}
              </strong>{" "}
              {result.interrupted.reason}
            </p>
            {result.interrupted.atFile ? (
              <p className="mt-1">
                It stopped at <code>{result.interrupted.atFile}</code>.
              </p>
            ) : null}
            <p className="mt-1">
              The archive below holds everything that was downloaded and verified before that
              point, and its report says exactly which files are missing. Running the export again
              starts over from the beginning.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => setSaveState(await saveArchive(result.blob, `${result.filenameStem}.zip`))}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            {canChooseSaveLocation() ? "Save the archive…" : "Download the archive"}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadBlob(
                new Blob([result.crosswalkCsv], { type: "text/csv" }),
                `${result.filenameStem}_crosswalk.csv`,
              )
            }
            className="rounded border border-neutral-400 px-4 py-2 text-sm dark:border-neutral-600"
          >
            Download the link crosswalk (CSV)
          </button>
        </div>

        {saveState ? (
          <p
            className={`mt-3 text-sm ${
              saveState.saved
                ? "text-neutral-700 dark:text-neutral-300"
                : "rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
            }`}
          >
            {saveState.saved && saveState.picked
              ? `Saved as ${saveState.name} where you chose.`
              : saveState.saved
                ? `${saveState.name} was sent to your browser's downloads. BetterOSF cannot see where your browser puts them — check your Downloads folder or the browser's download list.`
                : saveState.cancelled
                  ? "Not saved — you closed the save dialog. The archive is still here; press the button again."
                  : `Could not save the archive: ${saveState.error}`}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          The archive is a BagIt bag with an RO-Crate description, a SHA-256 manifest, the full
          report, and a disclaimer. Nothing on OSF was changed or deleted.{" "}
          {canChooseSaveLocation()
            ? "Your browser will ask where to put it."
            : "Your browser will put it wherever it saves downloads — usually your Downloads folder, unless you have set it to ask each time."}
        </p>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm">Full report</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
            {result.reportMarkdown}
          </pre>
        </details>
      </div>
    );
  }

  if (phase === "running") {
    const pct = progress && progress.bytesTotal > 0
      ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
      : 0;
    return (
      <div>
        <h2 className="text-base font-semibold">Exporting {plan.title}</h2>
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
          <div className="h-full bg-neutral-900 dark:bg-white" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          {progress
            ? progress.phase === "packaging"
              ? "Packaging the archive…"
              : `File ${progress.fileIndex + 1} of ${progress.fileCount} — ${progress.currentPath}`
            : "Starting…"}
        </p>
        {progress?.bytesPerSecond ? (
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            {formatBytes(progress.bytesPerSecond)}/s
          </p>
        ) : null}
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          Keep this tab open. Files come straight from OSF to this browser and never pass through
          BetterOSF&apos;s servers. They are held in the browser&apos;s private storage while the
          archive is built — <strong>nothing appears in your Downloads folder until the end</strong>,
          when you save the archive yourself.
        </p>
        <button
          type="button"
          onClick={() => abort.current?.abort()}
          className="mt-3 rounded border border-neutral-400 px-3 py-1 text-sm dark:border-neutral-600"
        >
          Stop
        </button>
      </div>
    );
  }

  // Preflight.
  const clauses = clausesByIds(TRANSITION_DIALOG_CLAUSE_IDS.slice(0, 3));
  return (
    <div>
      <h2 className="text-base font-semibold">Take a copy of {plan.title}</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {/* Plain anchor, not next/link: this is an external OSF URL, and typed routes
            reject it. */}
        <a href={plan.osfUrl} className="underline" target="_blank" rel="noopener noreferrer">
          {plan.osfUrl}
        </a>
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Files">{plan.files.length}</Stat>
        <Stat label="Total size">{formatBytes(totalBytes)}</Stat>
        <Stat label="Wiki pages">{plan.wikis?.length ?? "unknown"}</Stat>
        <Stat label="Contributors">{plan.contributors?.length ?? "unknown"}</Stat>
      </dl>

      {plan.truncated ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          This project is larger than BetterOSF walks in one pass (over {plan.limits.maxFiles} files, or
          nested deeper than {plan.limits.maxDepth} levels). An export from here would <strong>not</strong> be
          a complete copy, and will say so in its report. Export folders separately instead.
        </p>
      ) : null}

      {plan.unverifiableCount > 0 ? (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {plan.unverifiableCount} of {plan.files.length} files have no checksum on OSF — typically files
          in third-party storage{plan.addonProviders?.length ? ` (${plan.addonProviders.join(", ")})` : ""}.
          They will be downloaded, but BetterOSF cannot confirm they match the original, and the report
          will list them as unverifiable.
        </p>
      ) : null}

      {plan.files.length === 0 ? (
        <p className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          This project has no files. An export would produce an empty archive, which BetterOSF will
          report as “nothing was transferred” rather than as a success.
        </p>
      ) : null}

      {!opfsAvailable() ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          This browser does not provide the local file storage BetterOSF needs to stage large files.
          Try a recent Chrome, Edge or Firefox.
        </p>
      ) : null}

      <fieldset className="mt-6 rounded border border-neutral-300 p-4 dark:border-neutral-700">
        <legend className="px-1 text-sm font-semibold">Where should the copy go?</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="destination"
            value="local"
            checked={destination === "local"}
            onChange={() => setDestination("local")}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            <strong>Download it to this computer.</strong> A BagIt archive with a SHA-256 manifest,
            an RO-Crate description and the full verification report. Nothing leaves your machine.
            Files are staged in the browser while it runs and you save the finished archive at the
            end — {canChooseSaveLocation()
              ? "your browser will ask you where to put it."
              : "your browser will save it wherever it saves downloads."}
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="destination"
            value="zenodo"
            checked={destination === "zenodo"}
            onChange={() => setDestination("zenodo")}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            <strong>Transfer it to Zenodo.</strong> Creates a private <em>draft</em> in your own Zenodo
            account, file by file, each one checksum-verified. Nothing is published and no DOI is minted
            until you separately confirm it.
          </span>
        </label>
        {/*
          The recommendation default is "leave it alone" — public projects stay on OSF at
          the same URL and DOI after the transition, and a frictionless "migrate all" would
          duplicate content COS keeps online while splitting the citation record.
        */}
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          You may not need either. Public projects, registrations and preprints stay on OSF at the same
          URL and DOI. The deadlines affect what you can <em>change</em>, not whether public work stays
          readable.
        </p>
      </fieldset>

      {destination === "zenodo" ? (
        <ZenodoTransferPanel plan={plan} appVersion={appVersion} />
      ) : null}

      {destination === "local" ? (
        <>
      <div className="mt-6 rounded border border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-sm font-semibold">Before you start</h3>
        <ul className="mt-2 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
          {clauses.map((c) => (
            <li key={c.id}>
              <strong>{c.heading}.</strong> {c.body}
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            I understand this report is not a warranty, and that I must verify this copy myself before
            relying on it. (Terms {TERMS_VERSION}.)
          </span>
        </label>
      </div>

      <button
        type="button"
        disabled={!acknowledged || !opfsAvailable()}
        onClick={() => void start()}
        className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        Start export
      </button>
        </>
      ) : null}
    </div>
  );
}

