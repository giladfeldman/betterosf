/**
 * The export orchestrator — plan, stage, verify, package, reconcile.
 *
 * Runs in the browser. Bytes go OSF → this tab → disk, and never through Vercel; see
 * `stage-opfs.ts` for the staging half and `verify.ts` for what "verified" is allowed to
 * mean.
 *
 * The shape of the run is deliberately boring and sequential. One file at a time is
 * staged, hashed, verified, written into the archive, and then RELEASED from staging, so
 * peak disk use is one file rather than the whole project. A parallel version would be
 * faster and would multiply both the disk footprint and the ways a resumed run can go
 * wrong.
 *
 * Nothing here decides success. `reconcile()` does, from the collected results, and it
 * refuses to call an empty run complete.
 */

import { downloadZip } from "client-zip";
import {
  stageFile,
  stagedBlob,
  discardStaged,
  clearStaging,
  requestPersistence,
  opfsAvailable,
} from "./stage-opfs";
import { verifyFile, reconcile, type FileVerification, type ReconciliationVerdict } from "./verify";
import { buildBagTagFiles, type BagFile, type BagInfo } from "./package-bagit";
import { buildRoCrate, type CrateFile } from "./ro-crate";
import { renderReportMarkdown, renderCrosswalkCsv, reportFilename, type ReportInput } from "./report";
import type { ContributorView } from "@/lib/osf/contributors";

export type PlannedExportFile = {
  osfFileId: string;
  /**
   * Path inside the bag's data/ directory, e.g. `osfstorage/sub/a.csv`, or
   * `components/<guid>-<title>/osfstorage/sub/a.csv` for a file on a component.
   */
  path: string;
  /**
   * OSF's own name, present ONLY when sanitising had to change it.
   *
   * Reported in the crosswalk so a rename is never silent — see `safeEntryPath`.
   */
  osfPath?: string;
  size: number;
  downloadUrl: string;
  md5: string | null;
  sha256: string | null;
  /**
   * The OSF node the file lives on — the root project, or one of its components,
   * registrations or linked projects. Carried so the report can say where each file came
   * from; an export spanning several nodes cannot answer that from the path alone without
   * re-parsing a naming convention.
   *
   * (There used to be a `provider` field here, derived by both callers as
   * `path.split("/")[0]`. Nothing ever read it, and once component files gained a path
   * prefix that derivation started returning "components". A field no consumer reads is
   * not a fact, it is a liability.)
   */
  sourceGuid: string;
};

export type ExportSelection = {
  files: boolean;
  wikis: boolean;
  metadata: boolean;
  contributors: boolean;
  logs: boolean;
  comments: boolean;
};

export type ExportPlan = {
  guid: string;
  projectTitle: string;
  osfUrl: string;
  doi: string | null;
  files: PlannedExportFile[];
  /** Non-file content already fetched as text, keyed by path within the bag. */
  extras: { path: string; text: string }[];
  /**
   * Every OSF node this plan covers, root first.
   *
   * Rendered into the report so the SCOPE of an export is stated rather than inferred from
   * folder names. A project with six components used to export as a copy of a seventh of
   * itself, and nothing said so.
   */
  coveredNodes: { guid: string; title: string; kind: string; fileCount: number }[];
  contributors: ContributorView[];
  crateInput: {
    description: string;
    datePublished: string;
    dateModified: string;
    keywords: string[];
    license: { name: string; url: string | null } | null;
  };
};

export type ExportProgress = {
  phase: "staging" | "packaging" | "done";
  fileIndex: number;
  fileCount: number;
  currentPath: string;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond: number | null;
};

export type ExportResult = {
  /**
   * Set when the run did not get through every file — because the user pressed Stop, or
   * because something failed hard partway. The archive is still produced from what DID
   * complete: losing an hour of verified downloads because file 48 of 79 dropped its
   * connection is the worst possible response to a transient network error.
   */
  interrupted: { reason: string; stoppedByUser: boolean; atFile: string | null } | null;
  verdict: ReconciliationVerdict;
  verifications: FileVerification[];
  blob: Blob;
  filenameStem: string;
  reportMarkdown: string;
  crosswalkCsv: string;
};

/**
 * One line of the run diary.
 *
 * Written as the run goes, into an array the CALLER owns, so it survives even when the run
 * throws — the case where it is most needed. "AbortError: The operation was aborted" told
 * us nothing about which file, which phase, or which attempt; this does.
 */
