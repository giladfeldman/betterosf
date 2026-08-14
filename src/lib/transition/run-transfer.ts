/**
 * The transfer orchestrator — plan, stage, verify, upload, commit, reconcile.
 *
 * Runs in the browser. Bytes go OSF → this tab → Zenodo and never through Vercel: both
 * hosts were measured to allow the cross-origin requests this needs (Waterbutler permits
 * `Range` + `Authorization` and answers 206; Zenodo sends `Access-Control-Allow-Origin: *`
 * and permits `authorization` and `PUT`). That is the whole reason a multi-gigabyte
 * project can move on a free tier.
 *
 * The shape mirrors `run-export.ts` deliberately — one file at a time, staged, hashed,
 * verified, released — with three additions that only a transfer needs:
 *
 *   1. `destinationExpected: true`, so a commit that returned no parseable checksum is a
 *      FAILURE rather than a skipped check. This path is the only reason that flag exists.
 *   2. A resume that asks the DESTINATION what it holds instead of trusting our own notes.
 *   3. Sharding across linked records when the deposit exceeds Zenodo's per-record caps.
 *
 * Nothing here decides success. `reconcile()` does, from the collected results and the
 * destination's own listing, and it refuses to call an empty run complete. Nothing here
 * publishes: a draft is private, deletable, and mints no DOI until a human types a phrase
 * the server re-derives.
 */

import { downloadZip } from "client-zip";
import { stageFile, stagedBlob, discardStaged, requestPersistence, opfsAvailable } from "./stage-opfs";
import { verifyFile, reconcile, type FileVerification, type ReconciliationVerdict } from "./verify";
import { hashBytes } from "./hash";
import { renderReportMarkdown, renderCrosswalkCsv, reportFilename, type ReportInput } from "./report";
import { buildRoCrate, type CrateFile } from "./ro-crate";
import { renderDisclaimer } from "./package-bagit";
import { describeError, type ExportPlan, type RunLogEntry } from "./run-export";
import type { FidelityRow, ZenodoMetadata } from "./crosswalk";
import {
  createDraft,
  declareFiles,
  deleteDraftFile,
  commitFile,
  listDraftFileEntries,
  planShards,
  shardRelatedIdentifiers,
  updateDraftMetadata,
  uploadPart,
  uploadSingle,
  partsExpired,
  PART_SIZE_BYTES,
  ZENODO_MAX_BYTES_PER_RECORD,
  ZENODO_MAX_FILES_PER_RECORD,
  type DeclaredFile,
  type DraftFileEntry,
  type ShardLimits,
  type ZenodoAuth,
} from "./targets/zenodo";
import { zenodoDraftUrl, zenodoRecordUrl } from "./zenodo-env";

/**
 * One slot per record is held back for the supplement (report + crosswalk + RO-Crate),
 * which is deposited on EVERY record so a reader who lands on part 3 of 5 can still find
 * out what the deposit is and where the rest of it lives.
 */
export const FILES_PER_RECORD = ZENODO_MAX_FILES_PER_RECORD - 1;

export const SUPPLEMENT_KEY = "betterosf-supplement.zip";

export type TransferProgress = {
  phase: "preparing" | "transferring" | "finishing" | "done";
  fileIndex: number;
  fileCount: number;
  currentPath: string;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond: number | null;
  /** 1-based, for the "record 2 of 5" line. */
  shardIndex: number;
  shardCount: number;
};

/** What a resumed run needs to know, and all it needs to know. */
export type TransferJobSnapshot = {
  jobId: string;
  guid: string;
  /** Where the copy went. A local export is a run too, and counts as one. */
  destination: "local" | "zenodo";
  /**
   * Which Zenodo instance — or `"none"` for a local export, which has none.
   *
   * Writing "sandbox" here for a download would be a false statement about where
   * somebody's data went, and the publish route reads this field to refuse a
   * cross-environment publish. "none" is the honest value and it fails that
   * check closed, which is the correct outcome: a local export cannot be published.
   */
  env: ZenodoAuth["env"] | "none";
  status: "running" | "complete" | "incomplete" | "abandoned";
  /**
   * Record id per shard, in shard order. File paths are deliberately NOT stored: shard
   * assignment is recomputed by `planShards`, which is deterministic over the same file
   * list, so keeping the paths here would be a second copy of the truth that can drift.
   */
  records: { recordId: string; fileCount: number }[];
  fileCount: number;
  bytesTotal: number;
  updatedAt: string;
};

