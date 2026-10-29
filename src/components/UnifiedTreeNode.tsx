"use client";

import { useState, type ReactNode, type DragEvent } from "react";
import { NewFolderControl } from "./NewFolderControl";
import { RenameControl } from "./RenameControl";
import { MoveControl } from "./MoveControl";
import type { TreeNodeKind, TreeSelectionPayload, TreeUploadTarget, TreeNodeData } from "./tree-types";

// Re-export the tree types so existing `from "./UnifiedTreeNode"` imports keep
// working. The definitions live in ./tree-types to break the UnifiedTreeNode ↔
// NewFolderControl circular import (NewFolderControl needs TreeUploadTarget).
export type { TreeNodeKind, TreeSelectionPayload, TreeUploadTarget, TreeNodeData };

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
  if (kind === "parent") return <span aria-hidden="true">⬆</span>;
  return null;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function middleTruncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, dot) : name;
  const room = Math.max(12, max - ext.length - 3);
  const head = Math.ceil(room * 0.58);
  const tail = Math.max(4, room - head);
  return `${stem.slice(0, head)}...${stem.slice(-tail)}${ext}`;
}

export function UnifiedTreeNode({
  node,
  depth,
  expanded,
  hasChildren,
  onToggle,
  selected,
  selectMode = false,
  onSelect,
  onUpload,
  onDelete,
  onRenamed,
  onMoved,
  onCreateFolder,
  onDropUpload,
  onRetry,
  treeIndex,
  tabIndex = -1,
  onFocusRow,
}: {
  node: TreeNodeData;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  selected?: boolean;
  selectMode?: boolean;
  onSelect?: (payload: TreeSelectionPayload, checked: boolean) => void;
  onUpload?: (target: TreeUploadTarget) => void;
  /** Opens the delete confirmation dialog for this single row. */
  onDelete?: (selection: TreeSelectionPayload) => void;
  /** Called AFTER a successful in-place rename, so the parent folder can refresh. */
  onRenamed?: (selection: TreeSelectionPayload) => void;
  onMoved?: (selection: TreeSelectionPayload, destListingUrl: string) => void;
  onCreateFolder?: (target: TreeUploadTarget) => void;
  onDropUpload?: (target: TreeUploadTarget, items: DataTransferItem[]) => void;
  onRetry?: () => void;
  /** Index of this row in the flattened tree — drives roving-tabindex focus. */
  treeIndex?: number;
  /** 0 when this is the active (focusable) treeitem, -1 otherwise. */
  tabIndex?: number;
  /** Called when the treeitem receives focus, so the parent can sync the active row. */
  onFocusRow?: () => void;
}) {
  const displayLabel = node.kind === "file" ? middleTruncateFilename(node.label) : node.label;

  // Drag-and-drop upload: only rows with an uploadTarget (writable osfstorage
  // folders/provider-roots) accept file drops. Non-writable rows reject with the
  // native no-drop cursor (dropEffect="none") and do nothing.
  const [isDragOver, setIsDragOver] = useState(false);
  const canDrop = !!node.uploadTarget && !!onDropUpload;
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop ? "copy" : "none";
    if (canDrop && !isDragOver) setIsDragOver(true);
  };
  const onDragLeave = () => { if (isDragOver) setIsDragOver(false); };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(false);
    if (!canDrop || !node.uploadTarget) return;
    onDropUpload!(node.uploadTarget, Array.from(e.dataTransfer.items));
  };
  const tooltip = [
    node.label,
    node.size != null ? formatSize(node.size) : "",
    node.modified ? `Modified ${node.modified.slice(0, 10)}` : "",
  ].filter(Boolean).join(" - ");
  const inner = (
    <span className="inline-flex items-center gap-1 truncate min-w-0" title={tooltip}>
      {kindIcon(node.kind, node.provider)}
      <span className="truncate">{displayLabel}</span>
      {node.fileCount != null && node.fileCount > 0 && (
        <span className="ml-1 text-xs text-neutral-500 shrink-0" aria-label={`${node.fileCount} file${node.fileCount === 1 ? "" : "s"}`}>
          ({node.fileCount})
        </span>
      )}
      {node.size != null && <span className="ml-2 text-xs text-neutral-500 shrink-0">{formatSize(node.size)}</span>}
      {node.badge && <span className="ml-2 text-[10px] uppercase text-neutral-500 border rounded px-1 shrink-0">{node.badge}</span>}
      {node.loading && !node.failed && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs text-neutral-500 shrink-0">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-neutral-400 border-t-transparent" aria-hidden="true" />
          loading…
        </span>
      )}
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
    node.kind === "linked" ||
    node.kind === "parent";

  const content = node.href ? (
    <a
      href={node.href}
      target={node.newTab ? "_blank" : undefined}
      rel={node.newTab ? "noopener" : undefined}
      className="block min-w-0 truncate hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
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
      className={`block min-w-0 truncate ${interceptLeftClick && hasChildren ? "cursor-pointer hover:underline" : ""}`}
    >
      {inner}
    </span>
  );

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      aria-level={depth + 1}
      data-tree-index={treeIndex}
      tabIndex={tabIndex}
      onFocus={onFocusRow}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex min-h-[28px] items-center gap-1 py-0.5 px-1 text-sm font-mono-files hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-neutral-800 ${selected ? "bg-blue-50 dark:bg-blue-900/30" : ""} ${isDragOver ? "outline outline-2 outline-blue-500 bg-blue-50 dark:bg-blue-950" : ""}`}
      style={{ paddingLeft: `${depth * 0.75}rem` }}
    >
      {selectMode && node.selection && (
        <input
          type="checkbox"
          aria-label={`Select ${node.label}`}
          checked={!!selected}
          onChange={(e) => onSelect?.(node.selection!, e.currentTarget.checked)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0"
        />
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? "Collapse" : "Expand"}
        className={`shrink-0 w-4 text-center text-xs ${hasChildren ? "" : "invisible"}`}
      >
        {expanded ? "▼" : "▶"}
      </button>
      {content}
      {node.failed && (
        <button
          type="button"
          title={node.failedMessage ? `Failed: ${node.failedMessage}` : "Failed to load — click to retry"}
          aria-label={`Retry loading ${node.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRetry?.();
          }}
          className="ml-2 shrink-0 rounded border border-red-300 bg-red-50 px-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
        >
          ⟳ Retry
        </button>
      )}
      {/* File rows have neither uploadTarget nor downloadHref, so the strip must also
          open for a deletable selection — otherwise files get no actions at all. */}
      {(node.uploadTarget || node.downloadHref || node.selection?.deleteUrl) && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {node.uploadTarget && (
            <NewFolderControl target={node.uploadTarget} onCreated={onCreateFolder} />
          )}
          {node.uploadTarget && (
            <button
              type="button"
              aria-label={`Upload to ${node.label}`}
              title={`Upload to ${node.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onUpload?.(node.uploadTarget!);
              }}
              className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
            >
              Upload
            </button>
          )}
          {node.downloadHref && (
            <a
              href={node.downloadHref}
              aria-label={`Download ${node.label} as ZIP`}
              title={`Download ${node.label} as ZIP`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded border border-neutral-300 px-1.5 text-[11px] hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              ZIP
            </a>
          )}
          {/* Rename shares the Delete gate exactly: deleteUrl doubles as the item's
              Waterbutler URL (OSF serves the identical URL under links.move), and its
              presence already encodes canDeleteHere = canUploadHere && canWrite.
              parentListingUrl is additionally required for the server-side
              registration pin and the post-rename refresh. */}
          {node.selection?.deleteUrl && node.selection?.parentListingUrl && (
            <RenameControl selection={node.selection} onRenamed={onRenamed} />
          )}
          {/* Move: same gate as Rename, never readOnly alone (d-f2a1e2). */}
          {node.selection?.deleteUrl && node.selection?.parentListingUrl && (
            <MoveControl selection={node.selection} onMoved={onMoved} />
          )}
          {/* Only writable osfstorage targets carry deleteUrl (set in UnifiedTree's
              emitters, gated on canUploadHere), so registrations, read-only trees,
              non-OSF-Storage providers, and provider roots never render this. */}
          {node.selection?.deleteUrl && (
            <button
              type="button"
              aria-label={`Delete ${node.label}`}
              title={`Delete ${node.label} from OSF`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(node.selection!);
              }}
              className="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
            >
              Delete
            </button>
          )}
        </span>
      )}
    </div>
  );
}