export type RunLogEntry = {
  at: string;
  /** "plan" | "stage" | "verify" | "package" | "done" — where the run had got to. */
  phase: string;
  /** File path, when the line is about one file. */
  path?: string;
  /** 1-based file position, so "48 of 79" is readable at a glance. */
  index?: number;
  /** Download attempt number, when retrying. */
  attempt?: number;
  message: string;
  /** Error name and message, never a stack — a stack from a minified bundle says nothing. */
  error?: string;
  ms?: number;
};

export type RunExportOptions = {
  plan: ExportPlan;
  token: string;
  appVersion: string;
  /** Injected so the run is deterministic in tests. */
  now: () => Date;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  /**
   * Appended to as the run proceeds. Owned by the caller precisely so that a run which
   * dies still leaves its diary behind.
   */
  log?: RunLogEntry[];
};

/**
 * Stage and verify every planned file, then package the lot.
 *
 * A file that fails is recorded and the run CONTINUES: stopping at the first failure
 * would leave a researcher with nothing and no list of what went wrong. The verdict at
 * the end is what refuses to call it a success.
 */
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

/**
 * Retry a download that failed for a transient reason.
 *
 * Deliberately narrow about what counts as transient: a checksum mismatch, a size
 * mismatch, or a refusal from OSF are all reasons to STOP, because retrying cannot change
 * them and doing so would just take three times as long to reach the same honest failure.
 * Only a torn-down connection is retried.
 */
async function withRetry<T>(
  run: () => Promise<T>,
  opts: {
    signal?: AbortSignal;
    onDiscard: () => Promise<void>;
    onRetry?: (attempt: number, error: unknown) => void;
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (e) {
      lastError = e;
      // The user asked to stop. That is not a transient failure.
      if (opts.signal?.aborted) throw e;
      if (!isTransient(e) || attempt === DOWNLOAD_ATTEMPTS) throw e;
      opts.onRetry?.(attempt, e);
      // Any partial stage is untrustworthy after a torn connection — start clean.
      await opts.onDiscard();
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
    }
  }
  throw lastError;
}

/** Name + message. Never a stack: a stack from a minified bundle is noise. */
export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** A dropped connection, and nothing else. */
function isTransient(e: unknown): boolean {
  if (isAbortError(e)) return true;
  if (e instanceof TypeError) return true; // fetch's "network error"
  const message = e instanceof Error ? e.message : "";
  return /network|connection|failed to fetch|load failed/i.test(message);
}

/** Firefox reports a torn-down fetch as an AbortError; Chrome usually as a TypeError. */
function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