/**
 * A per-file result durable enough to resume from.
 *
 * `localMd5` and `remoteMd5` are both stored because the fast-resume path re-checks them
 * against what Zenodo reports NOW. A stored "it was verified" that is never re-tested
 * would be a memory presented as a measurement.
 */
export type TransferItemSnapshot = {
  osfFileId: string;
  path: string;
  size: number;
  state: FileVerification["state"];
  localSha256: string | null;
  localMd5: string | null;
  remoteMd5: string | null;
  shardIndex: number;
  problems: string[];
};

export type TransferLedger = {
  saveJob(job: TransferJobSnapshot): Promise<void>;
  saveItems(jobId: string, items: TransferItemSnapshot[]): Promise<void>;
  loadItems(jobId: string): Promise<TransferItemSnapshot[]>;
};

export type RunTransferOptions = {
  jobId: string;
  plan: ExportPlan;
  /** OSF access token — read scope is enough, and read is all a transfer ever does. */
  osfToken: string;
  zenodo: ZenodoAuth;
  /** Metadata from the crosswalk. Shard titles are derived from this one. */
  metadata: ZenodoMetadata;
  fidelity: FidelityRow[];
  appVersion: string;
  now: () => Date;
  signal?: AbortSignal;
  ledger?: TransferLedger;
  /**
   * Record ids created by an earlier attempt at this job, in shard order.
   *
   * Reused rather than recreated so a resumed run adds to the same drafts instead of
   * leaving orphans behind — an abandoned half-full draft in someone's Zenodo account is
   * litter they have to identify and delete themselves.
   */
  resumeRecordIds?: (string | null)[] | null;
  /**
   * Per-record caps. Defaults to Zenodo's real ones.
   *
   * Injectable because the caps belong to the destination, not to the runner — and
   * because the only other way to exercise the split path is a 100-file fixture, which
   * would make the test slow enough that nobody runs it.
   */
  shardLimits?: ShardLimits;
  onProgress?: (p: TransferProgress) => void;
  /**
   * Appended to as the run proceeds, and owned by the CALLER so it survives a throw.
   *
   * A transfer touches two services and a dozen distinct calls; "NetworkError when
   * attempting to fetch resource" identifies none of them. This is what turns that into
   * "zenodo:createDraft failed".
   */
  log?: RunLogEntry[];
};

export type TransferResult = {
  verdict: ReconciliationVerdict;
  verifications: FileVerification[];
  records: { recordId: string; draftUrl: string; futureRecordUrl: string; fileCount: number }[];
  reportMarkdown: string;
  crosswalkCsv: string;
  filenameStem: string;
  /** Whether the report/crosswalk bundle reached every record, and what went wrong if not. */
  supplement: { deposited: number; expected: number; problems: string[] };
};

/** Checkpoint cadence: coarse on purpose, to stay inside the "no meaningful usage" rule. */
const CHECKPOINT_EVERY_ITEMS = 25;
const CHECKPOINT_EVERY_MS = 30_000;

