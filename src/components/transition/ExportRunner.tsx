"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runExport, type ExportPlan, type ExportProgress, type ExportResult } from "@/lib/transition/run-export";
import { opfsAvailable } from "@/lib/transition/stage-opfs";
import { clausesByIds, TRANSITION_DIALOG_CLAUSE_IDS, TERMS_VERSION } from "@/lib/terms";
import { downloadBlob } from "@/lib/backup/download";
import type { ContributorView } from "@/lib/osf/contributors";

type PlanResponse = {
  guid: string;
  title: string;
  description: string;
  osfUrl: string;
  dateCreated: string;
  dateModified: string;
  tags: string[];
  doi: string | null;
  addonProviders: string[] | null;
  files: { osfFileId: string; path: string; size: number; downloadUrl: string; md5: string | null; sha256: string | null }[];
  wikis: { id: string; name: string; size: number }[] | null;
  contributors: ContributorView[] | null;
  truncated: boolean;
  limits: { maxFiles: number; maxDepth: number };
  unverifiableCount: number;
};

type Phase = "loading" | "preflight" | "running" | "done" | "error";

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
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch(`/api/transition/plan/${guid}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Could not read this project (HTTP ${res.status}).`);
        setPhase("error");
        return;
      }
      setPlan(await res.json());
      setPhase("preflight");
    } catch {
      setError("Could not reach BetterOSF.");
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

    try {
      const tokenRes = await fetch("/api/osf/upload-token", { cache: "no-store" });
      if (!tokenRes.ok) {
        throw new Error("Could not get an OSF access token. Sign in again and retry.");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
      setPhase("error");
    }
  }

  if (phase === "loading") {
    return <p className="text-sm text-neutral-600 dark:text-neutral-400">Reading this project from OSF…</p>;
  }

  if (phase === "error") {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <p>{error}</p>
        <p className="mt-2">Nothing on OSF was changed.</p>
        <button type="button" onClick={() => void load()} className="mt-2 underline">
          Try again
        </button>
      </div>
    );
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

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadBlob(result.blob, `${result.filenameStem}.zip`)}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Download the archive
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

        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          The archive is a BagIt bag with an RO-Crate description, a SHA-256 manifest, the full
          report, and a disclaimer. Nothing on OSF was changed or deleted.
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
          Keep this tab open. Files are downloaded straight from OSF to your computer — they never
          pass through BetterOSF&apos;s servers.
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
      <h2 className="text-base font-semibold">Export {plan.title}</h2>
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
    </div>
  );
}

/** Fetch the non-file content that OSF offers no export for. */
async function fetchExtras(plan: PlanResponse): Promise<{ path: string; text: string }[]> {
  const extras: { path: string; text: string }[] = [];

  for (const wiki of plan.wikis ?? []) {
    try {
      const res = await fetch(`/api/transition/wiki/${wiki.id}`, { cache: "no-store" });
      if (res.ok) {
        extras.push({ path: `wikis/${safeName(wiki.name)}.md`, text: await res.text() });
      }
    } catch {
      /* a missing wiki is recorded by its absence from the manifest, not faked */
    }
  }

  extras.push({
    path: "metadata/osf-project.json",
    text: JSON.stringify(
      {
        guid: plan.guid,
        title: plan.title,
        description: plan.description,
        url: plan.osfUrl,
        doi: plan.doi,
        dateCreated: plan.dateCreated,
        dateModified: plan.dateModified,
        tags: plan.tags,
        addonProviders: plan.addonProviders,
        contributors: plan.contributors,
      },
      null,
      2,
    ),
  });

  return extras;
}

function safeName(name: string): string {
  return name.replace(/[^\w. -]+/g, "_").slice(0, 80) || "untitled";
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <dt className="text-xs text-neutral-600 dark:text-neutral-400">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
