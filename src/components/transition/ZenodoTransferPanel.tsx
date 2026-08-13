"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runTransfer, FILES_PER_RECORD, type TransferProgress, type TransferResult } from "@/lib/transition/run-transfer";
import { createBrowserLedger, getLocalJob, listLocalJobs } from "@/lib/transition/ledger";
import { crosswalk, blockingGaps, type CrosswalkResult } from "@/lib/transition/crosswalk";
import { planShards, ZENODO_MAX_BYTES_PER_RECORD } from "@/lib/transition/targets/zenodo";
import { RESOURCE_TYPES, DEFAULT_RESOURCE_TYPE_ID, SUGGESTED_RESOURCE_TYPE_IDS } from "@/lib/transition/resource-types";
import { opfsAvailable } from "@/lib/transition/stage-opfs";
import { keepScreenAwake, wakeLockSupported } from "@/lib/transition/wake-lock";
import { clausesByIds, TERMS_VERSION } from "@/lib/terms";
import { formatBytes } from "@/lib/transition/format";
import { downloadBlob } from "@/lib/backup/download";
import { readApiError, networkError, type ApiError } from "@/lib/api-error";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Working } from "@/components/Progress";
import { fetchExtras } from "./plan-extras";
import { Stat } from "./Stat";
import { PublishPanel } from "./PublishPanel";
import type { PlanResponse } from "./plan-types";
import type { ExportPlan } from "@/lib/transition/run-export";

type Connection =
  | { phase: "checking" }
  | { phase: "disconnected"; site: string; env: string }
  | { phase: "connected"; site: string; env: string; expiresAt: number | null }
  | { phase: "unavailable"; message: string };

type RunPhase = "idle" | "running" | "done" | "error";

/**
 * Transfer a project to Zenodo.
 *
 * Everything irreversible is separated out and gated: this panel creates a **draft**, and
 * a draft is private, deletable and mints no DOI. Publishing is a different button, a
 * different route, and a typed phrase the server re-derives from the draft's real
 * contents.
 *
 * The clauses shown before starting are the third-party-destination and
 * authority-to-deposit ones, because those are what a transfer actually engages: a
 * researcher depositing participant data into a public archive may breach the consent
 * those participants gave, and BetterOSF has no way to know that from the outside.
 */