export async function runTransfer(opts: RunTransferOptions): Promise<TransferResult> {
  const { plan, now, zenodo } = opts;
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
  /** Run a labelled step, recording success or failure — and re-throwing either way. */
  const step = async <T,>(phase: string, message: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    note({ phase, message });
    try {
      const value = await fn();
      note({ phase, message: `${message} — ok`, ms: Date.now() - started });
      return value;
    } catch (e) {
      note({ phase, message: `${message} — FAILED`, error: describeError(e), ms: Date.now() - started });
      throw e;
    }
  };

  note({
    phase: "plan",
    message: `Starting: ${plan.files.length} files to Zenodo (${zenodo.env}), project ${plan.guid}`,
  });

  const verifications: FileVerification[] = [];
  /**
   * Every per-file snapshot this run produced, kept for the whole run. The checkpoint
   * queue below is drained as it flushes, so reading hashes back out of it would leave
   * the report's SHA-256 column empty for exactly the files that transferred fine.
   */
  const snapshots: TransferItemSnapshot[] = [];
  /** Shard-linking failures, folded into the report's fidelity table. Per run, never module state. */
  const linkProblems: string[] = [];
  const bytesTotal = plan.files.reduce((n, f) => n + (Number.isFinite(f.size) ? f.size : 0), 0);
  let bytesDone = 0;

  // ---------------------------------------------------------------- plan the records
  const planned = planShards(
    plan.files,
    opts.shardLimits ?? { maxFiles: FILES_PER_RECORD, maxBytes: ZENODO_MAX_BYTES_PER_RECORD },
  );

  // A file that fits in no record is recorded as failed, never dropped. reconcile() then
  // refuses to call the run complete, which is the correct outcome: part of the project
  // did not go.
  for (const { file, reason } of planned.unplaceable) {
    verifications.push({
      osfFileId: file.osfFileId,
      path: file.path,
      state: "failed",
      checks: [],
      problems: [reason],
    });
  }

  const shardPaths = planned.shards;
  const shardCount = shardPaths.length;

  opts.onProgress?.({
    phase: "preparing",
    fileIndex: 0,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone: 0,
    bytesTotal,
    bytesPerSecond: null,
    shardIndex: 1,
    shardCount: Math.max(1, shardCount),
  });

  // ---------------------------------------------------------------- drafts (or resume)
  const records: { recordId: string; paths: string[] }[] = [];
  const resumed = opts.resumeRecordIds ?? null;

  for (const [index, files] of shardPaths.entries()) {
    opts.signal?.throwIfAborted();
    const priorId = resumed?.[index];
    if (priorId) {
      records.push({ recordId: priorId, paths: files.map((f) => f.path) });
      continue;
    }
    const draft = await step("zenodo", `createDraft (record ${index + 1} of ${shardCount})`, () =>
      createDraft(zenodo, shardMetadata(opts.metadata, index, shardCount)),
    );
    records.push({ recordId: draft.id, paths: files.map((f) => f.path) });
  }

  const saveJob = async (status: TransferJobSnapshot["status"]) => {
    if (!opts.ledger) return;
    await opts.ledger
      .saveJob({
        jobId: opts.jobId,
        guid: plan.guid,
        destination: "zenodo",
        env: zenodo.env,
        status,
        records: records.map((r) => ({ recordId: r.recordId, fileCount: r.paths.length })),
        fileCount: plan.files.length,
        bytesTotal,
        updatedAt: now().toISOString(),
      })
      // A checkpoint is a convenience for resuming, never a precondition for transferring.
      // Losing one must not abort a run that is otherwise working.
      .catch(() => {});
  };
  await saveJob("running");

  // Sibling links, once every record id is known. Only meaningful for a split deposit.
  if (shardCount > 1) {
    const urls = records.map((r) => zenodoRecordUrl(zenodo.env, r.recordId));
    for (const [index, record] of records.entries()) {
      try {
        await updateDraftMetadata(zenodo, record.recordId, {
          ...shardMetadata(opts.metadata, index, shardCount),
          related_identifiers: [
            ...(opts.metadata.related_identifiers ?? []),
            ...shardRelatedIdentifiers(urls, index),
          ],
        });
      } catch (e) {
        // The links are metadata, not data. Losing them must not stop the bytes moving —
        // but the researcher has to be told, because unlinked shards look like unrelated
        // deposits.
        linkProblems.push(
          `Could not link record ${record.recordId} to its siblings: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ------------------------------------------------------------------- transfer files
  const priorItems = new Map<string, TransferItemSnapshot>();
  if (opts.ledger) {
    for (const item of await opts.ledger.loadItems(opts.jobId).catch(() => [])) {
      priorItems.set(item.osfFileId, item);
    }
  }

  const pendingItems: TransferItemSnapshot[] = [];
  let lastCheckpoint = Date.now();
  const flush = async (force: boolean) => {
    if (!opts.ledger || pendingItems.length === 0) return;
    const due =
      force ||
      pendingItems.length >= CHECKPOINT_EVERY_ITEMS ||
      Date.now() - lastCheckpoint >= CHECKPOINT_EVERY_MS;
    if (!due) return;
    const batch = pendingItems.splice(0, pendingItems.length);
    lastCheckpoint = Date.now();
    await opts.ledger.saveItems(opts.jobId, batch).catch(() => {});
  };

  let globalIndex = 0;
  for (const [shardIndex, files] of shardPaths.entries()) {
    const record = records[shardIndex]!;

    // What the destination believes it holds. Asked once per record, not per file — 100
    // extra requests per record would push against Zenodo's ~100/minute budget for no
    // additional truth.
    let entries: Map<string, DraftFileEntry>;
    try {
      entries = new Map(
        (
          await step("zenodo", `listDraftFiles (record ${record.recordId})`, () =>
            listDraftFileEntries(zenodo, record.recordId),
          )
        ).map((e) => [e.key, e]),
      );
    } catch {
      // Unknown is not the same as empty. Treat every file as needing work rather than
      // assuming a clean record — the opposite mistake would skip real uploads.
      entries = new Map();
    }

    for (const file of files) {
      opts.signal?.throwIfAborted();
      opts.onProgress?.({
        phase: "transferring",
        fileIndex: globalIndex,
        fileCount: plan.files.length,
        currentPath: file.path,
        bytesDone,
        bytesTotal,
        bytesPerSecond: null,
        shardIndex: shardIndex + 1,
        shardCount,
      });

      note({
        phase: "transfer",
        path: file.path,
        index: globalIndex + 1,
        message: `Downloading from OSF and uploading to Zenodo (${file.size} bytes)`,
      });
      const fileStarted = Date.now();

      const outcome = await transferOneFile({
        file,
        record,
        entry: entries.get(file.path) ?? null,
        prior: priorItems.get(file.osfFileId) ?? null,
        shardIndex,
        opts,
        onBytes: (n, rate) =>
          opts.onProgress?.({
            phase: "transferring",
            fileIndex: globalIndex,
            fileCount: plan.files.length,
            currentPath: file.path,
            bytesDone: bytesDone + n,
            bytesTotal,
            bytesPerSecond: rate,
            shardIndex: shardIndex + 1,
            shardCount,
          }),
      });

      note({
        phase: "transfer",
        path: file.path,
        index: globalIndex + 1,
        message: outcome.verification.state,
        error: outcome.verification.problems[0],
        ms: Date.now() - fileStarted,
      });
      verifications.push(outcome.verification);
      snapshots.push(outcome.snapshot);
      pendingItems.push(outcome.snapshot);
      bytesDone += Number.isFinite(file.size) ? file.size : 0;
      globalIndex += 1;
      await flush(false);
    }
  }
  await flush(true);

  // ------------------------------------------------------------------- reconciliation
  opts.onProgress?.({
    phase: "finishing",
    fileIndex: plan.files.length,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone,
    bytesTotal,
    bytesPerSecond: null,
    shardIndex: Math.max(1, shardCount),
    shardCount: Math.max(1, shardCount),
  });

  // The destination's own account of what landed, asked for AFTER everything was sent.
  // A listing that cannot be fetched is `null`, never `[]` — an empty list would read as
  // "nothing arrived" and turn a working run into a false failure, while a null tells
  // reconcile() it has no third opinion to offer.
  let destinationKeys: string[] | null = [];
  const blockers: string[] = [...linkProblems];
  for (const record of records) {
    try {
      const listed = await listDraftFileEntries(zenodo, record.recordId);
      if (destinationKeys) {
        destinationKeys.push(...listed.filter((e) => e.status === "completed").map((e) => e.key));
      }
    } catch (e) {
      destinationKeys = null;
      // A listing we could not read is "no third opinion", not "confirmed". Left as only
      // a null, every other condition still passed and the run reported COMPLETE — a
      // failed sub-check rendering as a clean result. The blocker is what stops that.
      // (Codex consult 2026-08-13; reproduced before fixing.)
      blockers.push(
        `Could not read what Zenodo actually holds for record ${record.recordId} ` +
          `(${e instanceof Error ? e.message : String(e)}), so there is no independent confirmation ` +
          `the files landed. Open the draft and check it yourself, or run the transfer again.`,
      );
      break;
    }
  }

  const verdict = reconcile({
    expected: plan.files.map((f) => ({ osfFileId: f.osfFileId, path: f.path, size: f.size })),
    results: verifications,
    destinationKeys,
    blockers,
  });

  // Keyed by OSF's immutable file id, never by path. Two source files CAN share a
  // destination key — that is the collision `reconcile` detects — and a path-keyed lookup
  // silently hands one file the other's size and SHA-256 in the crosswalk CSV, which is the
  // artefact a researcher uses to repair links in papers. (Sonnet consult 2026-08-13.)
  const byId = new Map(plan.files.map((f) => [f.osfFileId, f] as const));
  // This run's snapshots win over a resumed run's for the same file: a fast-resumed file
  // reuses its prior snapshot anyway, so the two agree, and anything re-transferred should
  // report what was measured this time.
  const localHashes = new Map<string, TransferItemSnapshot>();
  for (const s of [...priorItems.values(), ...snapshots]) localHashes.set(s.osfFileId, s);

  /**
   * Keys more than one source file mapped to. A file the other one overwrote passed its
   * OWN checks — its FileVerification honestly reads `verified` — so every artefact built
   * from those results has to be told, or it repeats a true statement about a check as a
   * false statement about the data.
   */
  const collided = new Set(verdict.collisions);
  const isCollided = (path: string) => collided.has(path.normalize("NFC"));

  const reportInput: ReportInput = {
    projectTitle: plan.projectTitle,
    projectGuid: plan.guid,
    osfUrl: plan.osfUrl,
    osfDoi: plan.doi,
    destination: {
      name: `Zenodo (${zenodo.env})`,
      recordUrl: records.length > 0 ? zenodoDraftUrl(zenodo.env, records[0]!.recordId) : null,
      // A draft has no DOI until it is published, and inventing one would be the exact
      // false-fact this toolkit exists to avoid.
      doi: null,
    },
    verdict,
    fidelity: [
      ...opts.fidelity,
      ...(shardCount > 1
        ? [
            {
              field: "records",
              source: "Zenodo per-record limits",
              status: "approximated" as const,
              note:
                `This deposit exceeds Zenodo's ${ZENODO_MAX_FILES_PER_RECORD}-file / ` +
                `${Math.round(ZENODO_MAX_BYTES_PER_RECORD / 1024 ** 3)} GB per-record limit, so it was split ` +
                `across ${shardCount} linked records (DataCite IsPartOf). Publishing them mints ${shardCount} DOIs.`,
            },
          ]
        : []),
      ...linkProblems.map((note) => ({
        field: "related_identifiers",
        source: "shard linking",
        status: "dropped" as const,
        note,
      })),
    ],
    files: verifications.map((v) => ({
      path: v.path,
      size: byId.get(v.osfFileId)?.size ?? 0,
      sha256: localHashes.get(v.osfFileId)?.localSha256 ?? null,
      // `overwritten` rather than `verified`: the checks on this file passed, and then
      // another file took its destination key. Naming that state is the point — a row
      // reading "verified" would tell a researcher a file is safe when its bytes are gone.
      state: isCollided(v.path) ? "overwritten" : v.state,
      destinationKey: v.state === "failed" || isCollided(v.path) ? null : v.path,
    })),
    createdAt,
    appVersion: opts.appVersion,
  };

  const reportMarkdown = renderReportMarkdown(reportInput);
  const crosswalkCsv = renderCrosswalkCsv(reportInput);

  // ---------------------------------------------------------------------- supplement
  const supplement = await depositSupplement({
    opts,
    records,
    reportMarkdown,
    crosswalkCsv,
    crateFiles: verifications
      .filter((v) => v.state !== "failed" && !isCollided(v.path))
      .map<CrateFile>((v) => ({
        path: v.path,
        size: byId.get(v.osfFileId)?.size ?? 0,
        sha256: localHashes.get(v.osfFileId)?.localSha256 ?? null,
        verification: v.state,
      })),
    createdAt,
    incompleteReason: verdict.status === "complete" ? null : verdict.summary,
  });

  note({
    phase: "done",
    message: `${verdict.status}: ${verdict.counts.verified} verified, ${verdict.counts.failed} failed, ${records.length} record(s)`,
  });
  await saveJob(verdict.status === "complete" ? "complete" : "incomplete");

  opts.onProgress?.({
    phase: "done",
    fileIndex: plan.files.length,
    fileCount: plan.files.length,
    currentPath: "",
    bytesDone,
    bytesTotal,
    bytesPerSecond: null,
    shardIndex: Math.max(1, shardCount),
    shardCount: Math.max(1, shardCount),
  });

  return {
    verdict,
    verifications,
    records: records.map((r) => ({
      recordId: r.recordId,
      draftUrl: zenodoDraftUrl(zenodo.env, r.recordId),
      futureRecordUrl: zenodoRecordUrl(zenodo.env, r.recordId),
      fileCount: r.paths.length,
    })),
    reportMarkdown,
    crosswalkCsv,
    filenameStem: reportFilename(plan.guid, plan.projectTitle, createdAt),
    supplement,
  };
}

