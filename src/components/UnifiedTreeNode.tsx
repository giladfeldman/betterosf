"use client";

import type { ReactNode } from "react";

export type TreeNodeKind = "pinned-root" | "provider-root" | "components-root" | "linked-root" | "registrations-root" | "folder" | "file" | "component" | "linked" | "registration";

export type TreeNodeData = {
  id: string;
  label: string;
  kind: TreeNodeKind;
  href?: string;       // for file/component/linked/registration leaves and headed roots
  newTab?: boolean;    // file leaves and linked-project leaves open in new tab
  badge?: string;      // private | shared | embargoed | withdrawn
  size?: number | null;
  modified?: string;
  provider?: string;   // for color/icon
  guid?: string;       // for components / linked / registrations
  fileCount?: number;  // # files directly under this folder, shown as "(N)" badge
};

function kindIcon(kind: TreeNodeKind, provider?: string): ReactNode {
  if (kind === "pinned-root") return <span aria-hidden="true">⭐</span>;
  if (kind === "provider-root") {
    // Brand glyphs (simple text); could be SVGs later
    const map: Record<string, string> = {
      osfstorage: "🗂",
      googledrive: "🅖",
      dropbox: "🅓",
      github: "🅖h",
      s3: "🅢3",
      box: "🅑",
      figshare: "🅕",
      onedrive: "🆄",
      owncloud: "🅞c",
      gitlab: "🅖l",
      bitbucket: "🅑b",
    };
    return <span aria-hidden="true">{map[provider ?? ""] ?? "🗄"}</span>;
  }
  if (kind === "components-root") return <span aria-hidden="true">🧩</span>;
  if (kind === "linked-root") return <span aria-hidden="true">🔗</span>;
  if (kind === "registrations-root") return <span aria-hidden="true">🔒</span>;
  if (kind === "folder") return <span aria-hidden="true">📁</span>;
  if (kind === "file") return <span aria-hidden="true">📄</span>;
  if (kind === "component") return <span aria-hidden="true">🧩</span>;
  if (kind === "linked") return <span aria-hidden="true">🔗</span>;
  if (kind === "registration") return <span aria-hidden="true">🔒</span>;
  return null;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function UnifiedTreeNode({
  node,
  depth,
  expanded,
  hasChildren,
  onToggle,
  selected,
}: {
  node: TreeNodeData;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  selected?: boolean;
}) {
  const inner = (
    <span className="inline-flex items-center gap-1 truncate min-w-0" title={node.label}>
      {kindIcon(node.kind, node.provider)}
      <span className="truncate">{node.label}</span>
      {node.fileCount != null && node.fileCount > 0 && (
        <span className="ml-1 text-xs text-neutral-500 shrink-0" aria-label={`${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`}>
          ({node.fileCount})
        </span>
      )}
      {node.size != null && <span className="ml-2 text-xs text-neutral-500 shrink-0">{formatSize(node.size)}</span>}
      {node.badge && <span className="ml-2 text-[10px] uppercase text-neutral-500 border rounded px-1 shrink-0">{node.badge}</span>}
    </span>
  );

  // Folder + provider-root + components-root etc. left-click toggles the expand;
  // right-click → "Open in new tab" still works because the `<a href>` is real.
  // Component + registration + linked leaves intercept left-click when they
  // have children — otherwise clicking would navigate to /<guid> instead of
  // expanding the inline sub-tree. The downstream onClick handler gates on
  // `hasChildren`, so leaves without children fall through to navigation.
  const interceptLeftClick =
    node.kind === "folder" ||
    node.kind === "provider-root" ||
    node.kind === "components-root" ||
    node.kind === "linked-root" ||
    node.kind === "registrations-root" ||
    node.kind === "pinned-root" ||
    node.kind === "component" ||
    node.kind === "registration" ||
    node.kind === "linked";

  const content = node.href ? (
    <a
      href={node.href}
      target={node.newTab ? "_blank" : undefined}
      rel={node.newTab ? "noopener" : undefined}
      className="block truncate hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
      onClick={(e) => {
        e.stopPropagation();
        // Toggle expand on left-click for container-ish nodes — only when the user
        // is left-clicking without modifiers (so Cmd/Ctrl/middle-click still open in
        // a new tab, and right-click still shows the browser context menu).
        if (interceptLeftClick && hasChildren && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {inner}
    </a>
  ) : (
    <span
      role={interceptLeftClick && hasChildren ? "button" : undefined}
      tabIndex={interceptLeftClick && hasChildren ? 0 : undefined}
      onClick={interceptLeftClick && hasChildren ? onToggle : undefined}
      onKeyDown={
        interceptLeftClick && hasChildren
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      className={`block truncate ${interceptLeftClick && hasChildren ? "cursor-pointer hover:underline" : ""}`}
    >
      {inner}
    </span>
  );

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      className={`flex items-center gap-1 py-0.5 px-1 text-sm font-mono-files hover:bg-neutral-100 dark:hover:bg-neutral-800 ${selected ? "bg-blue-50 dark:bg-blue-900/30" : ""}`}
      style={{ paddingLeft: `${depth * 0.75}rem` }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? "Collapse" : "Expand"}
        className={`shrink-0 w-4 text-center text-xs ${hasChildren ? "" : "invisible"}`}
      >
        {expanded ? "▼" : "▶"}
      </button>
      {content}
    </div>
  );
}
