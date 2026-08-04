"use client";

import { useEffect, useMemo, useState } from "react";
import { listPins, listRecent, removePin, type FavoriteKind, type FavoriteRef } from "@/lib/favorites";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relative-time";

type Tab = "projects" | "files" | "folders" | "registrations" | "pinned";
type SortKey = "recent" | "visits" | "title";

/**
 * Shown ONLY on a completely empty workspace, as a way in for first-time
 * visitors. Deliberately not rendered once the user has any history of their
 * own — the homepage used to list these permanently, which the user asked to
 * remove (2026-08-04).
 */
const EXAMPLE_PROJECTS = [
  { guid: "8cd4r", title: "Many Labs 2" },
  { guid: "ezcuj", title: "Reproducibility Project: Psychology" },
] as const;

const KIND_ICONS: Record<FavoriteKind, string> = {
  project: "🗄",
  component: "🧩",
  file: "📄",
  folder: "📁",
  registration: "🔒",
  preprint: "📰",
  user: "👤",
};

function hrefFor(ref: FavoriteRef): string {
  if (ref.kind === "registration") return `/registrations/${ref.id}`;
  if (ref.kind === "file") {
    const firstSlash = ref.id.indexOf("/");
    if (firstSlash > 0) {
      return `/${ref.id.slice(0, firstSlash)}/files/view/${ref.id.slice(firstSlash + 1)}`;
    }
  }
  if (ref.kind === "folder") {
    const firstSlash = ref.id.indexOf("/");
    if (firstSlash > 0) {
      return `/${ref.id.slice(0, firstSlash)}/files/${ref.id.slice(firstSlash + 1)}`;
    }
  }
  return `/${ref.id}`;
}

/** The owning project's guid for a file/folder ref, else null. */
function parentGuid(ref: FavoriteRef): string | null {
  if (ref.kind !== "file" && ref.kind !== "folder") return null;
  const firstSlash = ref.id.indexOf("/");
  return firstSlash > 0 ? ref.id.slice(0, firstSlash) : null;
}

/** Human location for a file/folder: the folder path inside its project. */
function locationFor(ref: FavoriteRef): string | null {
  const guid = parentGuid(ref);
  if (!guid) return null;
  const rest = ref.id.slice(guid.length + 1);
  const segments = rest.split("/").filter(Boolean);
  // Drop the provider (osfstorage) and, for files, the filename itself.
  const trimmed = ref.kind === "file" ? segments.slice(1, -1) : segments.slice(1);
  if (trimmed.length === 0) return guid;
  return `${guid} › ${trimmed.join(" › ")}`;
}

function tabKinds(tab: Tab): FavoriteKind[] {
  if (tab === "projects") return ["project", "component"];
  if (tab === "files") return ["file"];
  if (tab === "folders") return ["folder"];
  if (tab === "registrations") return ["registration"];
  return ["project", "component", "file", "folder", "registration", "preprint", "user"];
}

function sortItems(items: FavoriteRef[], key: SortKey): FavoriteRef[] {
  const out = [...items];
  if (key === "title") {
    out.sort((a, b) => a.title.localeCompare(b.title));
  } else if (key === "visits") {
    // Unknown visit counts sort last rather than being treated as zero-visits.
    out.sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0) || (b.lastViewed ?? 0) - (a.lastViewed ?? 0));
  } else {
    out.sort((a, b) => (b.lastViewed ?? 0) - (a.lastViewed ?? 0));
  }
  return out;
}

