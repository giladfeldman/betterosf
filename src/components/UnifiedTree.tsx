"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";
import type { ComponentTree, RegistrationTree, LinkedTree } from "@/lib/osf/full-tree";
import type { NodeView } from "@/lib/osf/parse";
import type { RegistrationView } from "@/lib/osf/registrations";
import type { FileEntry } from "@/lib/osf/files";
import { UnifiedTreeNode } from "./UnifiedTreeNode";
import type { TreeNodeData, TreeNodeKind, TreeSelectionPayload, TreeUploadTarget } from "./tree-types";
import { UploadDialog } from "./UploadDialog";
import { DeleteDialog } from "./DeleteDialog";
import { UploadActivityDrawer } from "./UploadActivityDrawer";
import { OPEN_UPLOAD_EVENT } from "./UploadFilesButton";
import type { DroppedNode } from "@/lib/upload/types";
import { getPref, setPref } from "@/lib/prefs";
import { listPins, type FavoriteRef } from "@/lib/favorites";
import { readErrorResponse } from "@/lib/http/read-error";

type FlatRow = {
  id: string;
  depth: number;
  node: TreeNodeData;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type LoadedEntries = Record<string, FileEntry[]>; // keyed by `${nodeGuid}|${provider}:${materializedPath}`

const HYDRATION_MAX_ATTEMPTS = 3;
// Upper bound on folders auto-loaded into the tree before we stop and let the
// rest load on click. Keeps very large trees from hammering OSF, while still
// fully auto-loading typical projects/registrations. Surfaced to the user when
// hit (no silent truncation).
const AUTO_LOAD_MAX_FOLDERS = 400;
// Max concurrent auto-load folder fetches. Keeps the eager tree-fill from
// bursting OSF's anonymous rate limit (429); the pipeline refills as fetches
// settle. User-initiated clicks bypass this and fetch immediately.
const MAX_CONCURRENT_AUTOLOAD = 4;
// Highest numeric "Levels" the depth stepper exposes before "All" (Infinity).
// Most OSF projects are shallow; the cap discourages accidental deep fetches.
const MAX_LEVEL = 5;
// Default depth: show one level under each provider root (osfstorage). Keeps the
// initial render — and OSF folder-listing calls — to a single level until the
// user asks for more via the Levels stepper / "Expand all".
const DEFAULT_MAX_DEPTH = 1;

type HydrationKind = "component" | "linked" | "registration" | "parent";

type HydrationTask = {
  id: string;
  kind: HydrationKind;
  guid: string;
  title: string;
  apiKind: "node" | "registration";
};

type HydrationFailure = {
  message: string;
  attempts: number;
  nextRetryAt: number;
};

function zipHref(nodeGuid: string, provider: string, materializedPath: string): string {
  const path = materializedPath === "/" ? "" : materializedPath.replace(/^\/+|\/+$/g, "");
  return `/api/zip/${nodeGuid}/${provider}${path ? `/${path}` : ""}`;
}

function selectionKey(payload: TreeSelectionPayload): string {
  return `${payload.kind}:${payload.guid}:${payload.provider}:${payload.path}`;
}

function folderKey(nodeGuid: string, provider: string, materializedPath: string): string {
  return `${nodeGuid}|${provider}:${materializedPath}`;
}

function fileHref(nodeGuid: string, provider: string, materializedPath: string, name: string): string {
  const folderPath = materializedPath.endsWith("/") ? materializedPath : `${materializedPath}/`;
  return `/${nodeGuid}/files/view/${provider}${folderPath}${name}`;
}

function fileSelectionPath(materializedPath: string, name: string): string {
  const folderPath = materializedPath.endsWith("/") ? materializedPath : `${materializedPath}/`;
  return `${folderPath}${name}`;
}

function hydrationTaskId(kind: HydrationKind, guid: string): string {
  return `${kind}:${guid}`;
}

function uploadTargetKey(target: TreeUploadTarget): string {
  return `${target.guid}|${target.provider}|${target.path}|${target.listingUrl}|${target.uploadUrl ?? ""}`;
}

// Pinned items carry a FavoriteKind ("project" | "file" | "registration" | …);
// map it to the TreeNodeKind that drives the row icon, so a pinned file shows a
// 📄 and a pinned registration a 🔒 instead of everything showing the component
// glyph. (L8)
function favoriteKindToTreeKind(kind: FavoriteRef["kind"]): TreeNodeKind {
  switch (kind) {
    case "file":
      return "file";
    case "folder":
      return "folder";
    case "registration":
      return "registration";
    case "component":
      return "component";
    // project / preprint / user have no dedicated tree glyph — render as a
    // generic component-style node (the closest existing "navigable resource").
    default:
      return "component";
  }
}

function collectExpandedProviderIds(task: HydrationTask, skeleton: SkeletonNode[]): string[] {
  const basePrefix =
    task.kind === "component"
      ? `component/${task.guid}`
      : task.kind === "linked"
        ? `linked/${task.guid}`
        : task.kind === "parent"
          ? `parent/${task.guid}`
          : `registration/${task.guid}`;
  return skeleton.map((provider) => `${basePrefix}/provider:${provider.provider}`);
}

function skeletonFromFolder(entry: Extract<FileEntry, { kind: "folder" }>, provider: string): SkeletonNode {
  return {
    provider,
    name: entry.name,
    materializedPath: entry.materializedPath,
    listingUrl: entry.listingUrl,
    uploadUrl: entry.uploadUrl,
    newFolderUrl: entry.newFolderUrl,
    deleteUrl: entry.deleteUrl,
    children: [],
    fileCount: 0,
  };
}

// Read the persisted "Levels" pref for a project. Stored as a number, or the
// string "all" for unlimited — Infinity is not JSON-serializable, so the "All"
// sentinel round-trips as "all" and rehydrates here.
function readMaxDepthPref(guid: string): number {
  const v = getPref<number | "all">(`tree.maxDepth.${guid}`, DEFAULT_MAX_DEPTH);
  return v === "all" ? Infinity : v;
}

export function UnifiedTree({
  guid,
  rootTitle,
  skeleton,
  components,
  componentTrees,
  linkedNodes,
  registrations,
  registrationTrees,
  linkedTrees,
  parentTree,
  readOnly = false,
  degraded = false,
}: {
  guid: string;
  rootTitle: string;
  skeleton: SkeletonNode[];
  components: NodeView[];
  /** Hide all upload affordances (registrations are immutable). Default false. */
  readOnly?: boolean;
  /** When provided, components are rendered as expandable sub-trees with their own provider+folder hierarchy. Falls back to flat-list rendering if absent. */
  componentTrees?: ComponentTree[];
  linkedNodes: NodeView[];
  registrations: RegistrationView[];
  /** When provided, each registration is rendered as an expandable sub-tree
   *  with its own provider+folder hierarchy (and its files load on expand).
   *  Falls back to flat leaf-link rendering when absent. */
  registrationTrees?: RegistrationTree[];
  /** When provided, each linked project is rendered as an expandable sub-tree
   *  (parallel to registrationTrees). Falls back to flat leaf-link rendering. */
  linkedTrees?: LinkedTree[];
  /** Immediate OSF parent project (component → containing project). Collapsed
   *  by default; expand hydrates the parent skeleton on demand. */
  parentTree?: LinkedTree | null;
  /** The server-rendered tree was degraded (OSF backpressure during the skeleton
   *  walk) and may be missing folders — show a "partially loaded, refresh" notice. */
  degraded?: boolean;
}) {
  const [pinned, setPinned] = useState<FavoriteRef[]>([]);
  useEffect(() => {
    setPinned(listPins());
  }, []);

  const [componentTreeState, setComponentTreeState] = useState<ComponentTree[]>(componentTrees ?? []);
  const [registrationTreeState, setRegistrationTreeState] = useState<RegistrationTree[]>(registrationTrees ?? []);
  const [linkedTreeState, setLinkedTreeState] = useState<LinkedTree[]>(linkedTrees ?? []);
  const [parentTreeState, setParentTreeState] = useState<LinkedTree | null>(parentTree ?? null);
  const [hydratedIds, setHydratedIds] = useState<Record<string, true>>({});
  const [hydrationFailures, setHydrationFailures] = useState<Record<string, HydrationFailure>>({});
  const [priorityHydrationIds, setPriorityHydrationIds] = useState<string[]>([]);
  const [hydrationPaused, setHydrationPaused] = useState(false);
  const [runningHydrationId, setRunningHydrationId] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);
  const [hydrationNow, setHydrationNow] = useState(Date.now());
  const hydrationInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    setComponentTreeState(componentTrees ?? []);
    setRegistrationTreeState(registrationTrees ?? []);
    setLinkedTreeState(linkedTrees ?? []);
    setParentTreeState(parentTree ?? null);
    setHydratedIds({});
    setHydrationFailures({});
    setPriorityHydrationIds([]);
    setHydrationPaused(false);
    setRunningHydrationId(null);
    setRateLimitedUntil(0);
    setFilesHiddenState(getPref<boolean>(`tree.filesHidden.${guid}`, true));
    setMaxDepthState(readMaxDepthPref(guid));
    setForcedOpen(new Set());
  }, [guid, componentTrees, registrationTrees, linkedTrees, parentTree]);

  // Initial expand state — all folder paths expanded (root + each component);
  // registrations collapsed; linked projects shown but not auto-recursed.
  const initialExpanded = useMemo(() => {
    const stored = getPref<Record<string, boolean> | null>(`tree.expand.${guid}`, null);
    if (stored) return stored;
    const e: Record<string, boolean> = {
      "pinned-root": true,
      "providers-root": true,
      "components-root": true,
      "linked-root": true,
      "registrations-root": false,
    };

    function walkSkeleton(nodes: SkeletonNode[], parentId: string) {
      for (const n of nodes) {
        const id = `${parentId}/${n.name}`;
        e[id] = true;
        if (n.children.length) walkSkeleton(n.children, id);
      }
    }

    // Root project providers and their folder subtree
    for (const p of skeleton) {
      e[`root/provider:${p.provider}`] = true;
      walkSkeleton(p.children, `root/provider:${p.provider}`);
    }

    // Each component: auto-expand the component node + its providers + folders
    if (componentTreeState) {
      for (const c of componentTreeState) {
        e[`component/${c.guid}`] = true;
        for (const p of c.skeleton) {
          e[`component/${c.guid}/provider:${p.provider}`] = true;
          walkSkeleton(p.children, `component/${c.guid}/provider:${p.provider}`);
        }
      }
    }

    return e;
  }, [guid, skeleton, componentTreeState]);

  const [expanded, setExpandedState] = useState<Record<string, boolean>>(initialExpanded);
  const setExpanded = useCallback(
    (next: Record<string, boolean>) => {
      setExpandedState(next);
      setPref(`tree.expand.${guid}`, next);
    },
    [guid]
  );

  // "Directory" view (default): show the whole folder tree, folders only — file
  // leaves are hidden. "Expand all" shows files too. Remembered per project.
  const [filesHidden, setFilesHiddenState] = useState<boolean>(() =>
    getPref<boolean>(`tree.filesHidden.${guid}`, true)
  );
  const setFilesHidden = useCallback(
    (next: boolean) => {
      setFilesHiddenState(next);
      setPref(`tree.filesHidden.${guid}`, next);
    },
    [guid]
  );

  // "Levels": how many folder levels to show/fetch under each provider root
  // (provider root = level 0, its direct children = level 1 = default). Caps both
  // the rendered rows AND the progressive auto-load fetches, so deep trees don't
  // burn OSF calls on levels the user hasn't asked for. Infinity = "All".
  // Remembered per project.
  const [maxDepth, setMaxDepthState] = useState<number>(() => readMaxDepthPref(guid));
  const setMaxDepth = useCallback(
    (next: number) => {
      setMaxDepthState(next);
      setPref(`tree.maxDepth.${guid}`, Number.isFinite(next) ? next : "all");
    },
    [guid]
  );
  // Row ids the user manually opened past the current ceiling — drills a single
  // branch deeper without raising the global level. Cleared by "Expand all".
  const [forcedOpen, setForcedOpen] = useState<Set<string>>(() => new Set());

  const [loadedEntries, setLoadedEntries] = useState<LoadedEntries>({});
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({});
  // Per-folder fetch failures (key → message). Surfaced as a retry affordance.
  const [folderFailures, setFolderFailures] = useState<Record<string, string>>({});
  // Progressive auto-load: whether we hit the folder cap, and whether the user
  // disabled auto-expand via "Collapse all".
  const [autoLoadCapped, setAutoLoadCapped] = useState(false);
  const autoExpandEnabledRef = useRef(true);
  // Bumped by "Retry all" to re-run the auto-load effect for failed folders.
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, TreeSelectionPayload>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Whether THIS user can actually write to OSF right now.
  //
  // `allowUploads` (= !readOnly) only excludes registrations — it is true for anonymous
  // visitors on any ordinary project. That is tolerable for the Upload button, which opens
  // a dialog that then gates on write-status, but NOT for Delete: a destructive control
  // must never render for someone who cannot delete. Defaults to false so the affordance
  // is absent until write access is positively confirmed.
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/osf/write-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { canWrite?: boolean } | null) => {
        if (!cancelled) setCanWrite(Boolean(s?.canWrite));
      })
      .catch(() => {
        /* stay false — fail closed */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [downloadingSelection, setDownloadingSelection] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<TreeUploadTarget | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [droppedNodes, setDroppedNodes] = useState<DroppedNode[] | null>(null);

  // Drag-and-drop intake: read dropped files/folders into a DroppedNode tree,
  // then open the UploadDialog pre-targeted to the dropped-on folder (every drop
  // is confirmed via the dialog — auth, conflicts, and integrity live there).
  const handleDropUpload = useCallback(async (target: TreeUploadTarget, items: DataTransferItem[]) => {
    const { readDroppedEntries } = await import("@/lib/upload/entries");
    const entries = items
      .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
      .filter((e): e is NonNullable<typeof e> => e != null);
    let nodes: DroppedNode[];
    if (entries.length > 0) {
      nodes = await readDroppedEntries(entries as unknown as Parameters<typeof readDroppedEntries>[0]);
    } else {
      nodes = items
        .map((it) => it.getAsFile())
        .filter((f): f is File => f != null)
        .map((file) => ({ kind: "file" as const, name: file.name, file }));
    }
    if (nodes.length === 0) return;
    setUploadTarget(target);
    setDroppedNodes(nodes);
    setUploadDialogOpen(true);
  }, []);

  // In-flight de-dupe — keep a separate set of keys currently being fetched so
  // mass expand-all doesn't fire the same URL N times.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Records the params each folder was fetched with, so a manual "Refresh" can replay
  // them with fresh=1 (the listing key alone doesn't carry the listingUrl).
  const folderParamsRef = useRef<Map<string, { nodeGuid: string; provider: string; materializedPath: string; listingUrl: string }>>(new Map());
  // Mirror of loadedEntries read inside fetchFiles' cache-check. Using a ref keeps
  // fetchFiles' identity STABLE across folder loads — otherwise its dep on
  // loadedEntries made it (and every memo/effect that depends on it, incl. flatRows
  // and the auto-load pipeline) churn on every fetch. (L6)
  const loadedEntriesRef = useRef<LoadedEntries>({});
  useEffect(() => { loadedEntriesRef.current = loadedEntries; }, [loadedEntries]);

  // Fetch files for a folder when expanded. Files are keyed by node guid because
  // the same materializedPath can occur in multiple nodes (root + each component).
  // `force` re-fetches even if cached AND bypasses the server cache (fresh=1) — used
  // after an upload/folder-create and by the manual Refresh button so the tree reflects
  // OSF immediately instead of a stale ≤5-min cached listing.
  const fetchFiles = useCallback(
    async (nodeGuid: string, provider: string, materializedPath: string, listingUrl: string, force = false) => {
      const key = `${nodeGuid}|${provider}:${materializedPath}`;
      folderParamsRef.current.set(key, { nodeGuid, provider, materializedPath, listingUrl });
      if (!force && loadedEntriesRef.current[key]) return;
      if (inFlightRef.current.has(key)) return;
      inFlightRef.current.add(key);
      setLoadingKeys((prev) => ({ ...prev, [key]: true }));
      try {
        const params = new URLSearchParams({ provider, listingUrl });
        if (force) params.set("fresh", "1");
        const res = await fetch(`/api/files/${nodeGuid}/folder?` + params);
        if (!res.ok) {
          const { message } = await readErrorResponse(res);
          throw new Error(message);
        }
        const data: { entries: FileEntry[] } = await res.json();
        setLoadedEntries((prev) => ({ ...prev, [key]: data.entries }));
        // Clear any prior failure for this folder on success.
        setFolderFailures((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch (e) {
        setFolderFailures((prev) => ({
          ...prev,
          [key]: e instanceof Error ? e.message.slice(0, 200) : "Couldn't load this folder",
        }));
      } finally {
        inFlightRef.current.delete(key);
        setLoadingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    []
  );

  const hydrationTasks = useMemo<HydrationTask[]>(() => {
    const tasks: HydrationTask[] = [];
    for (const c of componentTreeState) {
      if (c.skipped) tasks.push({ id: hydrationTaskId("component", c.guid), kind: "component", guid: c.guid, title: c.title, apiKind: "node" });
    }
    for (const l of linkedTreeState) {
      if (l.skipped) tasks.push({ id: hydrationTaskId("linked", l.guid), kind: "linked", guid: l.guid, title: l.title, apiKind: "node" });
    }
    for (const r of registrationTreeState) {
      if (r.skipped) tasks.push({ id: hydrationTaskId("registration", r.guid), kind: "registration", guid: r.guid, title: r.title, apiKind: "registration" });
    }
    if (parentTreeState?.skipped) {
      tasks.push({
        id: hydrationTaskId("parent", parentTreeState.guid),
        kind: "parent",
        guid: parentTreeState.guid,
        title: parentTreeState.title,
        apiKind: "node",
      });
    }
    return tasks;
  }, [componentTreeState, linkedTreeState, registrationTreeState, parentTreeState]);

  const hydrationTaskById = useMemo(() => new Map(hydrationTasks.map((task) => [task.id, task])), [hydrationTasks]);
  const failedHydrationCount = Object.values(hydrationFailures).filter((failure) => failure.attempts >= HYDRATION_MAX_ATTEMPTS).length;
  const successfulHydrationCount = Object.keys(hydratedIds).length;
  const hydrationTotal = successfulHydrationCount + hydrationTasks.length;

  useEffect(() => {
    if (hydrationTasks.length === 0 && rateLimitedUntil <= Date.now()) return;
    const id = window.setInterval(() => setHydrationNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hydrationTasks.length, rateLimitedUntil]);

  const applyHydratedSkeleton = useCallback(
    (task: HydrationTask, nextSkeleton: SkeletonNode[]) => {
      if (task.kind === "component") {
        setComponentTreeState((prev) => prev.map((item) => item.guid === task.guid ? { ...item, skeleton: nextSkeleton, skipped: false } : item));
      } else if (task.kind === "linked") {
        setLinkedTreeState((prev) => prev.map((item) => item.guid === task.guid ? { ...item, skeleton: nextSkeleton, skipped: false } : item));
      } else if (task.kind === "parent") {
        setParentTreeState((prev) => (prev && prev.guid === task.guid ? { ...prev, skeleton: nextSkeleton, skipped: false } : prev));
      } else {
        setRegistrationTreeState((prev) => prev.map((item) => item.guid === task.guid ? { ...item, skeleton: nextSkeleton, skipped: false } : item));
      }

      setExpandedState((prev) => {
        const rowId =
          task.kind === "component"
            ? `component/${task.guid}`
            : task.kind === "linked"
              ? `linked/${task.guid}`
              : task.kind === "parent"
                ? `parent/${task.guid}`
                : `registration/${task.guid}`;
        if (!prev[rowId]) return prev;
        const next = { ...prev };
        for (const id of collectExpandedProviderIds(task, nextSkeleton)) next[id] = true;
        setPref(`tree.expand.${guid}`, next);
        return next;
      });
      setHydratedIds((prev) => ({ ...prev, [task.id]: true }));
      setHydrationFailures((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      setPriorityHydrationIds((prev) => prev.filter((id) => id !== task.id));
    },
    [guid]
  );

  const queueHydrationTask = useCallback((task: HydrationTask) => {
    setHydrationPaused(false);
    setHydrationFailures((prev) => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
    setPriorityHydrationIds((prev) => [task.id, ...prev.filter((id) => id !== task.id)]);
    setHydrationNow(Date.now());
  }, []);

  const nextHydrationTask = useMemo(() => {
    if (hydrationPaused || rateLimitedUntil > hydrationNow) return null;
    const ready = hydrationTasks.filter((task) => {
      const failure = hydrationFailures[task.id];
      return !failure || (failure.attempts < HYDRATION_MAX_ATTEMPTS && failure.nextRetryAt <= hydrationNow);
    });
    if (ready.length === 0) return null;
    for (const id of priorityHydrationIds) {
      const task = ready.find((item) => item.id === id);
      if (task) return task;
    }
    return ready[0] ?? null;
  }, [hydrationFailures, hydrationNow, hydrationPaused, hydrationTasks, priorityHydrationIds, rateLimitedUntil]);

  useEffect(() => {
    if (!nextHydrationTask || hydrationInFlightRef.current) return;
    const task = nextHydrationTask;
    hydrationInFlightRef.current = task.id;
    setRunningHydrationId(task.id);

    async function hydrate() {
      try {
        const res = await fetch(
          `/api/files/${task.guid}/skeleton?` + new URLSearchParams({ kind: task.apiKind }),
          { cache: "no-store" }
        );
        if (res.status === 429) {
          const rawRetry = res.headers.get("retry-after");
          const retrySeconds = rawRetry ? Number.parseInt(rawRetry, 10) : 60;
          const retryMs = Number.isFinite(retrySeconds) ? Math.max(5_000, retrySeconds * 1000) : 60_000;
          setRateLimitedUntil(Date.now() + retryMs);
          return;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || `OSF returned ${res.status}`);
        }
        const data: { skeleton: SkeletonNode[] } = await res.json();
        applyHydratedSkeleton(task, data.skeleton);
      } catch (error) {
        setHydrationFailures((prev) => {
          const attempts = (prev[task.id]?.attempts ?? 0) + 1;
          const backoff = Math.min(45_000, 2_000 * 2 ** Math.max(0, attempts - 1));
          return {
            ...prev,
            [task.id]: {
              message: error instanceof Error ? error.message : "OSF folder load failed",
              attempts,
              nextRetryAt: Date.now() + backoff,
            },
          };
        });
      } finally {
        if (hydrationInFlightRef.current === task.id) hydrationInFlightRef.current = null;
        setRunningHydrationId(null);
        setHydrationNow(Date.now());
      }
    }

    void hydrate();
  }, [applyHydratedSkeleton, nextHydrationTask]);

  // Progressive auto-load: fill the navigator with ALL folders/files without
  // the user clicking through each level. We walk the known folder tree —
  // static skeleton folders AND dynamically-loaded subfolders — auto-expanding
  // each folder the first time we see it and fetching its contents. As each
  // fetch lands, loadedEntries changes and this effect re-runs, cascading one
  // level deeper, until the whole tree is loaded or AUTO_LOAD_MAX_FOLDERS is
  // hit (surfaced via autoLoadCapped, not silently truncated). fetchFiles
  // de-dupes via loadedEntries + inFlightRef, and we respect a user's explicit
  // collapse (an explicit `false` in `expanded`) and "Collapse all".
  useEffect(() => {
    type Target = { nodeGuid: string; provider: string; materializedPath: string; listingUrl: string };
    const targets: Target[] = [];
    const toExpand: Record<string, boolean> = {};

    // `level` = depth below the provider root (provider's direct children = 1).
    const visitFolder = (nodeGuid: string, folder: SkeletonNode, rowId: string, level: number) => {
      // Auto-expand the first time we encounter a folder (undefined = never
      // decided). A user's explicit collapse leaves `false`, which we respect.
      if (autoExpandEnabledRef.current && expanded[rowId] === undefined) toExpand[rowId] = true;
      const open = expanded[rowId] === true || toExpand[rowId] === true;
      if (!open) return;
      // Depth ceiling: never fetch/recurse past the user's "Levels" setting,
      // unless this branch was manually drilled (forcedOpen). Strict `>` so the
      // ceiling level's OWN listing is still fetched — its children are the rows
      // shown at the limit; only the level *below* it is skipped.
      if (level > maxDepth && !forcedOpen.has(rowId)) return;
      const key = folderKey(nodeGuid, folder.provider, folder.materializedPath);
      const entries = loadedEntries[key];
      if (entries === undefined) {
        targets.push({ nodeGuid, provider: folder.provider, materializedPath: folder.materializedPath, listingUrl: folder.listingUrl });
        return; // children unknown until this loads; a later pass recurses
      }
      const staticPaths = new Set(folder.children.map((c) => c.materializedPath));
      for (const c of folder.children) visitFolder(nodeGuid, c, `${rowId}/${c.name}`, level + 1);
      for (const e of entries) {
        if (e.kind === "folder" && !staticPaths.has(e.materializedPath)) {
          visitFolder(nodeGuid, skeletonFromFolder(e, folder.provider), `${rowId}/${e.name}`, level + 1);
        }
      }
    };

    const visitProviderSet = (nodeGuid: string, providers: SkeletonNode[], basePrefix: string) => {
      for (const p of providers) {
        const providerId = `${basePrefix}/provider:${p.provider}`;
        if (!expanded[providerId]) continue;
        const key = folderKey(nodeGuid, p.provider, "/");
        const entries = loadedEntries[key];
        if (entries === undefined) {
          targets.push({ nodeGuid, provider: p.provider, materializedPath: "/", listingUrl: p.listingUrl });
          continue;
        }
        const staticPaths = new Set(p.children.map((c) => c.materializedPath));
        for (const folder of p.children) visitFolder(nodeGuid, folder, `${providerId}/${folder.name}`, 1);
        for (const e of entries) {
          if (e.kind === "folder" && !staticPaths.has(e.materializedPath)) {
            visitFolder(nodeGuid, skeletonFromFolder(e, p.provider), `${providerId}/${e.name}`, 1);
          }
        }
      }
    };

    if (expanded["providers-root"]) visitProviderSet(guid, skeleton, "root");
    for (const c of componentTreeState ?? []) {
      if (!c.skipped && expanded[`component/${c.guid}`]) visitProviderSet(c.guid, c.skeleton, `component/${c.guid}`);
    }
    for (const r of registrationTreeState ?? []) {
      if (!r.skipped && expanded[`registration/${r.guid}`]) visitProviderSet(r.guid, r.skeleton, `registration/${r.guid}`);
    }
    for (const l of linkedTreeState ?? []) {
      if (!l.skipped && expanded[`linked/${l.guid}`]) visitProviderSet(l.guid, l.skeleton, `linked/${l.guid}`);
    }
    if (parentTreeState && !parentTreeState.skipped && expanded[`parent/${parentTreeState.guid}`]) {
      visitProviderSet(parentTreeState.guid, parentTreeState.skeleton, `parent/${parentTreeState.guid}`);
    }

    if (Object.keys(toExpand).length > 0) setExpanded({ ...expanded, ...toExpand });

    if (targets.length > 0) {
      // Bound total distinct folders auto-loaded. knownCount = already-loaded +
      // in-flight; the rest load on click once the cap is hit.
      const knownCount = Object.keys(loadedEntries).length + inFlightRef.current.size;
      const capRoom = Math.max(0, AUTO_LOAD_MAX_FOLDERS - knownCount);
      if (targets.length > capRoom) setAutoLoadCapped(true);
      // Throttle: cap concurrent auto-fetches so we don't burst OSF into a 429.
      // The effect re-runs as each fetch settles (loadingKeys changes), pulling
      // the next batch — a paced pipeline rather than a flood.
      const concurrencyRoom = Math.max(0, MAX_CONCURRENT_AUTOLOAD - inFlightRef.current.size);
      const room = Math.min(capRoom, concurrencyRoom);
      for (const t of targets.slice(0, room)) {
        void fetchFiles(t.nodeGuid, t.provider, t.materializedPath, t.listingUrl);
      }
    }
  }, [expanded, loadedEntries, loadingKeys, skeleton, componentTreeState, registrationTreeState, linkedTreeState, parentTreeState, guid, fetchFiles, setExpanded, retryNonce, maxDepth, forcedOpen]);

  const toggleSelected = useCallback((payload: TreeSelectionPayload, checked: boolean) => {
    const key = selectionKey(payload);
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[key] = payload;
      else delete next[key];
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected({}), []);

  const openDeleteDialog = useCallback(() => setDeleteDialogOpen(true), []);

  // A row's Delete button targets exactly that one item, independent of whatever is
  // ticked in select mode — clicking Delete on a row must never quietly delete the
  // current multi-selection instead.
  const [rowDeleteTarget, setRowDeleteTarget] = useState<TreeSelectionPayload | null>(null);
  const openRowDelete = useCallback((selection: TreeSelectionPayload) => {
    setRowDeleteTarget(selection);
    setDeleteDialogOpen(true);
  }, []);

  // After a delete: drop the rows from selection and force-refresh each affected parent
  // folder. Both are required — clearing the client cache alone leaves the server's
  // ≤5-min cached listing to serve the deleted file straight back.
  const handleDeleted = useCallback(
    (deleted: TreeSelectionPayload[]) => {
      setSelected((prev) => {
        const next = { ...prev };
        for (const item of deleted) delete next[selectionKey(item)];
        return next;
      });
      const parents = new Map<string, { guid: string; provider: string; listingUrl: string }>();
      for (const item of deleted) {
        if (!item.parentListingUrl) continue;
        parents.set(item.parentListingUrl, {
          guid: item.guid,
          provider: item.provider,
          listingUrl: item.parentListingUrl,
        });
      }
      for (const p of parents.values()) {
        const params = folderParamsRef.current;
        // Find the cache key whose recorded listingUrl matches this parent, so the
        // refresh targets the exact folder the tree already has loaded.
        for (const [key, recorded] of params.entries()) {
          if (recorded.listingUrl !== p.listingUrl) continue;
          setLoadedEntries((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          void fetchFiles(recorded.nodeGuid, recorded.provider, recorded.materializedPath, recorded.listingUrl, true);
        }
      }
    },
    [fetchFiles]
  );

  // After an in-place rename: drop the now-stale selection entry (its path and name
  // changed) and force-refresh the parent folder, exactly as handleDeleted does — the
  // server's ≤5-min cached listing would otherwise keep serving the old name.
  const handleRenamed = useCallback(
    (item: TreeSelectionPayload) => {
      setSelected((prev) => {
        const next = { ...prev };
        delete next[selectionKey(item)];
        return next;
      });
      if (!item.parentListingUrl) return;
      const params = folderParamsRef.current;
      for (const [key, recorded] of params.entries()) {
        if (recorded.listingUrl !== item.parentListingUrl) continue;
        setLoadedEntries((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        void fetchFiles(recorded.nodeGuid, recorded.provider, recorded.materializedPath, recorded.listingUrl, true);
      }
    },
    [fetchFiles]
  );

  const refreshUploadTarget = useCallback(
    (target: TreeUploadTarget) => {
      // force=true bypasses both the stale-closure early-return and the server cache,
      // so a just-created folder / uploaded file shows up immediately (no page reload).
      void fetchFiles(target.guid, target.provider, target.path, target.listingUrl, true);
    },
    [fetchFiles]
  );

  // Manual "Refresh" — re-fetch every already-loaded folder with fresh OSF data.
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    const params = Array.from(folderParamsRef.current.values());
    setFolderFailures({});
    setLoadedEntries({});
    setRefreshing(true);
    try {
      await Promise.all(
        params.map((p) => fetchFiles(p.nodeGuid, p.provider, p.materializedPath, p.listingUrl, true))
      );
    } finally {
      setRefreshing(false);
    }
  }, [fetchFiles]);

  const downloadSelection = useCallback(async () => {
    const items = Object.values(selected);
    if (items.length === 0) return;
    setDownloadingSelection(true);
    setDownloadError(null);

    // Browser-direct first: every byte goes OSF → this tab, so a 5 GB selection costs
    // BetterOSF nothing and is not capped by the 4.5 MB serverless response limit. Falls
    // through to the server route on ANY failure — the CORS behaviour it relies on is
    // undocumented (see osfBrowserAuthHeader), and a private project needs the session's
    // own token, which lives on the server.
    const directable = items.every((i) => i.kind === "folder" || Boolean(i.providerPath));
    if (directable) {
      try {
        const { downloadSelection: directDownload } = await import("@/lib/download/browser-zip");
        await directDownload(
          guid,
          items.map((i) =>
            i.kind === "folder"
              ? { kind: "folder" as const, guid: i.guid, provider: i.provider, path: i.path, name: i.name }
              : {
                  kind: "file" as const,
                  guid: i.guid,
                  provider: i.provider,
                  path: i.path,
                  name: i.name,
                  providerPath: i.providerPath!,
                },
          ),
          { token: null },
        );
        setDownloadingSelection(false);
        return;
      } catch {
        /* fall through to the server route, which still works for private projects */
      }
    }

    try {
      const res = await fetch(`/api/zip/${guid}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const { message } = await readErrorResponse(res);
        throw new Error(message || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `betterosf-selection-${guid}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke: revoking synchronously after click() can abort the download
      // in Safari (and occasionally Chrome) before the browser reads the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      // Surface the error instead of silently swallowing it.
      setDownloadError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingSelection(false);
    }
  }, [guid, selected]);

  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];

    const toggle = (id: string) => () => {
      const next = { ...expanded, [id]: !expanded[id] };
      setExpanded(next);
    };

    /**
     * Emit a node's provider+folder subtree into rows[].
     * Used for the root project AND for each component.
     */
    function emitNodeSubtree(
      nodeGuid: string,
      providers: SkeletonNode[],
      basePrefix: string,
      baseDepth: number,
      allowUploads: boolean,
      sourceKind: TreeUploadTarget["sourceKind"],
      nodeTitle: string
    ) {
      for (const provider of providers) {
        const providerId = `${basePrefix}/provider:${provider.provider}`;
        const canUploadHere = allowUploads && provider.provider === "osfstorage";
        // Stricter than canUploadHere: also requires a confirmed write-capable session,
        // so a signed-out visitor never sees a Delete control at all.
        const canDeleteHere = canUploadHere && canWrite;
        rows.push({
          id: providerId,
          depth: baseDepth,
          expanded: !!expanded[providerId],
          hasChildren: true,
          onToggle: () => {
            const next: Record<string, boolean> = { ...expanded, [providerId]: !expanded[providerId] };
            // Cascade-expand: when opening a provider-root (especially the
            // osfstorage placeholder), auto-expand every descendant folder so
            // the user doesn't have to click through each level. Symmetric on
            // collapse: clear all descendant entries.
            const cascadeOpen = !expanded[providerId];
            function walk(nodes: SkeletonNode[], parentId: string) {
              for (const n of nodes) {
                const id = `${parentId}/${n.name}`;
                if (cascadeOpen) next[id] = true;
                else delete next[id];
                if (n.children.length) walk(n.children, id);
              }
            }
            walk(provider.children, providerId);
            setExpanded(next);
            if (cascadeOpen) fetchFiles(nodeGuid, provider.provider, "/", provider.listingUrl);
          },
          node: {
            id: providerId,
            label: provider.name,
            kind: "provider-root",
            provider: provider.provider,
            href: `/${nodeGuid}/files/${provider.provider}`,
            newTab: false,
            fileCount: provider.fileCount,
            downloadHref: zipHref(nodeGuid, provider.provider, "/"),
            selection: {
              kind: "folder",
              guid: nodeGuid,
              provider: provider.provider,
              path: "/",
              name: provider.name,
              // No deleteUrl on a provider root, deliberately: this IS the storage root.
              // resolveDeleteUrl refuses it server-side anyway (a Waterbutler root delete
              // recursively wipes all contents), and an absent affordance beats one that
              // always errors.
            },
            uploadTarget: canUploadHere
              ? {
                  guid: nodeGuid,
                  provider: provider.provider,
                  path: "/",
                  name: provider.name,
                  listingUrl: provider.listingUrl,
                  uploadUrl: provider.uploadUrl,
                  newFolderUrl: provider.newFolderUrl,
                  nodeTitle,
                  sourceKind,
                }
              : undefined,
            loading: !!loadingKeys[folderKey(nodeGuid, provider.provider, "/")],
            failed: !!folderFailures[folderKey(nodeGuid, provider.provider, "/")],
            failedMessage: folderFailures[folderKey(nodeGuid, provider.provider, "/")],
            retry: { guid: nodeGuid, provider: provider.provider, path: "/", listingUrl: provider.listingUrl },
          },
        });

        if (!expanded[providerId]) continue;

        // `parentListingUrl` is the listing URL of the folder CONTAINING this one. It is
        // threaded down so a delete can refresh the right folder afterwards, and so a
        // folder backup can locate itself among its siblings to expand.
        const emitFolder = (folder: SkeletonNode, depth: number, parentId: string, parentListingUrl: string) => {
          const id = `${parentId}/${folder.name}`;
          const fileKey = folderKey(nodeGuid, folder.provider, folder.materializedPath);
          const childEntries = loadedEntries[fileKey];
          const childFiles = (childEntries ?? []).filter((e) => e.kind === "file");
          const loadedChildFolders = (childEntries ?? []).filter((e) => e.kind === "folder");
          const staticFolderPaths = new Set(folder.children.map((child) => child.materializedPath));
          const dynamicFolders = loadedChildFolders
            .filter((child) => !staticFolderPaths.has(child.materializedPath))
            .map((child) => skeletonFromFolder(child, folder.provider));
          const hasKids = folder.children.length > 0 || childEntries === undefined || childEntries.length > 0;
          // This folder sits at/over the "Levels" ceiling: its child FOLDERS are
          // hidden until the user drills this branch (forcedOpen). Files of an
          // in-bounds open folder still render — only deeper folders are gated.
          const atDepthLimit = depth - baseDepth >= maxDepth && !forcedOpen.has(id);
          const hasHiddenChildFolders =
            atDepthLimit && (folder.children.length > 0 || dynamicFolders.length > 0);
          rows.push({
            id,
            depth,
            // Render as collapsed when a depth-limited folder still has hidden
            // child folders, so the chevron reads "click to drill deeper" (▶)
            // rather than "click to collapse" (▼) — the per-subtree drill cue.
            expanded: !!expanded[id] && !hasHiddenChildFolders,
            hasChildren: hasKids,
            onToggle: () => {
              // Drill: an expanded folder with depth-hidden child folders reveals
              // just this branch one level deeper (forcedOpen) without raising the
              // global "Levels" setting — instead of collapsing.
              if (hasHiddenChildFolders) {
                setForcedOpen((prev) => new Set(prev).add(id));
                if (!expanded[id]) setExpanded({ ...expanded, [id]: true });
                fetchFiles(nodeGuid, folder.provider, folder.materializedPath, folder.listingUrl);
                return;
              }
              const willOpen = !expanded[id];
              setExpanded({ ...expanded, [id]: willOpen });
              if (willOpen) {
                // Opening a collapsed folder that is itself past the ceiling also
                // drills this branch (e.g. one the user previously collapsed).
                if (depth - baseDepth >= maxDepth) {
                  setForcedOpen((prev) => new Set(prev).add(id));
                }
                fetchFiles(nodeGuid, folder.provider, folder.materializedPath, folder.listingUrl);
              }
            },
            node: {
              id,
              label: folder.name,
              kind: "folder",
              href: `/${nodeGuid}/files/${folder.provider}${folder.materializedPath}`,
              fileCount: folder.fileCount,
              downloadHref: zipHref(nodeGuid, folder.provider, folder.materializedPath),
              selection: {
                kind: "folder",
                guid: nodeGuid,
                provider: folder.provider,
                path: folder.materializedPath,
                name: folder.name,
                // Gated on canUploadHere — the same gate uploads use. Registrations and
                // read-only trees never set it, so no delete affordance can render.
                deleteUrl: canDeleteHere ? folder.deleteUrl : undefined,
                parentListingUrl: canDeleteHere ? parentListingUrl : undefined,
              },
              uploadTarget: canUploadHere
                ? {
                    guid: nodeGuid,
                    provider: folder.provider,
                    path: folder.materializedPath,
                    name: folder.name,
                    listingUrl: folder.listingUrl,
                    uploadUrl: folder.uploadUrl,
                    newFolderUrl: folder.newFolderUrl,
                    nodeTitle,
                    sourceKind,
                  }
                : undefined,
              loading: !!loadingKeys[fileKey],
              failed: !!folderFailures[fileKey],
              failedMessage: folderFailures[fileKey],
              retry: { guid: nodeGuid, provider: folder.provider, path: folder.materializedPath, listingUrl: folder.listingUrl },
            },
          });
          if (expanded[id]) {
            // Depth ceiling (atDepthLimit computed above): stop emitting child
            // FOLDERS at/over the limit unless this branch was manually drilled.
            // Child FILES of an open, in-bounds folder always render — they're
            // the leaf content the user opened this folder to see.
            if (!atDepthLimit) {
              for (const sub of folder.children) emitFolder(sub, depth + 1, id, folder.listingUrl);
              for (const sub of dynamicFolders) emitFolder(sub, depth + 1, id, folder.listingUrl);
            }
            for (const f of childFiles) {
              if (filesHidden) break; // "Directory" view: folders only
              if (f.kind !== "file") continue;
              rows.push({
                id: `${id}/${f.name}`,
                depth: depth + 1,
                expanded: false,
                hasChildren: false,
                onToggle: () => {},
                node: {
                  id: f.id,
                  label: f.name,
                  kind: "file",
                  // Same tab: /files/view/<path> renders the SplitPane shell so
                  // the tree on the left stays mounted and the right pane swaps
                  // to the viewer. Right-click → "Open in new tab" still works
                  // because the href is a real anchor.
                  href: fileHref(nodeGuid, folder.provider, folder.materializedPath, f.name),
                  newTab: false,
                  size: f.size,
                  modified: f.modified,
                  selection: {
                    kind: "file",
                    guid: nodeGuid,
                    provider: folder.provider,
                    path: fileSelectionPath(folder.materializedPath, f.name),
                    name: f.name,
                    downloadUrl: f.downloadUrl,
                    providerPath: f.providerPath,
                    deleteUrl: canDeleteHere ? f.deleteUrl : undefined,
                    parentListingUrl: canDeleteHere ? folder.listingUrl : undefined,
                  },
                },
              });
            }
          }
        };

        for (const folder of provider.children) emitFolder(folder, baseDepth + 1, providerId, provider.listingUrl);

        // Top-level folders/files at provider root (loaded once user expands the provider)
        const rootFileKey = folderKey(nodeGuid, provider.provider, "/");
        const rootEntries = loadedEntries[rootFileKey] ?? [];
        const rootFolders = rootEntries.filter((e) => e.kind === "folder");
        const staticRootFolderPaths = new Set(provider.children.map((child) => child.materializedPath));
        for (const folder of rootFolders) {
          if (staticRootFolderPaths.has(folder.materializedPath)) continue;
          emitFolder(skeletonFromFolder(folder, provider.provider), baseDepth + 1, providerId, provider.listingUrl);
        }
        const rootFiles = filesHidden ? [] : rootEntries.filter((e) => e.kind === "file");
        for (const f of rootFiles) {
          if (f.kind !== "file") continue;
          rows.push({
            id: `${providerId}/${f.name}`,
            depth: baseDepth + 1,
            expanded: false,
            hasChildren: false,
            onToggle: () => {},
            node: {
              id: f.id,
              label: f.name,
              kind: "file",
              href: fileHref(nodeGuid, provider.provider, "/", f.name),
              newTab: false,
              size: f.size,
              selection: {
                kind: "file",
                guid: nodeGuid,
                provider: provider.provider,
                path: fileSelectionPath("/", f.name),
                name: f.name,
                downloadUrl: f.downloadUrl,
                providerPath: f.providerPath,
                deleteUrl: canDeleteHere ? f.deleteUrl : undefined,
                parentListingUrl: canDeleteHere ? provider.listingUrl : undefined,
              },
            },
          });
        }
      }
    }

    // Pinned root
    if (pinned.length > 0) {
      rows.push({
        id: "pinned-root",
        depth: 0,
        expanded: !!expanded["pinned-root"],
        hasChildren: true,
        onToggle: toggle("pinned-root"),
        node: { id: "pinned-root", label: "Pinned", kind: "pinned-root" },
      });
      if (expanded["pinned-root"]) {
        for (const p of pinned) {
          let href: string;
          if (p.kind === "registration") {
            href = `/registrations/${p.id}`;
          } else if (p.kind === "file") {
            const firstSlash = p.id.indexOf("/");
            href = firstSlash > 0
              ? `/${p.id.slice(0, firstSlash)}/files/view/${p.id.slice(firstSlash + 1)}`
              : `/${p.id}`;
          } else {
            href = `/${p.id}`;
          }
          rows.push({
            id: `pinned/${p.kind}/${p.id}`,
            depth: 1,
            expanded: false,
            hasChildren: false,
            onToggle: () => {},
            node: { id: p.id, label: p.title, kind: favoriteKindToTreeKind(p.kind), href },
          });
        }
      }
    }

    // Parent project (above current project providers; collapsed by default)
    if (parentTreeState) {
      const parentId = `parent/${parentTreeState.guid}`;
      const task: HydrationTask = {
        id: hydrationTaskId("parent", parentTreeState.guid),
        kind: "parent",
        guid: parentTreeState.guid,
        title: parentTreeState.title,
        apiKind: "node",
      };
      const failure = hydrationFailures[task.id];
      const failed = failure && failure.attempts >= HYDRATION_MAX_ATTEMPTS;
      const parentHasContent = parentTreeState.skeleton.length > 0;
      rows.push({
        id: parentId,
        depth: 0,
        expanded: !!expanded[parentId],
        hasChildren: parentHasContent || parentTreeState.skipped,
        onToggle: () => {
          const nextOpen = !expanded[parentId];
          setExpanded({ ...expanded, [parentId]: nextOpen });
          if (nextOpen && parentTreeState.skipped) queueHydrationTask(task);
        },
        node: {
          id: parentTreeState.guid,
          label: `Parent: ${parentTreeState.title}`,
          kind: "parent",
          href: `/${parentTreeState.guid}`,
          badge: parentTreeState.skipped ? (failed ? "retry" : "indexing") : parentTreeState.isPublic ? undefined : "private",
          loading: parentTreeState.skipped && runningHydrationId === task.id,
          guid: parentTreeState.guid,
        },
      });
      if (expanded[parentId] && !parentTreeState.skipped) {
        emitNodeSubtree(parentTreeState.guid, parentTreeState.skeleton, parentId, 1, true, "project", parentTreeState.title);
      }
    }

    // Root project providers
    rows.push({
      id: "providers-root",
      depth: 0,
      expanded: !!expanded["providers-root"],
      hasChildren: skeleton.length > 0,
      onToggle: toggle("providers-root"),
      node: { id: "providers-root", label: rootTitle, kind: "provider-root", href: `/${guid}` },
    });

    if (expanded["providers-root"]) {
      emitNodeSubtree(guid, skeleton, "root", 1, !readOnly, "project", rootTitle);
    }

    // Components root
    if (components.length > 0) {
      rows.push({
        id: "components-root",
        depth: 0,
        expanded: !!expanded["components-root"],
        hasChildren: true,
        onToggle: toggle("components-root"),
        node: { id: "components-root", label: `Components (${components.length})`, kind: "components-root" },
      });

      if (expanded["components-root"]) {
        if (componentTreeState.length > 0) {
          for (const c of componentTreeState) {
            const compId = `component/${c.guid}`;
            const task: HydrationTask = { id: hydrationTaskId("component", c.guid), kind: "component", guid: c.guid, title: c.title, apiKind: "node" };
            const failure = hydrationFailures[task.id];
            const failed = failure && failure.attempts >= HYDRATION_MAX_ATTEMPTS;
            const compHasContent = c.skeleton.length > 0;
            rows.push({
              id: compId,
              depth: 1,
              expanded: !!expanded[compId],
              hasChildren: compHasContent || c.skipped,
              onToggle: () => {
                const nextOpen = !expanded[compId];
                setExpanded({ ...expanded, [compId]: nextOpen });
                if (nextOpen && c.skipped) queueHydrationTask(task);
              },
              node: {
                id: c.guid,
                label: c.title,
                kind: "component",
                href: `/${c.guid}`,
                badge: c.skipped ? (failed ? "retry" : "indexing") : c.isPublic ? undefined : "private",
                loading: c.skipped && runningHydrationId === task.id,
              },
            });
            if (expanded[compId] && !c.skipped) {
              emitNodeSubtree(c.guid, c.skeleton, compId, 2, true, "component", c.title);
            }
          }
        } else {
          // Fallback: flat list (used when caller didn't provide componentTrees)
          for (const c of components) {
            rows.push({
              id: `component/${c.id}`,
              depth: 1,
              expanded: false,
              hasChildren: false,
              onToggle: () => {},
              node: { id: c.id, label: c.title || c.id, kind: "component", href: `/${c.id}` },
            });
          }
        }
      }
    }

    // Linked projects (expandable sub-trees when linkedTrees provided —
    // symmetric to components/registrations).
    if (linkedNodes.length > 0) {
      rows.push({
        id: "linked-root",
        depth: 0,
        expanded: !!expanded["linked-root"],
        hasChildren: true,
        onToggle: toggle("linked-root"),
        node: { id: "linked-root", label: `Linked projects (${linkedNodes.length})`, kind: "linked-root" },
      });
      if (expanded["linked-root"]) {
        if (linkedTreeState.length > 0) {
          for (const l of linkedTreeState) {
            const linkedId = `linked/${l.guid}`;
            const task: HydrationTask = { id: hydrationTaskId("linked", l.guid), kind: "linked", guid: l.guid, title: l.title, apiKind: "node" };
            const failure = hydrationFailures[task.id];
            const failed = failure && failure.attempts >= HYDRATION_MAX_ATTEMPTS;
            const linkedHasContent = l.skeleton.length > 0;
            rows.push({
              id: linkedId,
              depth: 1,
              expanded: !!expanded[linkedId],
              hasChildren: linkedHasContent || l.skipped,
              onToggle: () => {
                const nextOpen = !expanded[linkedId];
                setExpanded({ ...expanded, [linkedId]: nextOpen });
                if (nextOpen && l.skipped) queueHydrationTask(task);
              },
              node: {
                id: l.guid,
                label: l.title,
                kind: "linked",
                href: `/${l.guid}`,
                // Keep same-tab so clicking expands; if the user wants the
                // linked project in a new tab, right-click → open-in-new-tab.
                newTab: false,
                badge: l.skipped ? (failed ? "retry" : "indexing") : l.isPublic ? undefined : "private",
                loading: l.skipped && runningHydrationId === task.id,
              },
            });
            if (expanded[linkedId] && !l.skipped) {
              emitNodeSubtree(l.guid, l.skeleton, linkedId, 2, true, "linked", l.title);
            }
          }
        } else {
          // Fallback: leaf links (used when caller didn't provide linkedTrees)
          for (const l of linkedNodes) {
            rows.push({
              id: `linked/${l.id}`,
              depth: 1,
              expanded: false,
              hasChildren: false,
              onToggle: () => {},
              node: { id: l.id, label: l.title || l.id, kind: "linked", href: `/${l.id}`, newTab: true },
            });
          }
        }
      }
    }

    // Registrations
    if (registrations.length > 0) {
      rows.push({
        id: "registrations-root",
        depth: 0,
        expanded: !!expanded["registrations-root"],
        hasChildren: true,
        onToggle: toggle("registrations-root"),
        node: { id: "registrations-root", label: `Registrations (${registrations.length})`, kind: "registrations-root" },
      });
      if (expanded["registrations-root"]) {
        if (registrationTreeState.length > 0) {
          // Registrations as expandable sub-trees. Each registration row is
          // a folder-style container; expanding it reveals its provider/folder
          // hierarchy via emitNodeSubtree (kind-agnostic since the API route
          // `/api/files/<guid>/folder?listingUrl=…` works for both nodes and
          // registrations as long as the listingUrl starts with v2/).
          for (const r of registrationTreeState) {
            const regId = `registration/${r.guid}`;
            const task: HydrationTask = { id: hydrationTaskId("registration", r.guid), kind: "registration", guid: r.guid, title: r.title, apiKind: "registration" };
            const failure = hydrationFailures[task.id];
            const failed = failure && failure.attempts >= HYDRATION_MAX_ATTEMPTS;
            const regHasContent = r.skeleton.length > 0;
            rows.push({
              id: regId,
              depth: 1,
              expanded: !!expanded[regId],
              hasChildren: regHasContent || r.skipped,
              onToggle: () => {
                const nextOpen = !expanded[regId];
                setExpanded({ ...expanded, [regId]: nextOpen });
                if (nextOpen && r.skipped) queueHydrationTask(task);
              },
              node: {
                id: r.guid,
                label: r.title || r.guid,
                kind: "registration",
                href: `/registrations/${r.guid}`,
                badge: r.skipped ? (failed ? "retry" : "indexing") : r.isPublic ? undefined : "private",
                loading: r.skipped && runningHydrationId === task.id,
              },
            });
            if (expanded[regId] && !r.skipped) {
              emitNodeSubtree(r.guid, r.skeleton, regId, 2, false, undefined, r.title || r.guid);
            }
          }
        } else {
          // Fallback: leaf links (used when caller didn't provide registrationTrees)
          for (const r of registrations) {
            rows.push({
              id: `registration/${r.id}`,
              depth: 1,
              expanded: false,
              hasChildren: false,
              onToggle: () => {},
              node: { id: r.id, label: r.title || r.id, kind: "registration", href: `/registrations/${r.id}`, badge: r.public ? undefined : "private" },
            });
          }
        }
      }
    }

    return rows;
  }, [expanded, filesHidden, maxDepth, forcedOpen, setForcedOpen, loadedEntries, loadingKeys, folderFailures, readOnly, canWrite, skeleton, components, componentTreeState, linkedNodes, linkedTreeState, registrations, registrationTreeState, parentTreeState, pinned, rootTitle, guid, fetchFiles, setExpanded, queueHydrationTask, hydrationFailures, runningHydrationId]);

  const uploadTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: TreeUploadTarget[] = [];
    for (const row of flatRows) {
      const target = row.node.uploadTarget;
      if (!target) continue;
      const key = uploadTargetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    return targets;
  }, [flatRows]);

  const openUploadDialog = useCallback(
    (target?: TreeUploadTarget) => {
      setUploadTarget(target ?? uploadTargets[0] ?? null);
      setUploadDialogOpen(true);
    },
    [uploadTargets]
  );

  useEffect(() => {
    function onOpenUpload(event: Event) {
      const detail = (event as CustomEvent<{ guid?: string; target?: TreeUploadTarget }>).detail;
      if (detail?.guid && detail.guid !== guid) return;
      openUploadDialog(detail?.target);
    }
    window.addEventListener(OPEN_UPLOAD_EVENT, onOpenUpload);
    return () => window.removeEventListener(OPEN_UPLOAD_EVENT, onOpenUpload);
  }, [guid, openUploadDialog]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  // ---- Keyboard navigation (WAI-ARIA tree pattern) ----
  // Roving tabindex: exactly one treeitem is in the tab order at a time; Arrow
  // keys move the active row, Left/Right collapse/expand (or hop to parent/child),
  // Home/End jump to the ends, Enter/Space activate. The active row is scrolled
  // into view (it may be virtualized out) and then focused via its data-index.
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  // Clamp the active index if the row set shrinks (collapse/refresh).
  useEffect(() => {
    setActiveRowIndex((i) => Math.min(Math.max(0, i), Math.max(0, flatRows.length - 1)));
  }, [flatRows.length]);

  const focusRow = useCallback((index: number, scroll = true) => {
    const clamped = Math.min(Math.max(0, index), flatRows.length - 1);
    if (clamped < 0) return;
    setActiveRowIndex(clamped);
    if (scroll) virtualizer.scrollToIndex(clamped, { align: "auto" });
    // The node may need a tick to mount after scrollToIndex; focus on next frame.
    requestAnimationFrame(() => {
      const el = parentRef.current?.querySelector<HTMLElement>(`[data-tree-index="${clamped}"]`);
      el?.focus();
    });
  }, [flatRows.length, virtualizer]);

  const handleTreeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const row = flatRows[activeRowIndex];
    if (!row) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(activeRowIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(activeRowIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(flatRows.length - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.hasChildren && !row.expanded) {
          row.onToggle();
        } else if (row.hasChildren && row.expanded) {
          focusRow(activeRowIndex + 1); // into first child
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.hasChildren && row.expanded) {
          row.onToggle(); // collapse
        } else {
          // Hop to the nearest shallower ancestor row.
          for (let i = activeRowIndex - 1; i >= 0; i -= 1) {
            if (flatRows[i]!.depth < row.depth) { focusRow(i); break; }
          }
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (row.hasChildren) row.onToggle();
        break;
      default:
        break;
    }
  }, [activeRowIndex, flatRows, focusRow]);

  // Recursively collect every expandable id from the full skeleton + componentTrees.
  // This makes "Expand all" actually expand ALL levels in one click instead of one level.
  const allExpandableIds = useMemo(() => {
    const ids: string[] = [
      "pinned-root",
      "providers-root",
      "components-root",
      "linked-root",
      "registrations-root",
    ];
    function walkSkeleton(nodes: SkeletonNode[], parentId: string) {
      for (const n of nodes) {
        const id = `${parentId}/${n.name}`;
        ids.push(id);
        if (n.children.length) walkSkeleton(n.children, id);
      }
    }
    // Root provider tree
    for (const p of skeleton) {
      ids.push(`root/provider:${p.provider}`);
      walkSkeleton(p.children, `root/provider:${p.provider}`);
    }
    // Component sub-trees
    if (componentTreeState) {
      for (const c of componentTreeState) {
        ids.push(`component/${c.guid}`);
        for (const p of c.skeleton) {
          ids.push(`component/${c.guid}/provider:${p.provider}`);
          walkSkeleton(p.children, `component/${c.guid}/provider:${p.provider}`);
        }
      }
    }
    // Registration sub-trees
    if (registrationTreeState) {
      for (const r of registrationTreeState) {
        ids.push(`registration/${r.guid}`);
        for (const p of r.skeleton) {
          ids.push(`registration/${r.guid}/provider:${p.provider}`);
          walkSkeleton(p.children, `registration/${r.guid}/provider:${p.provider}`);
        }
      }
    }
    // Linked-project sub-trees
    if (linkedTreeState) {
      for (const l of linkedTreeState) {
        ids.push(`linked/${l.guid}`);
        for (const p of l.skeleton) {
          ids.push(`linked/${l.guid}/provider:${p.provider}`);
          walkSkeleton(p.children, `linked/${l.guid}/provider:${p.provider}`);
        }
      }
    }
    // Parent project sub-tree
    if (parentTreeState) {
      ids.push(`parent/${parentTreeState.guid}`);
      for (const p of parentTreeState.skeleton) {
        ids.push(`parent/${parentTreeState.guid}/provider:${p.provider}`);
        walkSkeleton(p.children, `parent/${parentTreeState.guid}/provider:${p.provider}`);
      }
    }
    return ids;
  }, [skeleton, componentTreeState, registrationTreeState, linkedTreeState, parentTreeState]);

  // "Directory" (default view): expand the whole folder tree but keep file
  // leaves hidden — the structure-only overview.
  const showDirectory = () => {
    autoExpandEnabledRef.current = true;
    const next: Record<string, boolean> = {};
    for (const id of allExpandableIds) next[id] = true;
    setExpanded(next);
    setFilesHidden(true);
    setMaxDepth(Infinity); // "Directory" means the whole tree — lift the ceiling
    setForcedOpen(new Set()); // global "All" supersedes per-branch overrides
  };
  const expandAll = () => {
    // Re-enable progressive auto-load so dynamically-discovered subfolders keep
    // expanding too (allExpandableIds only covers the static skeleton).
    autoExpandEnabledRef.current = true;
    const next: Record<string, boolean> = {};
    for (const id of allExpandableIds) next[id] = true;
    setExpanded(next);
    setFilesHidden(false); // Expand all reveals files too
    setMaxDepth(Infinity); // "Expand all" means every level — lift the ceiling
    setForcedOpen(new Set()); // global "All" supersedes per-branch overrides
  };
  // "Collapse all": collapse down to the provider roots (e.g. osfstorage).
  // Structural containers — the project, Components/Registrations/Linked roots,
  // and each component/registration/linked node — stay expanded; provider roots
  // and folders collapse. (Not a full collapse to the very top.)
  const collapseAll = () => {
    autoExpandEnabledRef.current = false;
    const next: Record<string, boolean> = {
      "pinned-root": true,
      "providers-root": true,
      "components-root": true,
      "linked-root": true,
      "registrations-root": true,
    };
    for (const c of componentTreeState) next[`component/${c.guid}`] = true;
    for (const r of registrationTreeState) next[`registration/${r.guid}`] = true;
    for (const l of linkedTreeState) next[`linked/${l.guid}`] = true;
    setExpanded(next);
  };
  const selectedCount = Object.keys(selected).length;
  // Only osfstorage items in a writable tree carry a deleteUrl (see the emitters), so
  // this count IS the delete gate — the UI never has to re-derive permission.
  const deletableItems = useMemo(() => Object.values(selected).filter((s) => Boolean(s.deleteUrl)), [selected]);
  const deletableCount = deletableItems.length;
  const rateLimitSeconds = Math.max(0, Math.ceil((rateLimitedUntil - hydrationNow) / 1000));
  const hydrationProgress = hydrationTotal > 0 ? Math.round((successfulHydrationCount / hydrationTotal) * 100) : 100;
  const showHydrationWidget = hydrationTasks.length > 0 || failedHydrationCount > 0 || Boolean(runningHydrationId);
  const firstHydrationFailure = Object.values(hydrationFailures).find((failure) => failure.attempts >= HYDRATION_MAX_ATTEMPTS);
  const hydrationStatusText = rateLimitSeconds > 0
    ? `OSF asked us to slow down. Resuming in ${rateLimitSeconds}s.`
    : hydrationPaused
    ? "Folder indexing paused."
    : failedHydrationCount > 0
    ? `${failedHydrationCount} folder ${failedHydrationCount === 1 ? "section" : "sections"} need retry: ${firstHydrationFailure?.message ?? "OSF folder load failed"}`
    : hydrationTasks.length > 0
    ? runningHydrationId
      ? `Loading ${hydrationTaskById.get(runningHydrationId)?.title ?? "folders"}...`
      : "Loading remaining project folders..."
    : "Folder index complete.";

  // Root-tree folder load status (distinct from the component/registration
  // sub-tree hydration widget above).
  const loadingFolderCount = Object.keys(loadingKeys).length;
  const failedFolderCount = Object.keys(folderFailures).length;
  // Folder listings fetched from OSF so far (one OSF listing per loaded folder).
  // Surfaced read-only so the cost of expanding the tree is visible.
  const loadedFolderCount = Object.keys(loadedEntries).length;
  const folderStatus =
    failedFolderCount > 0
      ? `Couldn't load ${failedFolderCount} folder${failedFolderCount === 1 ? "" : "s"} — retry below.`
      : loadingFolderCount > 0
      ? `Loading folders… (${loadingFolderCount} in progress)`
      : autoLoadCapped
      ? "Large tree — deeper folders load when you open them."
      : null;
  const retryAllFolders = () => {
    setFolderFailures({});
    setRetryNonce((n) => n + 1);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={showDirectory}
          title="Show the whole folder tree, folders only (no files)"
          className={`hover:underline ${filesHidden ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}
        >
          Directory
        </button>
        <button type="button" onClick={expandAll} className={`hover:underline ${!filesHidden ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}>Expand all</button>
        <button type="button" onClick={collapseAll} className="hover:underline">Collapse all</button>

        {/* Depth control: how many folder levels to show/fetch under each
            storage root. Default 1 keeps the tree shallow and OSF calls low. */}
        <div
          className="inline-flex items-center gap-1 border-l border-neutral-200 pl-2 dark:border-neutral-800"
          title="How many folder levels to show under each storage root (osfstorage). Higher = more OSF requests."
        >
          <span className="text-neutral-500 dark:text-neutral-400">Levels</span>
          <button
            type="button"
            aria-label="Show fewer levels"
            disabled={Number.isFinite(maxDepth) && maxDepth <= 1}
            onClick={() => setMaxDepth(Number.isFinite(maxDepth) ? Math.max(1, maxDepth - 1) : MAX_LEVEL)}
            className="rounded border border-neutral-300 px-1.5 py-0.5 leading-none hover:bg-neutral-50 disabled:text-neutral-300 disabled:hover:bg-transparent dark:border-neutral-700 dark:hover:bg-neutral-900 dark:disabled:text-neutral-600"
          >
            −
          </button>
          <span className="min-w-[2.5ch] text-center tabular-nums" aria-live="polite">
            {Number.isFinite(maxDepth) ? maxDepth : "All"}
          </span>
          <button
            type="button"
            aria-label="Show more levels"
            disabled={!Number.isFinite(maxDepth)}
            onClick={() => setMaxDepth(Number.isFinite(maxDepth) ? (maxDepth >= MAX_LEVEL ? Infinity : maxDepth + 1) : Infinity)}
            className="rounded border border-neutral-300 px-1.5 py-0.5 leading-none hover:bg-neutral-50 disabled:text-neutral-300 disabled:hover:bg-transparent dark:border-neutral-700 dark:hover:bg-neutral-900 dark:disabled:text-neutral-600"
          >
            +
          </button>
        </div>

        {/* Explicit files toggle (the same flag Directory/Expand all set). */}
        <button
          type="button"
          onClick={() => setFilesHidden(!filesHidden)}
          aria-pressed={!filesHidden}
          title={filesHidden ? "Currently hiding files (folders only) — click to show files" : "Currently showing files — click to hide them"}
          className={`rounded border px-2 py-0.5 ${!filesHidden ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}
        >
          {filesHidden ? "Show files" : "Hide files"}
        </button>

        {/* Read-only: folder listings fetched from OSF this session. */}
        {loadedFolderCount > 0 && (
          <span className="tabular-nums text-neutral-400 dark:text-neutral-500" title="Folder listings fetched from OSF this session">
            {loadedFolderCount} loaded
          </span>
        )}

        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshing}
          title="Re-fetch every loaded folder from OSF (bypasses cache)"
          className="inline-flex items-center gap-1 hover:underline disabled:text-neutral-400 disabled:no-underline"
        >
          <span className={refreshing ? "inline-block animate-spin" : "inline-block"} aria-hidden="true">⟳</span>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectMode((on) => !on);
            if (selectMode) clearSelection();
          }}
          className={`rounded border px-2 py-0.5 ${selectMode ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}
        >
          {selectMode ? "Done" : "Select"}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => openUploadDialog()}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
          >
            Upload files
          </button>
        )}
        {selectMode && (
          <>
            <span className="text-neutral-500">{selectedCount} selected</span>
            <button type="button" onClick={clearSelection} disabled={selectedCount === 0} className="hover:underline disabled:text-neutral-500 disabled:no-underline">
              Clear
            </button>
            <button
              type="button"
              onClick={downloadSelection}
              disabled={selectedCount === 0 || downloadingSelection}
              className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 disabled:text-neutral-500 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {downloadingSelection ? "Preparing..." : "Download selected"}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={openDeleteDialog}
                disabled={selectedCount === 0 || deletableCount === 0}
                title={
                  deletableCount < selectedCount
                    ? `${selectedCount - deletableCount} of ${selectedCount} can't be deleted (read-only or not OSF Storage)`
                    : undefined
                }
                className="rounded border border-red-300 px-2 py-0.5 font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-500 disabled:hover:bg-transparent dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
              >
                Delete selected
              </button>
            )}
            {/* Never silently drop undeletable items from a destructive batch — say so. */}
            {selectMode && deletableCount < selectedCount && selectedCount > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                {selectedCount - deletableCount} of {selectedCount} can&apos;t be deleted
              </span>
            )}
          </>
        )}
      </div>
      {degraded && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          <span className="truncate">
            OSF was busy while loading this project, so the tree may be incomplete.
          </span>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing}
            className="ml-auto shrink-0 rounded border border-amber-300 px-1.5 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900"
          >
            {refreshing ? "Refreshing…" : "⟳ Reload"}
          </button>
        </div>
      )}
      {downloadError && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
          <span className="truncate">Download failed: {downloadError}</span>
          <button type="button" onClick={() => setDownloadError(null)} className="ml-auto shrink-0 rounded border border-red-300 px-1.5 py-0.5 font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900">
            Dismiss
          </button>
        </div>
      )}
      {folderStatus && (
        <div
          className={`flex items-center gap-2 border-b px-2 py-1 text-xs ${
            failedFolderCount > 0
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
          }`}
        >
          {failedFolderCount === 0 && loadingFolderCount > 0 && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />
          )}
          <span className="truncate">{folderStatus}</span>
          {failedFolderCount > 0 && (
            <button
              type="button"
              onClick={retryAllFolders}
              className="ml-auto shrink-0 rounded border border-red-300 px-1.5 py-0.5 font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
            >
              ⟳ Retry all
            </button>
          )}
        </div>
      )}
      <div
        ref={parentRef}
        role="tree"
        aria-label={`${rootTitle} file tree`}
        tabIndex={-1}
        onKeyDown={handleTreeKeyDown}
        className="flex-1 overflow-auto focus:outline-none"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = flatRows[vi.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
              >
                <UnifiedTreeNode
                  node={row.node}
                  depth={row.depth}
                  expanded={row.expanded}
                  hasChildren={row.hasChildren}
                  onToggle={row.onToggle}
                  treeIndex={vi.index}
                  tabIndex={vi.index === activeRowIndex ? 0 : -1}
                  onFocusRow={() => setActiveRowIndex(vi.index)}
                  selectMode={selectMode}
                  selected={row.node.selection ? !!selected[selectionKey(row.node.selection)] : false}
                  onSelect={toggleSelected}
                  onUpload={openUploadDialog}
                  onDelete={openRowDelete}
                  onRenamed={handleRenamed}
                  onCreateFolder={refreshUploadTarget}
                  onDropUpload={handleDropUpload}
                  onRetry={
                    row.node.retry
                      ? () => {
                          const r = row.node.retry!;
                          // Clear cached failure + entries so fetchFiles re-runs.
                          setFolderFailures((prev) => {
                            const next = { ...prev };
                            delete next[folderKey(r.guid, r.provider, r.path)];
                            return next;
                          });
                          void fetchFiles(r.guid, r.provider, r.path, r.listingUrl, true);
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      {showHydrationWidget && (
        <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                Loading project folders {Math.min(successfulHydrationCount, hydrationTotal)}/{hydrationTotal}
              </p>
              <p className="mt-0.5 truncate text-neutral-600 dark:text-neutral-400" title={hydrationStatusText}>{hydrationStatusText}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setHydrationPaused((paused) => !paused)}
                className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                {hydrationPaused ? "Resume" : "Pause"}
              </button>
              {failedHydrationCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setHydrationFailures({});
                    setHydrationPaused(false);
                    setHydrationNow(Date.now());
                  }}
                  className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Retry failed
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800" aria-hidden="true">
            <div className="h-full rounded bg-blue-500 transition-all" style={{ width: `${hydrationProgress}%` }} />
          </div>
        </div>
      )}
      {uploadDialogOpen && (
        <UploadDialog
          target={uploadTarget}
          targets={uploadTargets}
          initialNodes={droppedNodes ?? undefined}
          onTargetChange={setUploadTarget}
          onClose={() => {
            setUploadDialogOpen(false);
            setUploadTarget(null);
            setDroppedNodes(null);
          }}
          onComplete={refreshUploadTarget}
        />
      )}
      {deleteDialogOpen && (rowDeleteTarget ? [rowDeleteTarget] : deletableItems).length > 0 && (
        <DeleteDialog
          guid={guid}
          projectTitle={rootTitle || guid}
          items={rowDeleteTarget ? [rowDeleteTarget] : deletableItems}
          onClose={() => {
            setDeleteDialogOpen(false);
            setRowDeleteTarget(null);
          }}
          onDeleted={handleDeleted}
        />
      )}
      <UploadActivityDrawer />
    </div>
  );
}