/**
 * Per-shard title.
 *
 * The part number goes in the TITLE rather than only in the metadata, because a reader who
 * finds record 3 of 5 through a search engine sees the title and nothing else.
 */
export function shardMetadata(base: ZenodoMetadata, index: number, count: number): ZenodoMetadata {
  if (count <= 1) return base;
  return { ...base, title: `${base.title} (part ${index + 1} of ${count})` };
}

type TransferOneInput = {
  file: ExportPlan["files"][number];
  record: { recordId: string; paths: string[] };
  entry: DraftFileEntry | null;
  prior: TransferItemSnapshot | null;
  shardIndex: number;
  opts: RunTransferOptions;
  onBytes: (bytesDone: number, rate: number | null) => void;
};

/**
 * Stage, verify, upload, commit, verify again — one file.
 *
 * The source check runs BEFORE the upload and can veto it. Pushing bytes we already know
 * do not match OSF's checksum into an archive intended to outlive OSF would be the worst
 * possible outcome: a permanent, citable copy of the wrong thing.
 */
async function transferOneFile(
  input: TransferOneInput,
): Promise<{ verification: FileVerification; snapshot: TransferItemSnapshot }> {
  const { file, record, entry, prior, opts } = input;
  const zenodo = opts.zenodo;

  const fail = (problem: string): { verification: FileVerification; snapshot: TransferItemSnapshot } => ({
    verification: {
      osfFileId: file.osfFileId,
      path: file.path,
      state: "failed",
      checks: [],
      problems: [problem],
    },
    snapshot: {
      osfFileId: file.osfFileId,
      path: file.path,
      size: file.size,
      state: "failed",
      localSha256: null,
      localMd5: null,
      remoteMd5: null,
      shardIndex: input.shardIndex,
      problems: [problem],
    },
  });

  // Fast resume: a file we previously verified, which the destination still reports as
  // completed with the SAME checksum we recorded, AND which OSF still describes the same
  // way it did then.
  //
  // All three are required. The stored verification alone is a memory; the destination
  // listing alone cannot say whether the bytes ever matched OSF; and without the third,
  // a file EDITED on OSF between attempts — same id, same path, same length, different
  // bytes — satisfied every other condition and was skipped, leaving the old copy in the
  // deposit and reporting it as verified. (Codex consult 2026-08-13; reproduced first.)
  if (
    prior &&
    prior.state !== "failed" &&
    prior.remoteMd5 &&
    entry?.status === "completed" &&
    entry.md5 === prior.remoteMd5 &&
    entry.size === file.size &&
    osfStillDescribesItTheSameWay(file, prior)
  ) {
    return {
      verification: {
        osfFileId: file.osfFileId,
        path: file.path,
        state: prior.state,
        checks: [
          {
            name: "resumed",
            passed: true,
            detail: `Transferred and verified in an earlier attempt; Zenodo still reports the same checksum (${prior.remoteMd5}).`,
          },
        ],
        problems: prior.problems,
      },
      snapshot: { ...prior, shardIndex: input.shardIndex },
    };
  }

  let staged;
  try {
    staged = await stageFile({
      url: file.downloadUrl,
      token: opts.osfToken,
      osfFileId: file.osfFileId,
      declaredSize: file.size,
      signal: opts.signal,
      onProgress: (p) => input.onBytes(p.bytesDone, p.bytesPerSecond),
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    await discardStaged(file.osfFileId).catch(() => {});
    return fail(e instanceof Error ? e.message : "Could not download this file from OSF.");
  }

  try {
    // The source-side verification, run before anything is sent anywhere.
    const pre = verifyFile({
      osfFileId: file.osfFileId,
      path: file.path,
      declaredSize: file.size,
      declared: { md5: file.md5, sha256: file.sha256 },
      written: [{ start: 0, end: staged.size }],
      local: staged.digest,
      contentType: staged.contentType,
      destinationExpected: false,
    });
    if (pre.state === "failed") {
      return {
        verification: pre,
        snapshot: {
          osfFileId: file.osfFileId,
          path: file.path,
          size: file.size,
          state: "failed",
          localSha256: staged.digest.sha256,
          localMd5: staged.digest.md5,
          remoteMd5: null,
          shardIndex: input.shardIndex,
          problems: [
            ...pre.problems,
            "Not uploaded: what was downloaded does not match what OSF says it holds.",
          ],
        },
      };
    }

    let remoteMd5: string | null = null;

    // Already on the destination and byte-identical to what we just hashed? Then the
    // upload is redundant, and we still hold the evidence for all three comparisons.
    if (entry?.status === "completed" && entry.md5 && entry.md5 === staged.digest.md5) {
      remoteMd5 = entry.md5;
    } else {
      if (entry) {
        // A stale or partial entry. Zenodo will not let a committed key be re-uploaded in
        // place, so remove it first rather than committing over something unknown.
        try {
          await deleteDraftFile(zenodo, record.recordId, file.path);
        } catch {
          /* the declare below will surface anything that actually blocks us */
        }
      }

      const blob = await stagedBlob(file.osfFileId);
      let declared: DeclaredFile;
      try {
        const list = await declareFiles(zenodo, record.recordId, [
          { key: file.path, size: file.size },
        ]);
        const found = list.find((d) => d.key === file.path);
        if (!found) throw new Error("Zenodo did not return an entry for this file.");
        declared = found;
      } catch (e) {
        if (isAbort(e)) throw e;
        return fail(`Zenodo would not accept this file: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        await uploadBytes({ auth: zenodo, recordId: record.recordId, declared, blob, opts, onBytes: input.onBytes });
        const commit = await commitFile(zenodo, record.recordId, file.path);
        remoteMd5 = commit.md5;
        if (commit.status && commit.status !== "completed") {
          return fail(`Zenodo left this file in state "${commit.status}" rather than completing it.`);
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        return fail(e instanceof Error ? e.message : "The upload to Zenodo failed.");
      }
    }

    // The full verification, with the destination's own checksum. `destinationExpected`
    // makes a missing one a failure — on this path it is the entire point.
    const verification = verifyFile({
      osfFileId: file.osfFileId,
      path: file.path,
      declaredSize: file.size,
      declared: { md5: file.md5, sha256: file.sha256 },
      written: [{ start: 0, end: staged.size }],
      local: staged.digest,
      remoteMd5,
      contentType: staged.contentType,
      destinationExpected: true,
    });

    return {
      verification,
      snapshot: {
        osfFileId: file.osfFileId,
        path: file.path,
        size: file.size,
        state: verification.state,
        localSha256: staged.digest.sha256,
        localMd5: staged.digest.md5,
        remoteMd5,
        shardIndex: input.shardIndex,
        problems: verification.problems,
      },
    };
  } finally {
    // Release staging immediately: peak disk stays at one file, not the project.
    await discardStaged(file.osfFileId).catch(() => {});
  }
}

type UploadInput = {
  auth: ZenodoAuth;
  recordId: string;
  declared: DeclaredFile;
  blob: Blob;
  opts: RunTransferOptions;
  onBytes: (bytesDone: number, rate: number | null) => void;
};

/**
 * Send the bytes — one PUT, or one PUT per part above the multipart threshold.
 *
 * Multipart matters for exactly one reason: a dropped connection at 4.9 GB costs one part
 * instead of the whole file. Zenodo issues part URLs that **expire after 14 days**, so a
 * run paused over a holiday must re-declare rather than PUT to a dead URL — `partsExpired`
 * is the defined state for that, not a surprise 403.
 */
export async function uploadBytes(input: UploadInput): Promise<void> {
  const { auth, recordId, declared, blob, opts } = input;

  if (declared.transferType !== "M" || !declared.parts || declared.parts.length === 0) {
    await uploadSingle(auth, recordId, declared.key, blob);
    input.onBytes(blob.size, null);
    return;
  }

  if (partsExpired(declared, opts.now())) {
    throw new Error(
      "Zenodo's upload links for this file have expired (they last 14 days). Start the transfer again — it will pick up where it left off.",
    );
  }

  const started = Date.now();
  let sent = 0;
  // Sequential on purpose. Parallel parts would be faster and would multiply both peak
  // memory and the number of ways a half-uploaded file can be left behind.
  for (const part of [...declared.parts].sort((a, b) => a.part - b.part)) {
    opts.signal?.throwIfAborted();
    const from = (part.part - 1) * PART_SIZE_BYTES;
    const slice = blob.slice(from, Math.min(from + PART_SIZE_BYTES, blob.size));
    await uploadPart(auth, part.url, slice);
    sent += slice.size;
    const elapsed = (Date.now() - started) / 1000;
    input.onBytes(sent, elapsed > 1 ? sent / elapsed : null);
  }
}

type SupplementInput = {
  opts: RunTransferOptions;
  records: { recordId: string; paths: string[] }[];
  reportMarkdown: string;
  crosswalkCsv: string;
  crateFiles: CrateFile[];
  createdAt: string;
  /** The verdict's summary when the run was not complete — carried INTO the disclaimer. */
  incompleteReason: string | null;
};

/**
 * Deposit the report, the crosswalk CSV, the RO-Crate description and the disclaimer as
 * one archive on EVERY record.
 *
 * It goes on every record because a split deposit's parts are found independently, and a
 * record that cannot say what it is part of, how it was made, or that it is not a warranty
 * is a worse artefact than one that can.
 *
 * Its own success is reported separately and never folded into the data verdict: the
 * research files either arrived or did not, and a failed supplement upload must not be
 * able to turn a complete transfer into an incomplete one — nor be hidden.
 */
async function depositSupplement(
  input: SupplementInput,
): Promise<TransferResult["supplement"]> {
  const { opts, records } = input;
  const problems: string[] = [];
  if (records.length === 0) return { deposited: 0, expected: 0, problems };

  const crate = buildRoCrate({
    projectGuid: opts.plan.guid,
    title: opts.plan.projectTitle,
    description: opts.plan.crateInput.description,
    osfUrl: opts.plan.osfUrl,
    doi: opts.plan.doi,
    datePublished: opts.plan.crateInput.datePublished,
    dateModified: opts.plan.crateInput.dateModified,
    keywords: opts.plan.crateInput.keywords,
    license: opts.plan.crateInput.license,
    contributors: opts.plan.contributors,
    files: input.crateFiles,
    wikiPages: opts.plan.extras
      .filter((e) => e.path.startsWith("wikis/"))
      .map((e) => ({ name: e.path.replace(/^wikis\//, "").replace(/\.md$/, ""), path: e.path })),
    appVersion: opts.appVersion,
    createdAt: input.createdAt,
  });

  const entries: { name: string; input: string }[] = [
    { name: "EXPORT-REPORT.md", input: input.reportMarkdown },
    { name: "osf-to-destination.csv", input: input.crosswalkCsv },
    { name: "ro-crate-metadata.json", input: JSON.stringify(crate, null, 2) },
    {
      name: "DISCLAIMER.txt",
      input: renderDisclaimer({
        projectTitle: opts.plan.projectTitle,
        projectGuid: opts.plan.guid,
        osfUrl: opts.plan.osfUrl,
        createdAt: input.createdAt,
        appVersion: opts.appVersion,
        incompleteReason: input.incompleteReason,
      }),
    },
    // The wikis and project metadata OSF offers no export for travel with the deposit
    // rather than only with the local archive.
    ...opts.plan.extras.map((e) => ({ name: e.path, input: e.text })),
  ];

  const blob = await downloadZip(entries).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await hashBytes(bytes);

  let deposited = 0;
  for (const record of records) {
    try {
      // Replace any supplement from an earlier attempt; a stale report describing a
      // different run is worse than none.
      await deleteDraftFile(opts.zenodo, record.recordId, SUPPLEMENT_KEY).catch(() => {});
      const declared = await declareFiles(opts.zenodo, record.recordId, [
        { key: SUPPLEMENT_KEY, size: blob.size },
      ]);
      const found = declared.find((d) => d.key === SUPPLEMENT_KEY);
      if (!found) throw new Error("Zenodo did not return an entry for the supplement.");
      await uploadBytes({
        auth: opts.zenodo,
        recordId: record.recordId,
        declared: found,
        blob,
        opts,
        onBytes: () => {},
      });
      const commit = await commitFile(opts.zenodo, record.recordId, SUPPLEMENT_KEY);
      if (commit.md5 !== digest.md5) {
        problems.push(
          `The report bundle on record ${record.recordId} does not match what was sent (Zenodo reported ${commit.md5 ?? "no checksum"}).`,
        );
        continue;
      }
      deposited += 1;
    } catch (e) {
      problems.push(
        `Could not deposit the report bundle on record ${record.recordId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { deposited, expected: records.length, problems };
}

/**
 * Do OSF's checksums for this file still match the ones we hashed last time?
 *
 * Returns FALSE when OSF publishes no checksum at all. That is the deliberate answer, not
 * an oversight: with nothing to compare, there is no way to tell a file that has not
 * changed from one that has, so the run re-downloads and re-checks it against what the
 * destination stored. Slower, and the only honest option — add-on storage files are the
 * population that already cannot be verified.
 */
export function osfStillDescribesItTheSameWay(
  file: { md5: string | null; sha256: string | null },
  prior: { localMd5: string | null; localSha256: string | null },
): boolean {
  const same = (a: string | null, b: string | null) =>
    Boolean(a && b && a.toLowerCase() === b.toLowerCase());

  const checks: boolean[] = [];
  if (file.sha256) checks.push(same(file.sha256, prior.localSha256));
  if (file.md5) checks.push(same(file.md5, prior.localMd5));

  return checks.length > 0 && checks.every(Boolean);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
