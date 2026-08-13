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
import { stageFile, stagedBlob, discardStaged, requestPersistence, opfsAvailable } from "./stage-opfs";
import { verifyFile, reconcile, type FileVerification, type ReconciliationVerdict } from "./verify";
import { buildBagTagFiles, type BagFile, type BagInfo } from "./package-bagit";
import { buildRoCrate, type CrateFile } from "./ro-crate";
import { renderReportMarkdown, renderCrosswalkCsv, reportFilename, type ReportInput } from "./report";
import type { ContributorView } from "@/lib/osf/contributors";

export type PlannedExportFile = {
  osfFileId: string;
  /** Path inside the bag's data/ directory, e.g. "osfstorage/sub/a.csv". */
  path: string;
  size: number;
  downloadUrl: string;
  md5: string | null;
  sha256: string | null;
  provider: string;
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
  verdict: ReconciliationVerdict;
  verifications: FileVerification[];
  blob: Blob;
  filenameStem: string;
  reportMarkdown: string;
  crosswalkCsv: string;
};

export type RunExportOptions = {
  plan: ExportPlan;
  token: string;
  appVersion: string;
  /** Injected so the run is deterministic in tests. */
  now: () => Date;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
};

/**
 * Stage and verify every planned file, then package the lot.
 *
 * A file that fails is recorded and the run CONTINUES: stopping at the first failure
 * would leave a researcher with nothing and no list of what went wrong. The verdict at
 * the end is what refuses to call it a success.
 */
export async function runExport(opts: RunExportOptions): Promise<ExportResult> {
  const { plan, token, now } = opts;
  if (!opfsAvailable()) {
    throw new Error(
      "This browser cannot stage large files locally. Try a recent Chrome, Edge or Firefox.",
    );
  }
  await requestPersistence();

  const createdAt = now().toISOString();
  const verifications: FileVerification[] = [];
  const bagFiles: BagFile[] = [];
  const crateFiles: CrateFile[] = [];
  const archiveEntries: { name: string; input: Blob | string }[] = [];

  const bytesTotal = plan.files.reduce((n, f) => n + f.size, 0);
  let bytesDone = 0;

  for (const [index, file] of plan.files.entries()) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.({
      phase: "staging",
      fileIndex: index,
      fileCount: plan.files.length,
      currentPath: file.path,
      bytesDone,
      bytesTotal,
      bytesPerSecond: null,
    });

    try {
      const staged = await stageFile({
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
      });

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
        // Not recorded here on purpose: the response Content-Type is validated at fetch
        // time by checkRangeResponse in stage-opfs.ts, which refuses an HTML/JSON body
        // BEFORE a byte is written. Re-asserting it here would require carrying the
        // header through staging for no additional guarantee.
        contentType: null,
        // A local export has no destination, so there is no third checksum to compare.
        // The transfer path sets this true, which makes a missing destination checksum a
        // failure rather than a skipped check.
        destinationExpected: false,
      });
      verifications.push(verification);

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
      verifications.push({
        osfFileId: file.osfFileId,
        path: file.path,
        state: "failed",
        checks: [],
        problems: [e instanceof Error ? e.message : "Unknown error"],
      });
    } finally {
      // Release staging immediately: peak disk stays at one file, not the project.
      await discardStaged(file.osfFileId).catch(() => {});
    }
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
    })),
    createdAt,
    appVersion: opts.appVersion,
  };

  const reportMarkdown = renderReportMarkdown(reportInput);
  const crosswalkCsv = renderCrosswalkCsv(reportInput);
  archiveEntries.push({ name: "EXPORT-REPORT.md", input: reportMarkdown });
  archiveEntries.push({ name: "osf-to-destination.csv", input: crosswalkCsv });

  // client-zip streams; JSZip would buffer the whole archive in memory and cannot
  // produce a multi-gigabyte export.
  const blob = await downloadZip(
    archiveEntries.map((e) => ({ name: e.name, input: e.input })),
  ).blob();

  opts.onProgress?.({
    phase: "done",
    fileIndex: plan.files.length,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone,
    bytesTotal,
    bytesPerSecond: null,
  });

  return {
    verdict,
    verifications,
    blob,
    filenameStem: reportFilename(plan.guid, plan.projectTitle, createdAt),
    reportMarkdown,
    crosswalkCsv,
  };
}
