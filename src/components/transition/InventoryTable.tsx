"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { recommend, actionLabel, type Action, type ProjectFacts } from "@/lib/transition/recommend";
import { describeStorageUnknown, type StorageUsage } from "@/lib/transition/storage-usage";
import { readApiError, networkError, type ApiError } from "@/lib/api-error";
import { ErrorNotice } from "@/components/ErrorNotice";
import { ProgressBar, Spinner } from "@/components/Progress";

type Project = {
  guid: string;
  title: string;
  category: string;
  public: boolean;
  dateModified: string;
  osfUrl: string;
  parentId: string | null;
};

type Enrichment = {
  hasDoi: boolean | null;
  doi: string | null;
  addonProviders: string[] | null;
  wikiCount: number | null;
  storage: StorageUsage;
  errors: Record<string, string>;
};

const BATCH = 10;

/**
 * The inventory.
 *
 * Two tiers, because a researcher with 400 projects should not stare at a spinner. Tier 1
 * (title, visibility, dates) renders PAGE BY PAGE as it arrives; tier 2 (DOI, add-ons,
 * wikis, size) fills in batch by batch behind a visible progress bar. A row that has not
 * been enriched yet says so — it never shows a blank or a zero that would read as a fact.
 *
 * Tier 1 used to arrive all at once, which on a real 443-project account meant **27
 * seconds** behind a single static line of text (measured 2026-08-13). That is
 * indistinguishable from a hang, and was reported as one. Now each page renders on
 * arrival, against a denominator OSF itself supplies, so the wait is visibly a wait.
 *
 * Enrichment is sequential by batch on purpose. Firing 40 batches at once would be faster
 * for one user and a good way to trip OSF's rate limiter for everyone.
 */
