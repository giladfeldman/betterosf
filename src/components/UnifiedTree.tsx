"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";
import type { ComponentTree, RegistrationTree, LinkedTree } from "@/lib/osf/full-tree";
import type { NodeView } from "@/lib/osf/parse";
import type { RegistrationView } from "@/lib/osf/registrations";
import type { FileEntry } from "@/lib/osf/files";
import { UnifiedTreeNode, type TreeNodeData, type TreeSelectionPayload, type TreeUploadTarget } from "./UnifiedTreeNode";
import { UploadDialog } from "./UploadDialog";
import { OPEN_UPLOAD_EVENT } from "./UploadFilesButton";
import { getPref, setPref } from "@/lib/prefs";
import { listPins, type FavoriteRef } from "@/lib/favorites";

type FlatRow = {
  id: string;
  depth: number;
  node: TreeNodeData;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type LoadedEntries = Record<string, FileEntry[]>; // keyed by `${nodeGuid}|${provider}:${materializedPath}`

const PREFETCH_LIMIT = 12;
const HYDRATION_MAX_ATTEMPTS = 3;

type HydrationKind = "component" | "linked" | "registration";

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
  return `${target.guid}|${target.provider}|${target.path}|${target.listingUrl}`;
}

function collectExpandedProviderIds(task: HydrationTask, skeleton: SkeletonNode[]): string[] {
  const basePrefix = task.kind === "component" ? `component/${task.guid}` : task.kind === "linked" ? `linked/${task.guid}` : `registration/${task.guid}`;
  return skeleton.map((provider) => `${basePrefix}/provider:${provider.provider}`);
}

