import type { TransferJobSnapshot } from "./run-transfer";

/**
 * What the browser's saved transfer progress says about resuming (d-3812c6).
 *
 * Three states, never two: a failed read of the local ledger is `unreadable`, not `none`.
 * Reading it as "nothing to resume" offered a fresh start to someone with an unfinished
 * transfer, which leaves the half-filled Zenodo drafts behind (class: unknown is not zero,
 * the same rule `ledger.ts` `loadItems` follows by rejecting).
 */
export type ResumeCheck =
  | { kind: "none" }
  | { kind: "found"; jobId: string; records: { recordId: string }[] }
  | { kind: "unreadable"; message: string };

const UNREADABLE =
  "BetterOSF could not read the saved progress in this browser, so it cannot tell whether an unfinished transfer of this project exists. " +
  "Check your Zenodo uploads for a draft from an earlier run before starting a new one.";

function unreadable(e: unknown): ResumeCheck {
  const detail = e instanceof Error && e.message ? ` (${e.message})` : "";
  return { kind: "unreadable", message: `${UNREADABLE}${detail}` };
}

/** Page load: is there a running job for this project in this browser? */
export async function findRunningJob(
  guid: string,
  list: () => Promise<TransferJobSnapshot[]>,
): Promise<ResumeCheck> {
  let jobs: TransferJobSnapshot[];
  try {
    jobs = await list();
  } catch (e) {
    return unreadable(e);
  }
  const match = jobs.find((j) => j.guid === guid && j.status === "running");
  return match ? { kind: "found", jobId: match.jobId, records: match.records } : { kind: "none" };
}

/** After a failed run: re-read the saved job, offering it only if it holds record ids. */
export async function savedJobForResume(
  jobId: string,
  get: (id: string) => Promise<TransferJobSnapshot | null>,
): Promise<ResumeCheck> {
  let saved: TransferJobSnapshot | null;
  try {
    saved = await get(jobId);
  } catch (e) {
    return unreadable(e);
  }
  // A resume with an empty record list would silently create FRESH drafts; that is a
  // genuine "nothing to resume", not an unknown.
  return saved && saved.records.length > 0
    ? { kind: "found", jobId: saved.jobId, records: saved.records }
    : { kind: "none" };
}