export function InventoryTable() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [enriched, setEnriched] = useState<Record<string, Enrichment>>({});
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [enrichDone, setEnrichDone] = useState(0);
  const [enriching, setEnriching] = useState(false);
  const [filter, setFilter] = useState<Action | "all">("all");
  /** OSF's own count of the collection, so the bar has a real denominator. */
  const [expectedTotal, setExpectedTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Batches that failed. Those rows stay "not checked" — a gap, never a zero. */
  const [enrichFailures, setEnrichFailures] = useState(0);
  /** Non-null when some pages loaded and a later one failed — a PARTIAL list. */
  const [partial, setPartial] = useState<ApiError | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setPartial(null);
    setProjects(null);
    setEnriched({});
    setEnrichDone(0);
    setExpectedTotal(null);
    setLoadingMore(true);

    const collected: Project[] = [];
    let cursor: string | null = null;
    // A cap, so a broken `next` link cannot spin forever. 100 pages x 100 =
    // 10,000 projects, far beyond any real account; hitting it is reported, not
    // silently truncated.
    const MAX_PAGES = 100;

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        if (cancelled.current) return;
        const endpoint = `/api/transition/inventory${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;

        let res: Response;
        try {
          res = await fetch(endpoint, { cache: "no-store" });
        } catch (e) {
          const err = networkError("/api/transition/inventory", e);
          if (collected.length > 0) setPartial(err);
          else setLoadError(err);
          return;
        }

        if (!res.ok) {
          const err = await readApiError(res, "/api/transition/inventory");
          // A failure AFTER some pages landed is different from a failure with
          // nothing: the list on screen is real but incomplete, and saying so is
          // the whole point of this feature.
          if (collected.length > 0) setPartial(err);
          else setLoadError(err);
          return;
        }

        const data: { projects: Project[]; nextCursor: string | null; total: number | null } =
          await res.json();

        collected.push(...data.projects);
        if (data.total !== null) setExpectedTotal(data.total);
        // Render what has arrived, every page, rather than at the end.
        setProjects([...collected]);

        cursor = data.nextCursor;
        if (!cursor) return;

        if (page === MAX_PAGES - 1) {
          setPartial({
            message: `Stopped after ${MAX_PAGES} pages. This list is not complete.`,
            action: "Report this — an account this large is worth handling properly.",
            code: "page_cap",
            status: 0,
            detail: `Collected ${collected.length} projects before stopping.`,
            requestId: null,
            at: new Date().toISOString(),
            endpoint: "/api/transition/inventory",
          });
        }
      }
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enrichAll = useCallback(async () => {
    if (!projects) return;
    setEnriching(true);
    setEnrichDone(0);
    setEnrichFailures(0);
    const pending = projects.map((p) => p.guid);

    for (let i = 0; i < pending.length; i += BATCH) {
      if (cancelled.current) break;
      const guids = pending.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/transition/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guids }),
        });
        if (res.ok) {
          const data: { projects: (Enrichment & { guid: string })[] } = await res.json();
          setEnriched((prev) => {
            const next = { ...prev };
            for (const p of data.projects) next[p.guid] = p;
            return next;
          });
        } else {
          // A failed batch leaves those rows un-enriched, which the table shows
          // as "not checked". Better a visible gap than a fabricated value — but
          // the gap has to be COUNTED, or the run looks like it succeeded.
          setEnrichFailures((n) => n + 1);
        }
      } catch {
        setEnrichFailures((n) => n + 1);
      }
      setEnrichDone(Math.min(i + BATCH, pending.length));
    }
    setEnriching(false);
  }, [projects]);

  const rows = useMemo(() => {
    if (!projects) return [];
    const now = new Date();
    return projects.map((p) => {
      const e = enriched[p.guid];
      const facts: ProjectFacts = {
        guid: p.guid,
        title: p.title,
        public: p.public,
        hasDoi: e?.hasDoi ?? null,
        dateModified: p.dateModified,
        // Placeholders only ever reached when !e, in which case warnings are dropped
        // below — see the note there.
        storage: e?.storage ?? { known: false, reason: "error" },
        fileCount: null,
        addonProviders: e ? e.addonProviders : [],
        wikiCount: e?.wikiCount ?? null,
        isRegistration: p.category === "registration",
      };
      const recommendation = recommend(facts, now);

      // Warnings describe FEASIBILITY, and feasibility is unknown until the row has been
      // enriched. Showing "Size unknown" on 300 un-checked rows would be noise, and
      // showing "no add-ons" would be a claim we have not earned. So an un-enriched row
      // carries no warnings at all, and every one of its fields says "not checked yet".
      // The primary action still shows: it needs only public/private and the modified
      // date, both of which arrived in tier 1.
      return {
        project: p,
        enrichment: e,
        recommendation: e ? recommendation : { ...recommendation, warnings: [] },
        enriched: Boolean(e),
      };
    });
  }, [projects, enriched]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.recommendation.action] = (c[r.recommendation.action] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.recommendation.action === filter);

  if (loadError) {
    return (
      <ErrorNotice
        error={loadError}
        title="Could not load your projects"
        onRetry={() => void load()}
      >
        <p>Nothing on OSF was changed. Your projects are unaffected — this is only the list.</p>
      </ErrorNotice>
    );
  }

  if (!projects) {
    return (
      <ProgressBar
        done={0}
        total={expectedTotal}
        label="Reading your projects from OSF…"
        sublabel="OSF returns them a hundred at a time. They appear here as each page arrives."
      />
    );
  }

  if (projects.length === 0) {
    // An empty list is a real answer, and must not read as a failure.
    return (
      <p className="rounded border border-neutral-300 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900">
        OSF returned no projects for your account. If you expected some, check that you are signed in
        as the right user.
      </p>
    );
  }

  return (
    <div>
      {loadingMore ? (
        <div className="mb-4">
          <ProgressBar
            done={projects.length}
            total={expectedTotal}
            label="Loading your projects…"
            sublabel="You can start reading the ones below while the rest arrive."
          />
        </div>
      ) : null}

      {partial ? (
        <div className="mb-4">
          <ErrorNotice
            error={partial}
            title="This list is incomplete"
            onRetry={() => void load()}
            retryLabel="Reload the whole list"
          >
            <p>
              {projects.length}
              {expectedTotal ? ` of ${expectedTotal}` : ""} projects loaded before this failed. What
              is shown is real, but do not treat it as everything you have.
            </p>
          </ErrorNotice>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          <strong>{projects.length}</strong> {projects.length === 1 ? "project" : "projects"}
          {loadingMore && expectedTotal ? (
            <span className="text-neutral-500"> of {expectedTotal} so far</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => void enrichAll()}
          disabled={enriching || loadingMore}
          className="inline-flex items-center gap-2 rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50 dark:border-neutral-600"
          title={loadingMore ? "Waiting for the full list first" : undefined}
        >
          {enriching ? <Spinner /> : null}
          {enriching
            ? `Checking… ${enrichDone} of ${projects.length}`
            : "Check DOIs, wikis and add-ons"}
        </button>
        {Object.keys(counts).length > 0 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All {projects.length}
            </FilterChip>
            {(["leave", "back_up", "migrate", "review"] as Action[])
              .filter((a) => counts[a])
              .map((a) => (
                <FilterChip key={a} active={filter === a} onClick={() => setFilter(a)}>
                  {actionLabel(a)} {counts[a]}
                </FilterChip>
              ))}
          </div>
        ) : null}
      </div>

      {enriching ? (
        <div className="mt-4">
          <ProgressBar
            done={enrichDone}
            total={projects.length}
            label="Checking DOIs, wikis and add-ons…"
            sublabel={
              enrichFailures > 0
                ? `${enrichFailures} batch(es) failed so far — those rows stay "not checked" rather than showing a made-up value.`
                : "Done in batches of 10, deliberately, so this does not trip OSF's rate limiter."
            }
          />
        </div>
      ) : null}

      {!enriching && enrichFailures > 0 ? (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {enrichFailures} batch(es) could not be checked, so some rows below still say &ldquo;not
          checked yet&rdquo;. That is a gap, not a zero — run the check again to fill them in.
        </p>
      ) : null}

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
        Suggestions are generated automatically from project metadata. They are not advice, and
        nothing here changes anything on OSF.
      </p>

      <ul className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
        {visible.map(({ project, enrichment, recommendation, enriched: isEnriched }) => (
          <li key={project.guid} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                <Link href={`/${project.guid}`} className="underline">
                  {project.title || project.guid}
                </Link>{" "}
                <span className="font-normal text-neutral-500">
                  {project.public ? "public" : "private"}
                </span>
              </h3>
              <span className={badgeClass(recommendation.action)}>
                {actionLabel(recommendation.action)}
              </span>
            </div>

            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              {recommendation.headline}
            </p>

            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
              <Fact label="Modified">{project.dateModified.slice(0, 10) || "unknown"}</Fact>
              <Fact label="Size">
                {!isEnriched
                  ? "not checked yet"
                  : enrichment!.storage.known
                    ? formatBytes(enrichment!.storage.bytes)
                    : describeStorageUnknown(enrichment!.storage.reason)}
              </Fact>
              <Fact label="DOI">
                {!isEnriched ? "not checked yet" : (enrichment!.doi ?? "none")}
              </Fact>
              <Fact label="Wikis">
                {!isEnriched ? "not checked yet" : (enrichment!.wikiCount ?? "unknown")}
              </Fact>
              <Fact label="Add-ons">
                {!isEnriched
                  ? "not checked yet"
                  : enrichment!.addonProviders === null
                    ? "unknown"
                    : enrichment!.addonProviders.length === 0
                      ? "none"
                      : enrichment!.addonProviders.join(", ")}
              </Fact>
            </dl>

            {recommendation.warnings.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {recommendation.warnings.map((w) => (
                  <li
                    key={w}
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400">
                Why this suggestion
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-neutral-700 dark:text-neutral-300">
                {recommendation.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {recommendation.action === "leave" ? (
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  If you do move it anyway, ask COS to redirect the existing link or DOI rather than
                  leaving two copies competing:{" "}
                  <a
                    className="underline"
                    href="https://docs.google.com/forms/d/1Z4Dtrmf3GBWIgDA4HG83QZzsx-qniSJYdhYCM3ILmrA/viewform"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    DOI redirect form
                  </a>{" "}
                  ·{" "}
                  <a
                    className="underline"
                    href="https://docs.google.com/forms/d/19UtsWlI6DIVydd5pP9BEzB2CCJMzMg4J4YcH-zAG_N4/viewform"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    URL redirect form
                  </a>{" "}
                  (admin contributors only).
                </p>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-medium">{label}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-300 dark:border-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function badgeClass(action: Action): string {
  const base = "rounded px-2 py-0.5 text-xs font-medium";
  switch (action) {
    case "migrate":
      return `${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200`;
    case "back_up":
      return `${base} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`;
    case "review":
      return `${base} bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200`;
    default:
      return `${base} bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