function skeletonFromFolder(entry: Extract<FileEntry, { kind: "folder" }>, provider: string): SkeletonNode {
  return {
    provider,
    name: entry.name,
    materializedPath: entry.materializedPath,
    listingUrl: entry.listingUrl,
    children: [],
    fileCount: 0,
  };
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
}: {
  guid: string;
  rootTitle: string;
  skeleton: SkeletonNode[];
  components: NodeView[];
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
}) {
  const [pinned, setPinned] = useState<FavoriteRef[]>([]);
  useEffect(() => {
    setPinned(listPins());
  }, []);

  const [componentTreeState, setComponentTreeState] = useState<ComponentTree[]>(componentTrees ?? []);
  const [registrationTreeState, setRegistrationTreeState] = useState<RegistrationTree[]>(registrationTrees ?? []);
  const [linkedTreeState, setLinkedTreeState] = useState<LinkedTree[]>(linkedTrees ?? []);
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
    setHydratedIds({});
    setHydrationFailures({});
    setPriorityHydrationIds([]);
    setHydrationPaused(false);
    setRunningHydrationId(null);
    setRateLimitedUntil(0);
  }, [guid, componentTrees, registrationTrees, linkedTrees]);

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

  const [loadedEntries, setLoadedEntries] = useState<LoadedEntries>({});
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, TreeSelectionPayload>>({});
  const [downloadingSelection, setDownloadingSelection] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<TreeUploadTarget | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // In-flight de-dupe — keep a separate set of keys currently being fetched so
  // mass expand-all doesn't fire the same URL N times.
  const inFlightRef = useRef<Set<string>>(new Set());

  // Fetch files for a folder when expanded. Files are keyed by node guid because
  // the same materializedPath can occur in multiple nodes (root + each component).
  const fetchFiles = useCallback(
    async (nodeGuid: string, provider: string, materializedPath: string, listingUrl: string) => {
      const key = `${nodeGuid}|${provider}:${materializedPath}`;
      if (loadedEntries[key]) return;
      if (inFlightRef.current.has(key)) return;
      inFlightRef.current.add(key);
      setLoadingKeys((prev) => ({ ...prev, [key]: true }));
      try {
        const res = await fetch(
          `/api/files/${nodeGuid}/folder?` + new URLSearchParams({ provider, listingUrl })
        );
        if (!res.ok) return;
        const data: { entries: FileEntry[] } = await res.json();
        setLoadedEntries((prev) => ({ ...prev, [key]: data.entries }));
      } catch {
        // silent
      } finally {
        inFlightRef.current.delete(key);
        setLoadingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [loadedEntries]
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
    return tasks;
  }, [componentTreeState, linkedTreeState, registrationTreeState]);

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
      } else {
        setRegistrationTreeState((prev) => prev.map((item) => item.guid === task.guid ? { ...item, skeleton: nextSkeleton, skipped: false } : item));
      }

      setExpandedState((prev) => {
        const rowId = task.kind === "component" ? `component/${task.guid}` : task.kind === "linked" ? `linked/${task.guid}` : `registration/${task.guid}`;
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

  // Auto-fetch files for every folder that's currently expanded and visible.
  // This makes the initial render (where folders default to expanded) actually
  // show files, instead of requiring users to click-collapse-then-expand.
  // De-duped via loadedEntries + inFlightRef in fetchFiles.
  useEffect(() => {
    const targets: Array<{ nodeGuid: string; provider: string; materializedPath: string; listingUrl: string }> = [];
    function walkProviderSet(nodeGuid: string, providers: SkeletonNode[], basePrefix: string) {
      for (const p of providers) {
        const providerId = `${basePrefix}/provider:${p.provider}`;
        if (!expanded[providerId]) continue;
        targets.push({ nodeGuid, provider: p.provider, materializedPath: "/", listingUrl: p.listingUrl });
        function walkFolder(folder: SkeletonNode, parentId: string) {
          const id = `${parentId}/${folder.name}`;
          if (!expanded[id]) return;
          targets.push({ nodeGuid, provider: folder.provider, materializedPath: folder.materializedPath, listingUrl: folder.listingUrl });
          for (const sub of folder.children) walkFolder(sub, id);
        }
        for (const folder of p.children) walkFolder(folder, providerId);
      }
    }
    if (expanded["providers-root"]) walkProviderSet(guid, skeleton, "root");
    if (componentTreeState) {
      for (const c of componentTreeState) {
        if (c.skipped) continue;
        if (!expanded[`component/${c.guid}`]) continue;
        walkProviderSet(c.guid, c.skeleton, `component/${c.guid}`);
      }
    }
    if (registrationTreeState) {
      for (const r of registrationTreeState) {
        if (r.skipped) continue;
        if (!expanded[`registration/${r.guid}`]) continue;
        walkProviderSet(r.guid, r.skeleton, `registration/${r.guid}`);
      }
    }
    if (linkedTreeState) {
      for (const l of linkedTreeState) {
        if (l.skipped) continue;
        if (!expanded[`linked/${l.guid}`]) continue;
        walkProviderSet(l.guid, l.skeleton, `linked/${l.guid}`);
      }
    }
    for (const t of targets.slice(0, PREFETCH_LIMIT)) {
      void fetchFiles(t.nodeGuid, t.provider, t.materializedPath, t.listingUrl);
    }
  }, [expanded, skeleton, componentTreeState, registrationTreeState, linkedTreeState, guid, fetchFiles]);

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

  const refreshUploadTarget = useCallback(
    (target: TreeUploadTarget) => {
      const key = folderKey(target.guid, target.provider, target.path);
      setLoadedEntries((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      void fetchFiles(target.guid, target.provider, target.path, target.listingUrl);
    },
    [fetchFiles]
  );

  const downloadSelection = useCallback(async () => {
    const items = Object.values(selected);
    if (items.length === 0) return;
    setDownloadingSelection(true);
    try {
      const res = await fetch(`/api/zip/${guid}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `betterosf-selection-${guid}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
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
            },
            uploadTarget: canUploadHere
              ? {
                  guid: nodeGuid,
                  provider: provider.provider,
                  path: "/",
                  name: provider.name,
                  listingUrl: provider.listingUrl,
                  nodeTitle,
                  sourceKind,
                }
              : undefined,
            loading: !!loadingKeys[`${nodeGuid}|${provider.provider}:/`],
          },
        });

        if (!expanded[providerId]) continue;

        const emitFolder = (folder: SkeletonNode, depth: number, parentId: string) => {
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
          rows.push({
            id,
            depth,
            expanded: !!expanded[id],
            hasChildren: hasKids,
            onToggle: () => {
              const next = { ...expanded, [id]: !expanded[id] };
              setExpanded(next);
              if (!expanded[id]) fetchFiles(nodeGuid, folder.provider, folder.materializedPath, folder.listingUrl);
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
              },
              uploadTarget: canUploadHere
                ? {
                    guid: nodeGuid,
                    provider: folder.provider,
                    path: folder.materializedPath,
                    name: folder.name,
                    listingUrl: folder.listingUrl,
                    nodeTitle,
                    sourceKind,
                  }
                : undefined,
              loading: !!loadingKeys[fileKey],
            },
          });
          if (expanded[id]) {
            for (const sub of folder.children) emitFolder(sub, depth + 1, id);
            for (const sub of dynamicFolders) emitFolder(sub, depth + 1, id);
            for (const f of childFiles) {
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
                  },
                },
              });
            }
          }
        };

        for (const folder of provider.children) emitFolder(folder, baseDepth + 1, providerId);

        // Top-level folders/files at provider root (loaded once user expands the provider)
        const rootFileKey = folderKey(nodeGuid, provider.provider, "/");
        const rootEntries = loadedEntries[rootFileKey] ?? [];
        const rootFolders = rootEntries.filter((e) => e.kind === "folder");
        const staticRootFolderPaths = new Set(provider.children.map((child) => child.materializedPath));
        for (const folder of rootFolders) {
          if (staticRootFolderPaths.has(folder.materializedPath)) continue;
          emitFolder(skeletonFromFolder(folder, provider.provider), baseDepth + 1, providerId);
        }
        const rootFiles = rootEntries.filter((e) => e.kind === "file");
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
            node: { id: p.id, label: p.title, kind: "component", href },
          });
        }
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
      emitNodeSubtree(guid, skeleton, "root", 1, true, "project", rootTitle);
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
  }, [expanded, loadedEntries, loadingKeys, skeleton, components, componentTreeState, linkedNodes, linkedTreeState, registrations, registrationTreeState, pinned, rootTitle, guid, fetchFiles, setExpanded, queueHydrationTask, hydrationFailures, runningHydrationId]);

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
    return ids;
  }, [skeleton, componentTreeState, registrationTreeState, linkedTreeState]);

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const id of allExpandableIds) next[id] = true;
    setExpanded(next);
  };
  const collapseAll = () => {
    setExpanded({});
  };
  const selectedCount = Object.keys(selected).length;
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

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-950">
        <button type="button" onClick={expandAll} className="hover:underline">Expand all</button>
        <button type="button" onClick={collapseAll} className="hover:underline">Collapse all</button>
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
        <button
          type="button"
          onClick={() => openUploadDialog()}
          className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
        >
          Upload files
        </button>
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
          </>
        )}
      </div>
      <div ref={parentRef} role="tree" className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = flatRows[vi.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                style={{ position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size }}
              >
                <UnifiedTreeNode
                  node={row.node}
                  depth={row.depth}
                  expanded={row.expanded}
                  hasChildren={row.hasChildren}
                  onToggle={row.onToggle}
                  selectMode={selectMode}
                  selected={row.node.selection ? !!selected[selectionKey(row.node.selection)] : false}
                  onSelect={toggleSelected}
                  onUpload={openUploadDialog}
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
          onTargetChange={setUploadTarget}
          onClose={() => {
            setUploadDialogOpen(false);
            setUploadTarget(null);
          }}
          onComplete={refreshUploadTarget}
        />
      )}
    </div>
  );
}
