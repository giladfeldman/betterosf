"use client";

import { useState } from "react";
import { clausesByIds } from "@/lib/terms";

type RecordSummary = { recordId: string; draftUrl: string; futureRecordUrl: string; fileCount: number };

type PublishState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "confirming"; recordId: string; phrase: string; fileCount: number }
  | { phase: "publishing"; recordId: string }
  | { phase: "error"; message: string };

type Published = { doi: string | null; url: string };

/**
 * Publishing a draft — the one irreversible act in the toolkit.
 *
 * The phrase the user types is **fetched from the server and re-derived there when they
 * submit**, from Zenodo's own listing of the draft. It is never computed here: a phrase
 * the client both sets and checks is a formality, and the file count embedded in it is
 * what makes a stale dialog fail to match.
 *
 * The panel refuses to offer publishing at all for a run that did not reconcile as
 * complete. That is not a technical limit — Zenodo would accept it — it is a refusal to be
 * the thing that made a permanent, citable record of a copy we know is missing files.
 */
export function PublishPanel({
  jobId,
  records,
  publishable,
  site,
  env,
}: {
  jobId: string;
  records: RecordSummary[];
  publishable: boolean;
  site: string;
  env: string;
}) {
  const [state, setState] = useState<PublishState>({ phase: "idle" });
  const [typed, setTyped] = useState("");
  /**
   * Published records, by id. A map rather than a single "published" state because a split
   * deposit has several records and each is published separately — collapsing the panel on
   * the first success would hide records 2..N and make the deposit look finished when most
   * of it is still an unpublished draft.
   */
  const [published, setPublished] = useState<Record<string, Published>>({});

  const clauses = clausesByIds(["transition-publication-irreversible"]);

  async function beginPublish(recordId: string) {
    setState({ phase: "loading" });
    setTyped("");
    try {
      const res = await fetch(
        `/api/transition/publish?jobId=${encodeURIComponent(jobId)}&recordId=${encodeURIComponent(recordId)}`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: "error", message: body.error ?? `Could not prepare publishing (HTTP ${res.status}).` });
        return;
      }
      setState({ phase: "confirming", recordId, phrase: body.phrase, fileCount: body.fileCount });
    } catch {
      setState({ phase: "error", message: "Could not reach BetterOSF." });
    }
  }

  async function confirmPublish(recordId: string) {
    setState({ phase: "publishing", recordId });
    try {
      const res = await fetch("/api/transition/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, recordId, typedPhrase: typed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: "error", message: body.error ?? `Zenodo refused to publish (HTTP ${res.status}).` });
        return;
      }
      setPublished((prev) => ({ ...prev, [recordId]: { doi: body.doi, url: body.url } }));
      setState({ phase: "idle" });
    } catch {
      setState({ phase: "error", message: "Could not reach BetterOSF. Nothing was published." });
    }
  }

  if (!publishable) {
    return (
      <div className="mt-6 rounded border border-neutral-300 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-sm font-semibold">Publishing is not offered for this run</h3>
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">
          This transfer did not reconcile as complete, so BetterOSF will not turn it into a permanent public
          record. The draft is still in your Zenodo account: fix what the report lists and run the transfer
          again, or publish it yourself from {site.replace(/^https:\/\//, "")} if you have read the report and
          mean to.
        </p>
      </div>
    );
  }

  const allPublished = records.length > 0 && records.every((r) => published[r.recordId]);

  return (
    <div className="mt-6 rounded border border-neutral-300 p-4 dark:border-neutral-700">
      <h3 className="text-sm font-semibold">Publish (optional, and permanent)</h3>
      <ul className="mt-2 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
        {clauses.map((c) => (
          <li key={c.id}>
            <strong>{c.heading}.</strong> {c.body}
          </li>
        ))}
      </ul>
      {env === "sandbox" ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This is Zenodo&apos;s sandbox. Publishing here mints a <strong>test</strong> DOI on an instance that
          can be wiped — useful for a rehearsal, worthless as a citation.
        </p>
      ) : null}
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        You do not have to publish. A draft stays private in your account for as long as you like, and you can
        review or edit it on Zenodo first.
      </p>

      {state.phase === "error" ? (
        <p className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {state.message}
        </p>
      ) : null}

      {allPublished ? (
        <p className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          Every record in this deposit is published. Update the links in your papers,
          preregistrations and lab wiki using the crosswalk CSV above — nothing on OSF was changed
          or deleted.
        </p>
      ) : null}

      <ul className="mt-3 space-y-3">
        {records.map((r) => (
          <li key={r.recordId} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="text-sm">
              <a href={r.draftUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Draft {r.recordId}
              </a>{" "}
              <span className="text-neutral-600 dark:text-neutral-400">({r.fileCount} files)</span>
            </p>

            {published[r.recordId] ? (
              <p className="mt-2 text-sm">
                <strong>Published:</strong>{" "}
                <a
                  href={published[r.recordId]!.url}
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {published[r.recordId]!.url}
                </a>
                {published[r.recordId]!.doi ? (
                  <>
                    {" "}
                    — DOI <code>{published[r.recordId]!.doi}</code>
                  </>
                ) : null}
              </p>
            ) : state.phase === "confirming" && state.recordId === r.recordId ? (
              <div className="mt-2">
                <label className="block text-sm">
                  Type <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{state.phrase}</code> to
                  publish {state.fileCount} file(s) permanently:
                  <input
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    className="mt-1 w-full rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    // The client check is a courtesy that avoids a pointless round trip.
                    // The decision is the server's, which re-derives the phrase from the
                    // draft's real contents at the moment of publishing.
                    disabled={typed.trim() !== state.phrase}
                    onClick={() => void confirmPublish(r.recordId)}
                    className="rounded bg-red-700 px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Publish permanently
                  </button>
                  <button
                    type="button"
                    onClick={() => setState({ phase: "idle" })}
                    className="rounded border border-neutral-400 px-3 py-1 text-sm dark:border-neutral-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={state.phase === "loading" || state.phase === "publishing"}
                onClick={() => void beginPublish(r.recordId)}
                className="mt-2 rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-600"
              >
                {state.phase === "publishing" && state.recordId === r.recordId
                  ? "Publishing…"
                  : "Publish this record…"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
