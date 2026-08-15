"use client";

import { useCallback, useState } from "react";
import {
  listDraftFileEntries,
  listUserRecords,
  searchCommunities,
  ZENODO_MAX_FILES_PER_RECORD,
  type ZenodoCommunity,
  type ZenodoUserRecord,
} from "@/lib/transition/targets/zenodo";
import type { ZenodoAuth } from "@/lib/transition/targets/zenodo";
import { Working } from "@/components/Progress";

/**
 * What the user picked, in the shape the transfer panel needs.
 *
 * Carries the human-readable title alongside the id so the summary can name the deposit a
 * researcher is about to write into. An id alone would let the confirmation line read
 * "record 587074", which is not something anybody can check.
 */
export type DestinationChoice =
  | { kind: "new" }
  | { kind: "existing-draft"; recordId: string; title: string }
  | { kind: "new-version"; sourceRecordId: string; sourceTitle: string; sourceDoi: string | null };

/**
 * Choose where the deposit lands, and optionally which community to ask to take it.
 *
 * Everything here is lazy: no Zenodo call is made, and no token is fetched, until the user
 * asks for one of the options that needs it. The default — a new record — is the path the
 * overwhelming majority of transfers want, and it costs nothing.
 *
 * The three destinations are NOT interchangeable and the copy says so. A Zenodo *version*
 * means a revision of the same work; using it for a different project makes a false claim
 * in DataCite that cannot be withdrawn once published.
 */