function WorkspaceTable({
  items,
  emptyMsg,
  showPinControl,
  onUnpin,
}: {
  items: FavoriteRef[];
  emptyMsg: string;
  showPinControl: boolean;
  onUnpin: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
        {emptyMsg}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60">
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="px-3 py-2 font-medium">Location</th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">Last opened</th>
            <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">Visits</th>
            {showPinControl && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const relative = formatRelativeTime(item.lastViewed);
            const absolute = formatAbsoluteTime(item.lastViewed);
            const location = locationFor(item);
            return (
              <tr
                key={`${item.kind}:${item.id}`}
                className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/50"
              >
                <td className="max-w-[22rem] px-3 py-2">
                  <a href={hrefFor(item)} className="flex min-w-0 items-center gap-2 text-blue-600 hover:underline dark:text-blue-400">
                    <span aria-hidden="true" className="shrink-0">{KIND_ICONS[item.kind]}</span>
                    <span className="truncate" title={item.title}>{item.title}</span>
                  </a>
                </td>
                <td className="max-w-[16rem] px-3 py-2 text-xs text-neutral-500">
                  <span className="block truncate" title={location ?? item.kind}>{location ?? item.kind}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500" title={absolute ?? undefined}>
                  {relative ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-neutral-500">
                  {item.visits ?? "—"}
                </td>
                {showPinControl && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onUnpin(item.id)}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Unpin
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PinnedRecentPanels({
  showPinned = true,
  showRecent = true,
}: {
  showPinned?: boolean;
  showRecent?: boolean;
}) {
  const [pins, setPins] = useState<FavoriteRef[]>([]);
  const [recent, setRecent] = useState<FavoriteRef[]>([]);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>(showPinned ? "pinned" : "projects");
  const [sort, setSort] = useState<SortKey>("recent");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setMounted(true);
    const refresh = () => {
      setPins(listPins());
      setRecent(listRecent());
    };
    refresh();
    window.addEventListener("betterosf:sync", refresh);
    return () => window.removeEventListener("betterosf:sync", refresh);
  }, []);

  const handleUnpin = (id: string) => {
    removePin(id);
    setPins(listPins());
  };

  const tabs = useMemo(() => {
    const out: { id: Tab; label: string; items: FavoriteRef[]; empty: string }[] = [];
    if (showPinned) {
      out.push({
        id: "pinned",
        label: "Pinned",
        items: pins,
        empty: "No pins yet. Use the star on projects, registrations, and files to keep them here.",
      });
    }
    if (showRecent) {
      out.push(
        { id: "projects", label: "Projects", items: recent.filter((r) => tabKinds("projects").includes(r.kind)), empty: "Open a few projects and they will appear here." },
        { id: "files", label: "Files", items: recent.filter((r) => r.kind === "file"), empty: "Preview files and they will appear here." },
        { id: "folders", label: "Folders", items: recent.filter((r) => r.kind === "folder"), empty: "Open folders and they will appear here." },
        { id: "registrations", label: "Registrations", items: recent.filter((r) => r.kind === "registration"), empty: "Open registrations and they will appear here." },
      );
    }
    return out;
  }, [pins, recent, showPinned, showRecent]);

  useEffect(() => {
    const first = tabs[0];
    if (first && !tabs.some((t) => t.id === tab)) setTab(first.id);
  }, [tab, tabs]);

  // Landing on an empty "Pinned" tab hides the recents the user actually has,
  // making the workspace look empty when it isn't. Fall through to the first
  // tab with content — but only once, so an explicit click is never overridden.
  const [autoTabDone, setAutoTabDone] = useState(false);
  useEffect(() => {
    if (autoTabDone || !mounted) return;
    setAutoTabDone(true);
    const current = tabs.find((t) => t.id === tab);
    if (current && current.items.length === 0) {
      const firstWithItems = tabs.find((t) => t.items.length > 0);
      if (firstWithItems) setTab(firstWithItems.id);
    }
  }, [autoTabDone, mounted, tab, tabs]);

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  const visible = useMemo(() => {
    if (!active) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? active.items.filter((i) => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
      : active.items;
    return sortItems(filtered, sort);
  }, [active, query, sort]);

  // Render nothing until mounted: pins/recents live in localStorage, so any
  // server-rendered markup would mismatch on hydration.
  if (!mounted || tabs.length === 0 || !active) return null;

  const totalRecent = recent.length;

  // First run: no history at all. The landing page no longer hardcodes example
  // projects, so without this a new visitor would face an empty panel with
  // nothing to click. These are starting points, not defaults, and they vanish
  // permanently as soon as the user has any history of their own.
  if (totalRecent === 0 && pins.length === 0) {
    return (
      <section aria-labelledby="workspace-heading">
        <h2 id="workspace-heading" className="mb-2 text-xl font-semibold">Workspace</h2>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
          Projects, files, and folders you open will be listed here — with when you last opened them and
          how often — so you can jump straight back in. Everything stays in this browser.
        </p>
        <div className="rounded border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
          <p className="mb-2 text-sm font-medium">New here? Try an example:</p>
          <ul className="space-y-1 text-sm">
            {EXAMPLE_PROJECTS.map((ex) => (
              <li key={ex.guid}>
                <a className="text-blue-600 hover:underline dark:text-blue-400" href={`/${ex.guid}`}>
                  {ex.title}
                </a>
                <span className="ml-2 text-xs text-neutral-500">{ex.guid}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="workspace-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="workspace-heading" className="text-xl font-semibold">Workspace</h2>
        {totalRecent > 0 && (
          <p className="text-xs text-neutral-500">
            {totalRecent} item{totalRecent === 1 ? "" : "s"} remembered in this browser
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Workspace sections" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`workspace-tab-${t.id}`}
              aria-selected={t.id === active.id}
              aria-controls={`workspace-panel-${t.id}`}
              tabIndex={t.id === active.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`rounded border px-3 py-1 text-sm ${t.id === active.id ? "border-blue-500 bg-blue-600 text-white" : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"}`}
            >
              {t.label}
              <span className="ml-1 text-xs opacity-75">{t.items.length}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="workspace-filter">Filter workspace items</label>
          <input
            id="workspace-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          <label className="sr-only" htmlFor="workspace-sort">Sort workspace items</label>
          <select
            id="workspace-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="recent">Recently opened</option>
            <option value="visits">Most visited</option>
            <option value="title">Name (A–Z)</option>
          </select>
        </div>
      </div>

      <div role="tabpanel" id={`workspace-panel-${active.id}`} aria-labelledby={`workspace-tab-${active.id}`}>
        <WorkspaceTable
          items={visible}
          emptyMsg={query.trim() ? `Nothing matches “${query.trim()}”.` : active.empty}
          showPinControl={active.id === "pinned"}
          onUnpin={handleUnpin}
        />
      </div>
    </section>
  );
}
