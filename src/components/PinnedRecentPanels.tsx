"use client";

import { useEffect, useMemo, useState } from "react";
import { listPins, listRecent, type FavoriteKind, type FavoriteRef } from "@/lib/favorites";

type Tab = "projects" | "files" | "folders" | "registrations" | "pinned";

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

function projectHint(ref: FavoriteRef): string {
  if (ref.kind !== "file" && ref.kind !== "folder") return ref.kind;
  const firstSlash = ref.id.indexOf("/");
  return firstSlash > 0 ? `${ref.kind} in ${ref.id.slice(0, firstSlash)}` : ref.kind;
}

function tabKinds(tab: Tab): FavoriteKind[] {
  if (tab === "projects") return ["project", "component"];
  if (tab === "files") return ["file"];
  if (tab === "folders") return ["folder"];
  if (tab === "registrations") return ["registration"];
  return ["project", "component", "file", "folder", "registration", "preprint", "user"];
}

function itemList(items: FavoriteRef[], emptyMsg: string) {
  if (items.length === 0) return <p className="text-sm text-neutral-500">{emptyMsg}</p>;
  return (
    <ul className="space-y-2">
      {items.map((p) => (
        <li key={`${p.kind}:${p.id}`} className="min-w-0">
          <a href={hrefFor(p)} className="text-blue-600 hover:underline">
            {p.title}
          </a>
          <span className="ml-2 text-xs text-neutral-500">{projectHint(p)}</span>
        </li>
      ))}
    </ul>
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

  useEffect(() => {
    setMounted(true);
    setPins(listPins());
    setRecent(listRecent());
  }, []);

  const tabs = useMemo(() => {
    const out: { id: Tab; label: string; items: FavoriteRef[]; empty: string }[] = [];
    if (showPinned) out.push({ id: "pinned", label: "Pinned", items: pins, empty: "No pins yet. Use the star on projects, registrations, and files." });
    if (showRecent) {
      out.push(
        { id: "projects", label: "Projects", items: recent.filter((r) => tabKinds("projects").includes(r.kind)).slice(0, 10), empty: "Open a few projects and they will appear here." },
        { id: "files", label: "Files", items: recent.filter((r) => r.kind === "file").slice(0, 10), empty: "Preview files and they will appear here." },
        { id: "folders", label: "Folders", items: recent.filter((r) => r.kind === "folder").slice(0, 10), empty: "Open folders and they will appear here." },
        { id: "registrations", label: "Registrations", items: recent.filter((r) => r.kind === "registration").slice(0, 10), empty: "Open registrations and they will appear here." },
      );
    }
    return out;
  }, [pins, recent, showPinned, showRecent]);

  useEffect(() => {
    const first = tabs[0];
    if (first && !tabs.some((t) => t.id === tab)) setTab(first.id);
  }, [tab, tabs]);

  if (!mounted || tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  if (!active) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-xl font-semibold">Workspace</h2>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded border px-3 py-1 text-sm ${t.id === active.id ? "border-blue-500 bg-blue-600 text-white" : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"}`}
          >
            {t.label}
            <span className="ml-1 text-xs opacity-75">{t.items.length}</span>
          </button>
        ))}
      </div>
      {itemList(active.items, active.empty)}
    </section>
  );
}
