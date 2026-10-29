"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { OSF_READ_SCOPE, OSF_UPLOAD_SCOPE } from "@/lib/auth/osf-provider";
import { readApiError, networkError, type ApiError } from "@/lib/api-error";
import { ErrorNotice } from "@/components/ErrorNotice";
import { ProgressBar } from "@/components/Progress";
import {
  APPLY_BATCH_SIZE,
  DEFAULT_LICENCE_ID,
  isTickable,
  summariseRows,
  validateApply,
  type ApplyResult,
  type LicenceOption,
  type LicenceRow,
  type LicenceStatus,
} from "@/lib/licence/check";
import { daysUntil } from "@/lib/transition/deadlines";

const READ_ONLY_DATE = "2027-02-19";
const CALLBACK = "/tools/licence-check";

type Load =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "error"; error: ApiError }
  | { phase: "done" };

const STATUS_TEXT: Record<LicenceStatus, string> = {
  licensed: "Licensed",
  none: "No licence",
  other: "“Other” — check it",
  unknown: "Couldn’t check",
};

const STATUS_CLASS: Record<LicenceStatus, string> = {
  licensed: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  none: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  other: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  unknown: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
};

export function LicenceCheck() {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [rows, setRows] = useState<LicenceRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [options, setOptions] = useState<LicenceOption[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [licenceId, setLicenceId] = useState(DEFAULT_LICENCE_ID);
  const [holders, setHolders] = useState("");
  const [year, setYear] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Map<string, string>>(new Map());
  const [applyError, setApplyError] = useState<ApiError | null>(null);
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setLoad({ phase: "loading" });
    setRows([]);
    setTotal(null);
    let cursor: string | null = null;
    let first = true;
    try {
      while (first || cursor) {
        const url: string = cursor ? `/api/licences?cursor=${encodeURIComponent(cursor)}` : "/api/licences";
        const res = await fetch(url, { cache: "no-store" });
        if (id !== runId.current) return;
        if (res.status === 401) {
          const err = await readApiError(res, "/api/licences");
          if (err.code === "osf_unauthorized") setLoad({ phase: "error", error: err });
          else setLoad({ phase: "signed-out" });
          return;
        }
        if (!res.ok) {
          setLoad({ phase: "error", error: await readApiError(res, "/api/licences") });
          return;
        }
        const data: {
          rows: LicenceRow[];
          nextCursor: string | null;
          total: number | null;
          licences: LicenceOption[] | null;
          canWrite: boolean;
        } = await res.json();
        setRows((prev) => [...prev, ...data.rows]);
        if (first) {
          setTotal(data.total);
          setOptions(data.licences ?? []);
          setCanWrite(data.canWrite);
        }
        cursor = data.nextCursor;
        first = false;
      }
      setLoad({ phase: "done" });
    } catch (e) {
      if (id === runId.current) setLoad({ phase: "error", error: networkError("/api/licences", e) });
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const counts = useMemo(() => summariseRows(rows), [rows]);
  const visible = useMemo(() => {
    const list = showAll ? rows : rows.filter((r) => r.status !== "licensed");
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [rows, showAll]);
  const option = options.find((o) => o.id === licenceId);
  const input = {
    licenceId,
    // Semicolons, not commas: "University of X, Department Y" is one holder.
    copyrightHolders: holders.split(";").map((h) => h.trim()).filter(Boolean),
    year,
  };
  const problems = validateApply(input, option);
  const daysLeft = daysUntil(READ_ONLY_DATE, new Date());
  const frozen = daysLeft <= 0;
  // Only "No licence" and "Other" rows may be ticked. "Couldn't check" means we do not know
  // what OSF holds, so overwriting could replace a real licence; "Licensed" already has one.
  // "Select all" skips "Other": it may carry custom licence text that a bulk apply would replace.
  const selectable = rows.filter((r) => r.canEdit && r.status === "none");

  function toggle(guid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  async function apply() {
    const guids = [...selected];
    setConfirming(false);
    setApplyError(null);
    setFailures(new Map());
    setApplying({ done: 0, total: guids.length });
    const failed = new Map<string, string>();
    for (let i = 0; i < guids.length; i += APPLY_BATCH_SIZE) {
      const batch = guids.slice(i, i + APPLY_BATCH_SIZE);
      let results: ApplyResult[];
      try {
        const res = await fetch("/api/licences/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, guids: batch }),
        });
        if (!res.ok) {
          setApplyError(await readApiError(res, "/api/licences/apply"));
          break;
        }
        results = (await res.json()).results;
      } catch (e) {
        setApplyError(networkError("/api/licences/apply", e));
        break;
      }
      // Show what OSF holds after the change (the read-back), never what was typed.
      const confirmed = new Map<string, LicenceRow>();
      for (const r of results) {
        if (r.ok) confirmed.set(r.guid, r.row);
        else failed.set(r.guid, r.reason);
      }
      const okSet = new Set(confirmed.keys());
      setRows((prev) => prev.map((row) => {
        const back = confirmed.get(row.guid);
        // Keep the listing's parentId: a single-node read-back carries the same value.
        return back ? { ...back, parentId: row.parentId } : row;
      }));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const g of okSet) next.delete(g);
        return next;
      });
      setApplying({ done: Math.min(i + batch.length, guids.length), total: guids.length });
    }
    setFailures(failed);
    setApplying(null);
  }

  if (load.phase === "signed-out") {
    return (
      <div>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Sign in with OSF to check every project and component you can reach, public and private.
          Checking only reads; nothing on OSF changes unless you then choose to set a licence.
        </p>
        <button
          type="button"
          onClick={() => void signIn("osf", { callbackUrl: CALLBACK }, { scope: OSF_READ_SCOPE })}
          className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Sign in with OSF
        </button>
      </div>
    );
  }

  if (load.phase === "error") {
    return <ErrorNotice error={load.error} title="Could not check your licences" onRetry={() => void run()} />;
  }

  return (
    <div>
      {load.phase === "loading" ? (
        <ProgressBar done={rows.length} total={total} label="Reading your projects from OSF" />
      ) : (
        <div className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-base font-medium" data-testid="licence-summary">
            {rows.length === 0
              ? "You have no OSF projects or components to check."
              : `${counts.none + counts.other} of ${rows.length} projects and components have no clear reuse licence.`}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {(Object.keys(STATUS_TEXT) as LicenceStatus[]).map((s) => (
              <li key={s} className={`rounded px-2 py-1 ${STATUS_CLASS[s]}`}>
                {STATUS_TEXT[s]}: {counts[s]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {frozen
              ? "OSF projects are read-only now, so licences can no longer be changed there. Set one at your new repository instead."
              : `You can still set licences on OSF for ${daysLeft} more days (until 19 February 2027, when OSF projects become read-only).`}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show licensed projects too
            </label>
            {!frozen && selectable.length > 0 && (
              <button
                type="button"
                className="underline"
                onClick={() => setSelected(new Set(selectable.map((r) => r.guid)))}
              >
                Select all {selectable.length} you can fix
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" className="underline" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            )}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800">
                <tr>
                  <th className="w-8 py-2" />
                  <th className="py-2">Project</th>
                  <th className="py-2">Visibility</th>
                  <th className="py-2">Licence on OSF</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.guid} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                    <td className="py-2">
                      {isTickable(r) && !frozen ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.title}`}
                          checked={selected.has(r.guid)}
                          onChange={() => toggle(r.guid)}
                        />
                      ) : null}
                    </td>
                    <td className="py-2">
                      <a href={r.osfUrl} target="_blank" rel="noreferrer" className="underline">
                        {r.title || r.guid}
                      </a>
                      {r.parentId && <span className="ml-2 text-xs text-neutral-500">component</span>}
                      {!r.canEdit && (
                        <div className="text-xs text-neutral-500">Read-only for you — ask a project admin.</div>
                      )}
                      {failures.get(r.guid) && (
                        <div className="text-xs text-red-700 dark:text-red-300">{failures.get(r.guid)}</div>
                      )}
                    </td>
                    <td className="py-2">{r.public ? "Public" : "Private"}</td>
                    <td className="py-2">
                      {r.licenceName ?? "—"}
                      {r.copyrightHolders.length > 0 && (
                        <div className="text-xs text-neutral-500">
                          © {r.year ? `${r.year} ` : ""}
                          {r.copyrightHolders.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[r.status]}`}>{STATUS_TEXT[r.status]}</span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-neutral-600 dark:text-neutral-400">
                      Every project and component you can reach has a licence.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!frozen && (
            <section className="mt-8 rounded border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="text-base font-semibold">Set a licence on OSF</h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                CC BY 4.0 is selected by default: anyone may reuse the materials if they credit you.
                For data you may prefer CC0 (no conditions); for code, MIT. Not sure? Ask your
                librarian, or read the tips in{" "}
                <a href="https://osf.io/preprints/psyarxiv/4rjg3_v1" className="underline" target="_blank" rel="noreferrer">
                  Siepe, Heck &amp; Quintana
                </a>
                .
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  Licence
                  <select
                    className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-1 dark:border-neutral-700"
                    value={licenceId}
                    onChange={(e) => setLicenceId(e.target.value)}
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Copyright holder(s), separated by ;{option?.requiredFields.includes("copyrightHolders") ? " — required" : " — optional"}
                  <input
                    className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-1 dark:border-neutral-700"
                    placeholder="e.g. Jane Doe; John Roe"
                    value={holders}
                    onChange={(e) => setHolders(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Year{option?.requiredFields.includes("year") ? " — required" : " — optional"}
                  <input
                    className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-1 dark:border-neutral-700"
                    placeholder="e.g. 2024"
                    inputMode="numeric"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </label>
              </div>
              {problems.length > 0 && selected.size > 0 && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">{problems.join(" ")}</p>
              )}

              {!canWrite ? (
                <div className="mt-4 text-sm">
                  <p>
                    Setting a licence changes your project on OSF, so BetterOSF needs write access.
                    You signed in read-only.
                  </p>
                  <button
                    type="button"
                    onClick={() => void signIn("osf", { callbackUrl: CALLBACK }, { scope: OSF_UPLOAD_SCOPE })}
                    className="mt-2 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
                  >
                    Give BetterOSF write access
                  </button>
                </div>
              ) : confirming ? (
                <div className="mt-4 rounded bg-amber-50 p-3 text-sm dark:bg-amber-950">
                  <p className="font-medium">
                    Set {option?.name} on {selected.size} {selected.size === 1 ? "project" : "projects"}?
                  </p>
                  <p className="mt-1">
                    You can change a licence on OSF again until 19 February 2027, but anyone who
                    already took a copy under this licence keeps the right to use it — Creative
                    Commons licences cannot be withdrawn for copies already shared. Make sure your
                    co-authors agree.
                  </p>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={() => void apply()}
                      className="rounded bg-neutral-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-neutral-900"
                    >
                      Yes, set the licence
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : applying ? (
                <div className="mt-4">
                  <ProgressBar done={applying.done} total={applying.total} label="Setting licences on OSF and checking each one" />
                </div>
              ) : (
                <button
                  type="button"
                  disabled={selected.size === 0 || problems.length > 0}
                  onClick={() => setConfirming(true)}
                  className="mt-4 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
                >
                  {selected.size === 0 ? "Tick the projects to licence" : `Set licence on ${selected.size} selected`}
                </button>
              )}
              {applyError && (
                <div className="mt-3">
                  <ErrorNotice error={applyError} title="Stopped setting licences">
                    Projects marked Licensed above were confirmed on OSF. For the rest, reload this
                    page to see what OSF holds now — the last batch may have been partly saved.
                  </ErrorNotice>
                </div>
              )}
              {!applying && failures.size > 0 && (
                <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                  {failures.size} could not be confirmed — see the note under each project above.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