export function ZenodoTransferPanel({ plan, appVersion }: { plan: PlanResponse; appVersion: string }) {
  const [connection, setConnection] = useState<Connection>({ phase: "checking" });
  const [resourceTypeId, setResourceTypeId] = useState<string>(DEFAULT_RESOURCE_TYPE_ID);
  const [isMirror, setIsMirror] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [resumable, setResumable] = useState<{ jobId: string; records: { recordId: string }[] } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/zenodo/session", { cache: "no-store" });
      if (!res.ok) {
        // 503 means the deployment has no Zenodo credentials; anything else is a
        // real failure. Both read the same way to the user, and the server's own
        // wording says which it was.
        const err = await readApiError(res, "/api/zenodo/session");
        setConnection({ phase: "unavailable", message: `${err.message} ${err.action ?? ""}`.trim() });
        return;
      }
      const body: { connected: boolean; site: string; env: string; expiresAt: number | null } = await res.json();
      setConnection(
        body.connected
          ? { phase: "connected", site: body.site, env: body.env, expiresAt: body.expiresAt }
          : { phase: "disconnected", site: body.site, env: body.env },
      );
    } catch (e) {
      const err = networkError("/api/zenodo/session", e);
      setConnection({ phase: "unavailable", message: `${err.message} ${err.action ?? ""}`.trim() });
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  // An unfinished run for THIS project, from this browser. Offered rather than resumed
  // automatically: silently continuing into somebody's Zenodo account is not a decision
  // a page load should make.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const jobs = await listLocalJobs();
        const match = jobs.find((j) => j.guid === plan.guid && j.status === "running");
        if (!cancelled && match) {
          setResumable({ jobId: match.jobId, records: match.records });
        }
      } catch {
        /* no local ledger is not an error — it just means nothing to resume */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.guid]);

  useEffect(() => {
    if (runPhase !== "running") return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [runPhase]);

  const totalBytes = plan.files.reduce((n, f) => n + f.size, 0);

  const crosswalked: CrosswalkResult = useMemo(
    () =>
      crosswalk({
        title: plan.title,
        description: plan.description,
        category: plan.category,
        tags: plan.tags,
        dateCreated: plan.dateCreated,
        dateModified: plan.dateModified,
        osfUrl: plan.osfUrl,
        doi: plan.doi,
        license: plan.license ?? null,
        contributors: plan.contributors ?? [],
        resourceTypeId,
        isIdenticalMirror: isMirror,
      }),
    [plan, resourceTypeId, isMirror],
  );

  const shardPlan = useMemo(
    () => planShards(plan.files, { maxFiles: FILES_PER_RECORD, maxBytes: ZENODO_MAX_BYTES_PER_RECORD }),
    [plan.files],
  );

  const gaps = blockingGaps(crosswalked);

  async function start(resume: { jobId: string; records: { recordId: string }[] } | null) {
    setRunPhase("running");
    setError(null);
    setResult(null);
    abort.current = new AbortController();
    const wakeLock = await keepScreenAwake();
    let runId: string | null = null;

    try {
      const [osfTokenRes, zenodoTokenRes] = await Promise.all([
        fetch("/api/transition/osf-token", { cache: "no-store" }),
        fetch("/api/zenodo/token", { cache: "no-store" }),
      ]);
      if (!osfTokenRes.ok) {
        const err = await readApiError(osfTokenRes, "/api/transition/osf-token");
        throw new Error(err.action ? `${err.message} ${err.action}` : err.message);
      }
      if (!zenodoTokenRes.ok) {
        const err = await readApiError(zenodoTokenRes, "/api/zenodo/token");
        throw new Error(err.action ? `${err.message} ${err.action}` : err.message);
      }
      const { token: osfToken } = await osfTokenRes.json();
      const { token: zenodoToken, env } = await zenodoTokenRes.json();

      const id = resume?.jobId ?? crypto.randomUUID();
      runId = id;
      setJobId(id);

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
          license: plan.license ? { name: plan.license.name, url: null } : null,
        },
      };

      const r = await runTransfer({
        jobId: id,
        plan: exportPlan,
        osfToken,
        zenodo: { accessToken: zenodoToken, env },
        metadata: crosswalked.metadata,
        fidelity: crosswalked.fidelity,
        appVersion,
        now: () => new Date(),
        signal: abort.current.signal,
        ledger: createBrowserLedger(),
        resumeRecordIds: resume ? resume.records.map((rec) => rec.recordId) : null,
        onProgress: setProgress,
      });

      setResult(r);
      setRunPhase("done");
      setResumable(null);
    } catch (e) {
      // A user pressing Stop is not a failure, and describing it as one ("signal is
      // aborted without reason") makes a deliberate act look like a crash — and hides the
      // one thing they need to know, which is that the run can be picked up again.
      const stopped = e instanceof DOMException && e.name === "AbortError";
      setError({
        message: stopped
          ? "Transfer stopped."
          : e instanceof Error
            ? e.message
            : "The transfer failed.",
        action:
          "Nothing on OSF was changed. The Zenodo draft keeps every file already verified, so starting again continues from there rather than re-uploading.",
        code: stopped ? "stopped_by_user" : "transfer_failed",
        status: 0,
        detail: stopped ? null : e instanceof Error ? `${e.name}: ${e.message}` : null,
        requestId: null,
        at: new Date().toISOString(),
        endpoint: null,
      });
      setRunPhase("error");

      // Offer to continue, but only with the record ids the ledger actually holds. A
      // resume with an empty record list would silently create FRESH drafts and leave the
      // half-filled ones behind as litter in someone's Zenodo account.
      if (runId) {
        const saved = await getLocalJob(runId).catch(() => null);
        if (saved && saved.records.length > 0) {
          setResumable({ jobId: saved.jobId, records: saved.records });
        }
      }
    } finally {
      await wakeLock.release();
    }
  }

  async function resumeExisting() {
    if (!resumable) return;
    // Re-read the local job so the record ids are the ones actually on disk rather than
    // whatever the list happened to hold when the page loaded.
    const job = await getLocalJob(resumable.jobId).catch(() => null);
    await start(job ? { jobId: job.jobId, records: job.records } : resumable);
  }

  if (connection.phase === "checking") {
    return (
      <div className="mt-4">
        <Working>Checking your Zenodo connection…</Working>
      </div>
    );
  }

  if (connection.phase === "unavailable") {
    return (
      <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <p>{connection.message}</p>
        <p className="mt-2">You can still download a verified copy to this computer.</p>
      </div>
    );
  }

  if (runPhase === "running") {
    const pct = progress && progress.bytesTotal > 0
      ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
      : 0;
    return (
      <div className="mt-4">
        <h3 className="text-sm font-semibold">Transferring to {connection.site}</h3>
        <div className="mt-3 h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
          <div className="h-full bg-neutral-900 dark:bg-white" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          {progress
            ? progress.phase === "preparing"
              ? "Creating the draft…"
              : progress.phase === "finishing"
                ? "Checking what actually arrived…"
                : `File ${progress.fileIndex + 1} of ${progress.fileCount} — ${progress.currentPath}`
            : "Starting…"}
        </p>
        {progress && progress.shardCount > 1 ? (
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Record {progress.shardIndex} of {progress.shardCount}
          </p>
        ) : null}
        {progress?.bytesPerSecond ? (
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{formatBytes(progress.bytesPerSecond)}/s</p>
        ) : null}
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          Files go straight from OSF to Zenodo through this tab — they never pass through BetterOSF&apos;s
          servers. {wakeLockSupported()
            ? "This page is holding a wake lock so the screen does not sleep."
            : "This browser cannot keep the screen awake, so turn off sleep if the run is long."}{" "}
          If you close the tab, the run stops and can be resumed from here.
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

  if (runPhase === "done" && result) {
    const complete = result.verdict.status === "complete";
    return (
      <div className="mt-4">
        <div
          className={`rounded border p-4 ${
            complete
              ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
              : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
          }`}
        >
          <h3 className="text-base font-semibold">
            {complete ? "Transfer complete — nothing is published yet" : "Transfer INCOMPLETE"}
          </h3>
          <p className="mt-1 text-sm">{result.verdict.summary}</p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Stat label="Expected">{result.verdict.counts.expected}</Stat>
          <Stat label="Verified">{result.verdict.counts.verified}</Stat>
          <Stat label="Unverifiable">{result.verdict.counts.unverifiable}</Stat>
          <Stat label="Failed">{result.verdict.counts.failed}</Stat>
          <Stat label="Missing">{result.verdict.counts.missing}</Stat>
          <Stat label="Records">{result.records.length}</Stat>
        </dl>

        {result.supplement.deposited < result.supplement.expected ? (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            The report bundle reached {result.supplement.deposited} of {result.supplement.expected} records.
            Your data is unaffected — download the report below and add it yourself if you want it deposited.
            {result.supplement.problems.length > 0 ? ` (${result.supplement.problems[0]})` : ""}
          </p>
        ) : null}

        <ul className="mt-4 space-y-1 text-sm">
          {result.records.map((r) => (
            <li key={r.recordId}>
              <a href={r.draftUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Draft {r.recordId}
              </a>{" "}
              <span className="text-neutral-600 dark:text-neutral-400">({r.fileCount} files)</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              downloadBlob(new Blob([result.reportMarkdown], { type: "text/markdown" }), `${result.filenameStem}_report.md`)
            }
            className="rounded border border-neutral-400 px-4 py-2 text-sm dark:border-neutral-600"
          >
            Download the report
          </button>
          <button
            type="button"
            onClick={() =>
              downloadBlob(new Blob([result.crosswalkCsv], { type: "text/csv" }), `${result.filenameStem}_crosswalk.csv`)
            }
            className="rounded border border-neutral-400 px-4 py-2 text-sm dark:border-neutral-600"
          >
            Download the link crosswalk (CSV)
          </button>
        </div>

        {jobId ? (
          <PublishPanel
            jobId={jobId}
            records={result.records}
            publishable={complete}
            site={connection.site}
            env={connection.env}
          />
        ) : null}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm">Full report</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
            {result.reportMarkdown}
          </pre>
        </details>
      </div>
    );
  }

  // Idle / error: the setup form.
  const clauses = clausesByIds([
    "transition-third-party-destinations",
    "transition-authority-to-deposit",
    "transition-publication-irreversible",
  ]);

  return (
    <div className="mt-4">
      {runPhase === "error" && error ? (
        <div className="mb-4">
          <ErrorNotice error={error} title="The transfer did not finish" />
        </div>
      ) : null}

      {connection.phase === "disconnected" ? (
        <div className="rounded border border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h3 className="text-sm font-semibold">Connect your Zenodo account</h3>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            BetterOSF will ask {connection.site} for permission to create and edit deposits on your behalf.
            The deposit is yours, in your account, under your name.
          </p>
          {connection.env === "sandbox" ? (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              This deployment is pointed at Zenodo&apos;s <strong>sandbox</strong>. Deposits there are test
              records that can be wiped at any time, and any DOI is a test DOI. Do not treat a sandbox deposit
              as a copy of your data.
            </p>
          ) : null}
          <a
            href={`/api/zenodo/oauth/start?returnTo=${encodeURIComponent(`/transition/${plan.guid}`)}`}
            className="mt-3 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Connect to Zenodo
          </a>
        </div>
      ) : null}

      {connection.phase === "connected" ? (
        <>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Connected to{" "}
            <a href={connection.site} className="underline" target="_blank" rel="noopener noreferrer">
              {connection.site.replace(/^https:\/\//, "")}
            </a>
            {connection.env === "sandbox" ? " (a test instance — deposits there are wipeable)" : ""}.{" "}
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/zenodo/session", { method: "DELETE" });
                await checkConnection();
              }}
              className="underline"
            >
              Disconnect
            </button>
          </p>

          {resumable ? (
            <div className="mt-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <p>
                An unfinished transfer of this project is saved in this browser. Continuing reuses the same
                Zenodo draft and skips files it already verified there.
              </p>
              <button
                type="button"
                onClick={() => void resumeExisting()}
                className="mt-2 rounded bg-neutral-900 px-3 py-1 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                Continue that transfer
              </button>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">What is this deposit?</span>
              <select
                value={resourceTypeId}
                onChange={(e) => setResourceTypeId(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <optgroup label="Common">
                  {SUGGESTED_RESOURCE_TYPE_IDS.map((id) => {
                    const t = RESOURCE_TYPES.find((r) => r.id === id)!;
                    return (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    );
                  })}
                </optgroup>
                <optgroup label="Everything else">
                  {RESOURCE_TYPES.filter(
                    (t) => !(SUGGESTED_RESOURCE_TYPE_IDS as readonly string[]).includes(t.id),
                  ).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Never guessed from OSF&apos;s category (&ldquo;{plan.category || "unknown"}&rdquo;) — the two
                vocabularies do not correspond, and a wrong type corrupts how DataCite indexes your work.
              </span>
            </label>

            <label className="text-sm">
              <span className="font-medium">Relationship to the OSF original</span>
              <select
                value={isMirror ? "identical" : "derived"}
                onChange={(e) => setIsMirror(e.target.value === "identical")}
                className="mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="identical">The same work, moved (IsIdenticalTo)</option>
                <option value="derived">Derived from the OSF project (IsDerivedFrom)</option>
              </select>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Recorded on the deposit so the two records point at each other.
              </span>
            </label>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Files">{plan.files.length}</Stat>
            <Stat label="Total size">{formatBytes(totalBytes)}</Stat>
            <Stat label="Records">{Math.max(1, shardPlan.shards.length)}</Stat>
            <Stat label="Licence">
              {plan.licenseLookupFailed ? "not known" : (plan.license?.name ?? "none set")}
            </Stat>
          </dl>

          {shardPlan.shards.length > 1 ? (
            <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Zenodo allows {FILES_PER_RECORD + 1} files and{" "}
              {Math.round(ZENODO_MAX_BYTES_PER_RECORD / 1024 ** 3)} GB per record, so this project will be
              split across <strong>{shardPlan.shards.length} linked records</strong> (each declaring the
              others as parts of the same deposit). Publishing them mints {shardPlan.shards.length} DOIs.
            </p>
          ) : null}

          {shardPlan.unplaceable.length > 0 ? (
            <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <p>
                {shardPlan.unplaceable.length} file(s) cannot go into any Zenodo record and will be recorded
                as failures, which means this transfer cannot reconcile as complete:
              </p>
              <ul className="mt-2 list-disc pl-5">
                {shardPlan.unplaceable.slice(0, 5).map((u) => (
                  <li key={u.file.path}>
                    <code>{u.file.path}</code> — {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.licenseLookupFailed ? (
            <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              BetterOSF could not read this project&apos;s licence from OSF, so none is set on the deposit.
              That is not the same as &ldquo;no licence&rdquo; — check it on the draft before publishing.
            </p>
          ) : null}

          {gaps.length > 0 ? (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p>You can transfer now, but Zenodo will not let you publish until you fix these on the draft:</p>
              <ul className="mt-2 list-disc pl-5">
                {gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="mt-4">
            <summary className="cursor-pointer text-sm">
              What survives the crossing, and what does not ({crosswalked.fidelity.length} fields)
            </summary>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-300 dark:border-neutral-700">
                  <th className="py-1 pr-2">Field</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {crosswalked.fidelity.map((row) => (
                  <tr key={`${row.field}-${row.source}`} className="border-b border-neutral-200 align-top dark:border-neutral-800">
                    <td className="py-1 pr-2 font-mono">{row.field}</td>
                    <td className="py-1 pr-2">{row.status}</td>
                    <td className="py-1">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

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
                I have the right to deposit this content at {connection.site.replace(/^https:\/\//, "")}, and I
                understand BetterOSF creates a private draft that I must review and publish myself. (Terms{" "}
                {TERMS_VERSION}.)
              </span>
            </label>
          </div>

          <button
            type="button"
            disabled={!acknowledged || !opfsAvailable() || plan.files.length === 0}
            onClick={() => void start(null)}
            className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            Start transfer
          </button>
          {plan.files.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
              This project has no files, so there is nothing to transfer.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