export function DestinationPicker({
  value,
  onChange,
  community,
  onCommunityChange,
  getAuth,
  site,
}: {
  value: DestinationChoice;
  onChange: (v: DestinationChoice) => void;
  community: ZenodoCommunity | null;
  onCommunityChange: (c: ZenodoCommunity | null) => void;
  /** Fetches the run token on demand. Never called for the default destination. */
  getAuth: () => Promise<ZenodoAuth>;
  site: string;
}) {
  const [drafts, setDrafts] = useState<ZenodoUserRecord[] | null>(null);
  const [published, setPublished] = useState<ZenodoUserRecord[] | null>(null);
  const [loading, setLoading] = useState<"drafts" | "published" | "communities" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sameWork, setSameWork] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZenodoCommunity[] | null>(null);
  /**
   * How full the chosen draft already is.
   *
   * Read from `listDraftFileEntries`, never from the record listing — that reported
   * `files.count: 0` for a draft with a committed file (measured 2026-08-14). Shown here so
   * the room left is visible BEFORE the run, rather than discovered as an extra record
   * halfway through.
   */
  const [draftFill, setDraftFill] = useState<{ recordId: string; files: number } | null>(null);

  const load = useCallback(
    async (which: "drafts" | "published") => {
      setLoading(which);
      setError(null);
      try {
        const auth = await getAuth();
        const list = await listUserRecords(auth, { published: which === "published" });
        if (which === "drafts") setDrafts(list.filter((r) => r.status !== "published"));
        else setPublished(list.filter((r) => r.status === "published"));
      } catch (e) {
        setError(
          `Could not read your ${site.replace(/^https:\/\//, "")} records: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      } finally {
        setLoading(null);
      }
    },
    [getAuth, site],
  );

  async function pick(kind: DestinationChoice["kind"]) {
    setError(null);
    setSameWork(false);
    if (kind === "new") {
      onChange({ kind: "new" });
      return;
    }
    if (kind === "existing-draft") {
      // Nothing is selected until they choose a record — an id picked for them would be a
      // deposit into someone's draft that they never named.
      onChange({ kind: "existing-draft", recordId: "", title: "" });
      if (!drafts) await load("drafts");
      return;
    }
    onChange({ kind: "new-version", sourceRecordId: "", sourceTitle: "", sourceDoi: null });
    if (!published) await load("published");
  }

  async function measureDraft(recordId: string) {
    try {
      const auth = await getAuth();
      const entries = await listDraftFileEntries(auth, recordId);
      setDraftFill({ recordId, files: entries.length });
    } catch {
      // Not fatal here: the run measures it again and refuses a full draft before
      // uploading. Leaving the line absent is honest — a "0 files" we did not read would
      // not be.
      setDraftFill(null);
    }
  }

  async function runSearch() {
    if (!query.trim()) return;
    setLoading("communities");
    setError(null);
    try {
      const auth = await getAuth();
      setResults(await searchCommunities(auth, query.trim()));
    } catch (e) {
      setError(`Could not search communities: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-6 rounded border border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold">Where should this deposit go?</h3>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        Zenodo has no projects or folders, so there is nothing to browse into — but these three are
        different things, and only you know which one is true.
      </p>

      <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="zenodo-destination"
            checked={value.kind === "new"}
            onChange={() => void pick("new")}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            <span className="font-medium">A new record.</span>{" "}
            <span className="text-neutral-600 dark:text-neutral-400">
              A fresh private draft with metadata crosswalked from OSF. This is what you want unless
              you already have a deposit for this work.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="zenodo-destination"
            checked={value.kind === "existing-draft"}
            onChange={() => void pick("existing-draft")}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            <span className="font-medium">A draft I already have.</span>{" "}
            <span className="text-neutral-600 dark:text-neutral-400">
              Adds these files to an unpublished draft. BetterOSF will <strong>not</strong> touch that
              draft&apos;s metadata — anything you wrote there stays as it is, and the fidelity table
              below does not apply to it.
            </span>
          </span>
        </label>

        {value.kind === "existing-draft" ? (
          <div className="ml-6">
            {loading === "drafts" ? (
              <Working>Reading your drafts…</Working>
            ) : drafts && drafts.length === 0 ? (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                You have no unpublished drafts on {site.replace(/^https:\/\//, "")}. Choose &ldquo;a new
                record&rdquo; instead.
              </p>
            ) : (
              <>
                <select
                  value={value.recordId}
                  onChange={(e) => {
                    const rec = (drafts ?? []).find((d) => d.id === e.target.value);
                    setDraftFill(null);
                    onChange({
                      kind: "existing-draft",
                      recordId: rec?.id ?? "",
                      title: rec?.title ?? "",
                    });
                    if (rec) void measureDraft(rec.id);
                  }}
                  className="w-full rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value="">Choose a draft…</option>
                  {(drafts ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} — {d.id}
                    </option>
                  ))}
                </select>
                {draftFill && draftFill.recordId === value.recordId ? (
                  <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
                    That draft already holds <strong>{draftFill.files}</strong> file(s), so it has room
                    for about {Math.max(0, ZENODO_MAX_FILES_PER_RECORD - 1 - draftFill.files)} more
                    before Zenodo&apos;s per-record limit forces a second record.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  Zenodo&apos;s list of your drafts is a search index and lags by a few seconds, so a
                  draft you made moments ago may not be here yet.{" "}
                  <button type="button" onClick={() => void load("drafts")} className="underline">
                    Refresh
                  </button>
                </p>
              </>
            )}
          </div>
        ) : null}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="zenodo-destination"
            checked={value.kind === "new-version"}
            onChange={() => void pick("new-version")}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span>
            <span className="font-medium">A new version of something I already published.</span>{" "}
            <span className="text-neutral-600 dark:text-neutral-400">
              Only if the published record is <em>the same work</em> and the data has since changed. A
              Zenodo version is a revision, not a sequel and not a part two — it shares the record&apos;s
              concept DOI and supersedes the earlier version for anyone citing it.
            </span>
          </span>
        </label>

        {value.kind === "new-version" ? (
          <div className="ml-6">
            {loading === "published" ? (
              <Working>Reading your published records…</Working>
            ) : published && published.length === 0 ? (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                You have no published records on {site.replace(/^https:\/\//, "")}, so there is nothing to
                make a new version of.
              </p>
            ) : (
              <>
                <select
                  value={value.sourceRecordId}
                  onChange={(e) => {
                    const rec = (published ?? []).find((d) => d.id === e.target.value);
                    setSameWork(false);
                    onChange({
                      kind: "new-version",
                      sourceRecordId: rec?.id ?? "",
                      sourceTitle: rec?.title ?? "",
                      sourceDoi: rec?.doi ?? null,
                    });
                  }}
                  className="w-full rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value="">Choose a published record…</option>
                  {(published ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                      {d.doi ? ` — ${d.doi}` : ` — ${d.id}`}
                    </option>
                  ))}
                </select>
                {value.sourceRecordId ? (
                  <label className="mt-2 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={sameWork}
                      onChange={(e) => {
                        setSameWork(e.target.checked);
                        // The acknowledgement is not stored on the choice — clearing the
                        // record id when it is withdrawn is what actually blocks the run,
                        // so an unticked box cannot be bypassed by re-rendering.
                        if (!e.target.checked) {
                          onChange({ ...value, sourceRecordId: "" });
                        }
                      }}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>
                      <strong>{value.sourceTitle}</strong> is the same work as this OSF project, and this
                      deposit is a revision of it. I understand the new version supersedes it for
                      citation.
                    </span>
                  </label>
                ) : null}
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  The new version starts empty — BetterOSF uploads its own verified copy of every file
                  rather than importing the previous version&apos;s, so nothing in the deposit is bytes
                  this run did not check.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------------------------ community */}
      <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <h4 className="text-sm font-semibold">
          Submit to a community?{" "}
          <span className="font-normal text-neutral-600 dark:text-neutral-400">Optional.</span>
        </h4>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Communities are curated collections on Zenodo. BetterOSF adds a submission <em>request</em> to
          each draft — it never sends it, and a curator can decline. That has no bearing on whether your
          files copied correctly.{" "}
          <strong>
            While a request is open, Zenodo will not let you publish the draft directly; you either
            submit it to the community or cancel the request first.
          </strong>
        </p>

        {community ? (
          <p className="mt-2 rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
            Requesting: <strong>{community.title}</strong>{" "}
            <span className="text-neutral-600 dark:text-neutral-400">({community.slug})</span>
            {community.submissionPolicy !== "open" ? (
              <span className="block text-xs text-amber-800 dark:text-amber-300">
                This community only accepts submissions from its members ({community.submissionPolicy}),
                so the request may be refused outright.
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onCommunityChange(null)}
              className="ml-2 underline"
            >
              Remove
            </button>
          </p>
        ) : (
          <div className="mt-2 flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search communities by name"
              className="flex-1 rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={!query.trim() || loading === "communities"}
              className="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-600"
            >
              Search
            </button>
          </div>
        )}

        {loading === "communities" ? <Working>Searching…</Working> : null}
        {!community && results ? (
          results.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              No communities matched &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onCommunityChange(c);
                      setResults(null);
                    }}
                    className="text-left underline"
                  >
                    {c.title}
                  </button>{" "}
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">
                    ({c.slug}
                    {c.submissionPolicy !== "open" ? `, ${c.submissionPolicy} submissions` : ""})
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Is this choice complete enough to start a run?
 *
 * An "existing draft" with no record chosen, or a "new version" whose same-work
 * acknowledgement was never given, must not silently fall back to creating a new record —
 * that would deposit somewhere the researcher did not ask for.
 */
export function destinationReady(choice: DestinationChoice): boolean {
  if (choice.kind === "new") return true;
  if (choice.kind === "existing-draft") return choice.recordId.length > 0;
  return choice.sourceRecordId.length > 0;
}
