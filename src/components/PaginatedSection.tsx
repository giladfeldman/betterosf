import { PageSizeSelector } from "./PageSizeSelector";
import { SortControl } from "./SortControl";
import { FilterChips } from "./FilterChips";
import type { ReactNode } from "react";

export type PaginatedSectionProps<T> = {
  /** Heading shown above the section. */
  title: string;
  /** Per-surface key for localStorage page-size persistence (e.g. "overview.linked"). */
  prefKey: string;
  /** Query-param name for page selection (default "page" — use unique names per section). */
  pageParamName?: string;
  /** Query-param name for size selection (default "size"). */
  sizeParamName?: string;
  /** Query-param name for sort selection. */
  sortParamName: string;
  /** Available sort options. */
  sortOptions: { value: string; label: string }[];
  /** Optional filter chips. */
  filter?: { paramName: string; chips: { value: string; label: string }[] };
  /** Items in their post-sort, post-filter order (pre-pagination). The caller does the
   *  actual sort/filter work in the server component using URL params, then passes the
   *  full filtered list here for slicing. */
  items: T[];
  /** Total before any filter applied (for "Showing X of Y" wording). */
  totalUnfiltered: number;
  /** Currently selected page (1-based). */
  page: number;
  /** Currently selected page size (50 default). "all" rendered as 500. */
  pageSize: number;
  /** Renderer for a single item. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Empty-state text when items.length === 0 after filtering. */
  emptyText?: string;
  /** Base URL path used by pagination links. */
  basePath: string;
  /** Existing search params object (next/navigation searchParams) to preserve when paginating. */
  searchParams: Record<string, string | string[] | undefined>;
};

function first(v: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;
}

function buildPageUrl(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  pageParamName: string,
  newPage: number
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined) continue;
    if (k === pageParamName) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, v);
    }
  }
  qs.set(pageParamName, String(newPage));
  return `${basePath}?${qs.toString()}`;
}

export function PaginatedSection<T>({
  title,
  prefKey,
  pageParamName = "page",
  sizeParamName = "size",
  sortParamName,
  sortOptions,
  filter,
  items,
  totalUnfiltered,
  page,
  pageSize,
  renderItem,
  emptyText = "No items.",
  basePath,
  searchParams,
}: PaginatedSectionProps<T>) {
  const totalAfterFilter = items.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, totalAfterFilter);
  const slice = items.slice(start, end);

  const hasPrev = page > 1;
  const hasNext = end < totalAfterFilter;

  const filteredNote = totalAfterFilter !== totalUnfiltered ? ` (filtered from ${totalUnfiltered})` : "";

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-2">{title} ({totalAfterFilter}{filteredNote})</h2>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <PageSizeSelector prefKey={prefKey} paramName={sizeParamName} />
        <SortControl paramName={sortParamName} options={sortOptions} />
        {filter && <FilterChips paramName={filter.paramName} chips={filter.chips} />}
      </div>

      <ul className="space-y-1">
        {slice.map((item, i) => renderItem(item, i))}
        {slice.length === 0 && <li className="text-neutral-500 text-sm">{emptyText}</li>}
      </ul>

      {(hasPrev || hasNext) && (
        <div className="flex justify-between items-center mt-3 text-sm">
          {hasPrev ? (
            <a className="text-blue-600 hover:underline" href={buildPageUrl(basePath, searchParams, pageParamName, page - 1)}>
              ← Previous
            </a>
          ) : (
            <span />
          )}
          <span className="text-neutral-500 text-xs">
            {start + 1}–{end} of {totalAfterFilter}
          </span>
          {hasNext ? (
            <a className="text-blue-600 hover:underline" href={buildPageUrl(basePath, searchParams, pageParamName, page + 1)}>
              Next →
            </a>
          ) : (
            <span />
          )}
        </div>
      )}
    </section>
  );
}

export function parsePagination(
  searchParams: Record<string, string | string[] | undefined>,
  sizeParam = "size",
  pageParam = "page",
  defaultSize = 50,
  allSentinel = 500
): { page: number; pageSize: number; sizeRaw: string } {
  const sizeRaw = first(searchParams[sizeParam]);
  let pageSize = defaultSize;
  if (sizeRaw === "all") pageSize = allSentinel;
  else if (sizeRaw) {
    const n = Number.parseInt(sizeRaw, 10);
    if (!Number.isNaN(n) && n > 0) pageSize = n;
  }
  const pageRaw = first(searchParams[pageParam]);
  let page = 1;
  if (pageRaw) {
    const n = Number.parseInt(pageRaw, 10);
    if (!Number.isNaN(n) && n >= 1) page = n;
  }
  return { page, pageSize, sizeRaw };
}