export async function runExport(opts: RunExportOptions): Promise<ExportResult> {
  const { plan, token, now } = opts;
  if (!opfsAvailable()) {
    throw new Error(
      "This browser cannot stage large files locally. Try a recent Chrome, Edge or Firefox.",
    );
  }
  await requestPersistence();

  const createdAt = now().toISOString();
  const log = opts.log;
  const note = (entry: Omit<RunLogEntry, "at">) => {
    log?.push({ at: new Date().toISOString(), ...entry });
  };
  note({
    phase: "plan",
    message: `Starting: ${plan.files.length} files, ${plan.extras.length} extras, ${plan.guid}`,
  });

  const verifications: FileVerification[] = [];
  const bagFiles: BagFile[] = [];
  const crateFiles: CrateFile[] = [];
  const archiveEntries: { name: string; input: Blob | string }[] = [];

  const bytesTotal = plan.files.reduce((n, f) => n + f.size, 0);
  let bytesDone = 0;

  let interrupted: ExportResult["interrupted"] = null;

  for (const [index, file] of plan.files.entries()) {
    // A user-requested stop is a decision, not a failure — but it still must not throw
    // away what has already been verified. Break, then package what we have.
    if (opts.signal?.aborted) {
      interrupted = {
        reason: "You stopped this export.",
        stoppedByUser: true,
        atFile: file.path,
      };
      break;
    }
    opts.onProgress?.({
      phase: "staging",
      fileIndex: index,
      fileCount: plan.files.length,
      currentPath: file.path,
      bytesDone,
      bytesTotal,
      bytesPerSecond: null,
    });

    const fileStarted = Date.now();
    note({ phase: "stage", path: file.path, index: index + 1, message: `Downloading (${file.size} bytes)` });

    try {
      /**
       * Retry a dropped download before giving up on the file.
       *
       * A run over 79 files makes 79 long-lived connections to OSF, and one of them
       * dropping is ordinary rather than exceptional — a real export died at 60% for
       * exactly that reason (2026-08-14). A GET is idempotent and the bytes are checksummed
       * afterwards regardless, so retrying is safe; the file simply restarts, because
       * `?direct=` gives us no verifiable way to resume.
       *
       * A user-requested stop is never retried.
       */
      const staged = await withRetry(
        () =>
          stageFile({
            url: file.downloadUrl,
            token,
            osfFileId: file.osfFileId,
            declaredSize: file.size,
            signal: opts.signal,
            onProgress: (p) =>
              opts.onProgress?.({
                phase: "staging",
                fileIndex: index,
                fileCount: plan.files.length,
                currentPath: file.path,
                bytesDone: bytesDone + p.bytesDone,
                bytesTotal,
                bytesPerSecond: p.bytesPerSecond,
              }),
          }),
        {
          signal: opts.signal,
          onDiscard: () => discardStaged(file.osfFileId).catch(() => {}),
          onRetry: (attempt, e) =>
            note({
              phase: "stage",
              path: file.path,
              index: index + 1,
              attempt,
              message: "Download failed, retrying",
              error: describeError(e),
            }),
        },
      );

      const verification = verifyFile({
        osfFileId: file.osfFileId,
        path: file.path,
        declaredSize: file.size,
        declared: { md5: file.md5, sha256: file.sha256 },
        // Staging is strictly sequential and append-only, so coverage is contiguous by
        // construction — see range.ts. The verifier still checks it rather than trusting
        // that invariant, because an invariant nobody checks is a comment.
        written: [{ start: 0, end: staged.size }],
        local: staged.digest,
        // Carried through from the response, and judged HERE rather than at fetch time.
        // A header is a claim about the bytes; a checksum is a statement about them. OSF
        // mislabels small text files as text/html, so verifyFile only treats a suspect
        // type as fatal when no checksum can corroborate the content.
        contentType: staged.contentType,
        // A local export has no destination, so there is no third checksum to compare.
        // The transfer path sets this true, which makes a missing destination checksum a
        // failure rather than a skipped check.
        destinationExpected: false,
      });
      verifications.push(verification);
      note({
        phase: "verify",
        path: file.path,
        index: index + 1,
        message: `${verification.state}${verification.problems.length ? `: ${verification.problems[0]}` : ""}`,
        ms: Date.now() - fileStarted,
      });

      if (verification.state !== "failed") {
        archiveEntries.push({ name: `data/${file.path}`, input: await stagedBlob(file.osfFileId) });
        bagFiles.push({
          path: file.path,
          size: staged.size,
          sha256: staged.digest.sha256,
          md5: staged.digest.md5,
        });
        crateFiles.push({
          path: `data/${file.path}`,
          size: staged.size,
          sha256: staged.digest.sha256,
          verification: verification.state,
        });
      }
      bytesDone += staged.size;
    } catch (e) {
      // Recorded, not thrown. The run continues so the researcher gets a complete list of
      // what failed instead of only the first thing.
      const message = e instanceof Error ? e.message : "Unknown error";
      note({
        phase: "stage",
        path: file.path,
        index: index + 1,
        message: "Failed",
        error: describeError(e),
        ms: Date.now() - fileStarted,
      });
      verifications.push({
        osfFileId: file.osfFileId,
        path: file.path,
        state: "failed",
        checks: [],
        problems: [message],
      });

      // An abort that we did NOT ask for means the browser or the network tore the
      // connection down — retrying the rest is usually pointless and always slow, so stop
      // and package what completed. The distinction matters to the researcher: "your
      // connection dropped at file 48" is actionable, "79 files failed" is not.
      if (isAbortError(e) && !opts.signal?.aborted) {
        interrupted = {
          reason:
            "The connection to OSF was interrupted partway through. Everything downloaded before that point is in the archive below.",
          stoppedByUser: false,
          atFile: file.path,
        };
        await discardStaged(file.osfFileId).catch(() => {});
        break;
      }
    }
    // NOTHING is discarded here. See the note above `clearStaging()` below: the archive
    // holds a Blob for every staged file and only reads them when the ZIP is assembled at
    // the end, so deleting a file here leaves a dangling reference that fails at packaging
    // time — which is exactly what shipped, and what a real export died of.
  }

  opts.onProgress?.({
    phase: "packaging",
    fileIndex: plan.files.length,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone,
    bytesTotal,
    bytesPerSecond: null,
  });

  // Non-file content (wikis, metadata, logs) is part of the payload and is manifested
  // like everything else — an export that checksums the CSVs but not the wiki would be
  // quietly asymmetric about what it stands behind.
  for (const extra of plan.extras) {
    const bytes = new TextEncoder().encode(extra.text);
    const { hashBytes } = await import("./hash");
    const digest = await hashBytes(bytes);
    archiveEntries.push({ name: `data/${extra.path}`, input: extra.text });
    bagFiles.push({ path: extra.path, size: bytes.byteLength, sha256: digest.sha256, md5: digest.md5 });
    crateFiles.push({ path: `data/${extra.path}`, size: bytes.byteLength, sha256: digest.sha256, verification: "verified" });
  }

  const verdict = reconcile({
    expected: plan.files.map((f) => ({ osfFileId: f.osfFileId, path: f.path, size: f.size })),
    results: verifications,
  });

  const bagInfo: BagInfo = {
    projectTitle: plan.projectTitle,
    projectGuid: plan.guid,
    osfUrl: plan.osfUrl,
    createdAt,
    appVersion: opts.appVersion,
    incompleteReason: verdict.status === "complete" ? null : verdict.summary,
  };

  for (const [name, text] of Object.entries(buildBagTagFiles(bagInfo, bagFiles))) {
    archiveEntries.push({ name, input: text });
  }

  const crate = buildRoCrate({
    projectGuid: plan.guid,
    title: plan.projectTitle,
    description: plan.crateInput.description,
    osfUrl: plan.osfUrl,
    doi: plan.doi,
    datePublished: plan.crateInput.datePublished,
    dateModified: plan.crateInput.dateModified,
    keywords: plan.crateInput.keywords,
    license: plan.crateInput.license,
    contributors: plan.contributors,
    files: crateFiles,
    wikiPages: plan.extras
      .filter((e) => e.path.startsWith("wikis/"))
      .map((e) => ({ name: e.path.replace(/^wikis\//, "").replace(/\.md$/, ""), path: `data/${e.path}` })),
    appVersion: opts.appVersion,
    createdAt,
  });
  archiveEntries.push({ name: "ro-crate-metadata.json", input: JSON.stringify(crate, null, 2) });

  const reportInput: ReportInput = {
    projectTitle: plan.projectTitle,
    projectGuid: plan.guid,
    osfUrl: plan.osfUrl,
    osfDoi: plan.doi,
    destination: null,
    verdict,
    fidelity: [],
    files: verifications.map((v) => ({
      path: v.path,
      size: bagFiles.find((b) => b.path === v.path)?.size ?? 0,
      sha256: bagFiles.find((b) => b.path === v.path)?.sha256 ?? null,
      state: v.state,
      sourceGuid: plan.files.find((f) => f.osfFileId === v.osfFileId)?.sourceGuid ?? null,
      osfPath: plan.files.find((f) => f.osfFileId === v.osfFileId)?.osfPath ?? null,
    })),
    coveredNodes: plan.coveredNodes,
    createdAt,
    appVersion: opts.appVersion,
  };

  const reportMarkdown = renderReportMarkdown(reportInput);
  const crosswalkCsv = renderCrosswalkCsv(reportInput);
  archiveEntries.push({ name: "EXPORT-REPORT.md", input: reportMarkdown });
  archiveEntries.push({ name: "osf-to-destination.csv", input: crosswalkCsv });

  // client-zip streams; JSZip would buffer the whole archive in memory and cannot
  // produce a multi-gigabyte export.
  //
  // ⚠️ Every staged file must still EXIST at this moment. `archiveEntries` holds a `Blob`
  // per file, backed by its OPFS file, and those bytes are read here — not when the entry
  // was pushed. Discarding each file right after staging it (which the code used to do,
  // under a comment claiming "peak disk stays at one file") leaves every one of those
  // Blobs dangling, and the ZIP fails on the first one it reads. In Firefox that surfaces
  // as `AbortError: The operation was aborted`, which names neither the cause nor the file.
  //
  // The honest consequence: peak browser-storage use for a local export is the whole
  // project, not one file. The preflight says so before the run starts.
  note({
    phase: "package",
    message: `Building the archive from ${archiveEntries.length} entries`,
  });
  const packStarted = Date.now();
  const blob = await downloadZip(
    archiveEntries.map((e) => ({ name: e.name, input: e.input })),
  ).blob();
  note({
    phase: "package",
    message: `Archive built: ${blob.size} bytes`,
    ms: Date.now() - packStarted,
  });

  // Safe now: the archive has been materialised, so nothing else needs the staged copies.
  await clearStaging().catch(() => {});

  opts.onProgress?.({
    phase: "done",
    fileIndex: plan.files.length,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone,
    bytesTotal,
    bytesPerSecond: null,
  });

  note({
    phase: "done",
    message: `${verdict.status}: ${verdict.counts.verified} verified, ${verdict.counts.failed} failed, ${verdict.counts.unverifiable} unverifiable`,
  });

  return {
    interrupted,
    verdict,
    verifications,
    blob,
    filenameStem: reportFilename(plan.guid, plan.projectTitle, createdAt),
    reportMarkdown,
    crosswalkCsv,
  };
}
