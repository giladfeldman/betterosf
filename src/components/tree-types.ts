// Shared, dependency-free type definitions for the file-tree UI.
//
// These live in their own module (not in UnifiedTreeNode.tsx) so that
// NewFolderControl can reference `TreeUploadTarget` without importing
// UnifiedTreeNode — which imports NewFolderControl back, forming a circular
// import. Types are erased at build time, but the cycle is still real to
// bundlers/madge, so the seam belongs here. No "use client" needed: types only.

export type TreeNodeKind =
  | "pinned-root"
  | "provider-root"
  | "components-root"
  | "linked-root"
  | "registrations-root"
  | "folder"
  | "file"
  | "component"
  | "linked"
  | "registration";

export type TreeSelectionPayload =
  | {
      kind: "file";
      guid: string;
      provider: string;
      path: string;
      name: string;
      downloadUrl: string;
    }
  | {
      kind: "folder";
      guid: string;
      provider: string;
      path: string;
      name: string;
    };

export type TreeUploadTarget = {
  guid: string;
  provider: string;
  path: string;
  name: string;
  listingUrl: string;
  uploadUrl?: string;
  newFolderUrl?: string;
  nodeTitle?: string;
  sourceKind?: "project" | "component" | "linked";
};

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
  downloadHref?: string;
  selection?: TreeSelectionPayload;
  uploadTarget?: TreeUploadTarget;
  loading?: boolean;
  /** This folder's last fetch failed; show a retry affordance. */
  failed?: boolean;
  /** Error message for the failed fetch (tooltip on the retry control). */
  failedMessage?: string;
  /** Params to re-fetch this folder's contents (used by the retry control). */
  retry?: { guid: string; provider: string; path: string; listingUrl: string };
};
