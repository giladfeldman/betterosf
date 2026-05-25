"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SkeletonNode } from "@/lib/osf/folder-skeleton";
import type { NodeView } from "@/lib/osf/parse";
import type { RegistrationView } from "@/lib/osf/registrations";
import type { FileEntry } from "@/lib/osf/files";
import { UnifiedTreeNode, type TreeNodeData } from "./UnifiedTreeNode";
import { getPref, setPref } from "@/lib/prefs";

type FlatRow = {
  id: string;
  depth: number;
  node: TreeNodeData;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type LoadedFiles = Record<string, FileEntry[]>; // keyed by `${provider}:${materializedPath}`

export function UnifiedTree({
  guid,
  rootTitle,
  skeleton,
  components,
  linkedNodes,
  registrations,
  pinned,
}: {
  guid: string;
  rootTitle: string;
  skeleton: SkeletonNode[];
  components: NodeView[];
  linkedNodes: NodeView[];
  registrations: RegistrationView[];
  pinned: { id: string; title: string }[];
}) {
  // Expand state — initial: all folder paths expanded; registrations collapsed
  const initialExpanded = useMemo(() => {
    const stored = getPref<Record<string, boolean> | null>(`tree.expand.${guid}`, null);
    if (stored) return stored;
    const e: Record<string, boolean> = { "pinned-root": true, "providers-root": true, "components-root": true, "linked-root": true, "registrations-root": false };
    function walk(nodes: SkeletonNode[], parentId: string) {
      for (const n of nodes) {
        const id = `${parentId}/${n.name}`;
        e[id] = true; // all folders expanded by default
        if (n.children.length) walk(n.children, id);
      }
    }
    for (const p of skeleton) walk(p.children, `provider:${p.provider}`);
    return e;
  }, [guid, skeleton]);

  const [expanded, setExpandedState] = useState<Record<string, boolean>>(initialExpanded);
  const setExpanded = useCallback((next: Record<string, boolean>) => {
    setExpandedState(next);
    setPref(`tree.expand.${guid}`, next);
  }, [guid]);

  const [loadedFiles, setLoadedFiles] = useState<LoadedFiles>({});

  // Fetch files for a folder when expanded
  const fetchFiles = useCallback(async (provider: string, materializedPath: string, listingUrl: string) => {
    const key = `${provider}:${materializedPath}`;
    if (loadedFiles[key]) return;
    try {
      const res = await fetch(`/api/files/${guid}/folder?` + new URLSearchParams({ provider, listingUrl }));
      if (!res.ok) return;
      const data: { entries: FileEntry[] } = await res.json();
      const files = data.entries.filter((e) => e.kind === "file");
      setLoadedFiles((prev) => ({ ...prev, [key]: files }));
    } catch {
      // Silent
    }
  }, [guid, loadedFiles]);

  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    const toggle = (id: string) => () => {
      const next = { ...expanded, [id]: !expanded[id] };
      setExpanded(next);
    };

    // Pinned root
    if (pinned.length > 0) {
      rows.push({
        id: "pinned-root", depth: 0, expanded: !!expanded["pinned-root"], hasChildren: true,
        onToggle: toggle("pinned-root"),
        node: { id: "pinned-root", label: "Pinned", kind: "pinned-root" },
      });
      if (expanded["pinned-root"]) {
        for (const p of pinned) {
          rows.push({
            id: `pinned/${p.id}`, depth: 1, expanded: false, hasChildren: false,
            onToggle: () => {},
            node: { id: p.id, label: p.title, kind: "component", href: `/${p.id}` },
          });
        }
      }
    }

    // Provider roots
    rows.push({
      id: "providers-root", depth: 0, expanded: !!expanded["providers-root"], hasChildren: true,
      onToggle: toggle("providers-root"),
      node: { id: "providers-root", label: rootTitle, kind: "provider-root" },
    });

    if (expanded["providers-root"]) {
      for (const provider of skeleton) {
        const providerId = `provider:${provider.provider}`;
        rows.push({
          id: providerId, depth: 1, expanded: !!expanded[providerId], hasChildren: provider.children.length > 0,
          onToggle: () => {
            const next = { ...expanded, [providerId]: !expanded[providerId] };
            setExpanded(next);
            // Lazy-load files for provider root when expanded
            if (!expanded[providerId]) fetchFiles(provider.provider, "/", provider.listingUrl);
          },
          node: { id: providerId, label: provider.name, kind: "provider-root", provider: provider.provider, href: `/${guid}/files/${provider.provider}`, newTab: false },
        });

        if (expanded[providerId]) {
          const emitFolder = (folder: SkeletonNode, depth: number, parentId: string) => {
            const id = `${parentId}/${folder.name}`;
            const childFiles = loadedFiles[`${folder.provider}:${folder.materializedPath}`] ?? [];
            const hasKids = folder.children.length > 0 || childFiles.length > 0;
            rows.push({
              id, depth, expanded: !!expanded[id], hasChildren: hasKids,
              onToggle: () => {
                const next = { ...expanded, [id]: !expanded[id] };
                setExpanded(next);
                if (!expanded[id]) fetchFiles(folder.provider, folder.materializedPath, folder.listingUrl);
              },
              node: { id, label: folder.name, kind: "folder", href: `/${guid}/files/${folder.provider}${folder.materializedPath}` },
            });
            if (expanded[id]) {
              for (const sub of folder.children) emitFolder(sub, depth + 1, id);
              for (const f of childFiles) {
                rows.push({
                  id: `${id}/${f.name}`, depth: depth + 1, expanded: false, hasChildren: false,
                  onToggle: () => {},
                  node: { id: f.id, label: f.name, kind: "file", href: `/${guid}/files/${folder.provider}${folder.materializedPath}${f.name}/view`, newTab: true, size: f.kind === "file" ? f.size : null, modified: f.kind === "file" ? f.modified : undefined },
                });
              }
            }
          };
          for (const folder of provider.children) emitFolder(folder, 2, providerId);
          // Top-level files of provider (loaded into loadedFiles[provider:/])
          const rootFiles = loadedFiles[`${provider.provider}:/`] ?? [];
          for (const f of rootFiles) {
            rows.push({
              id: `provider:${provider.provider}/${f.name}`, depth: 2, expanded: false, hasChildren: false,
              onToggle: () => {},
              node: { id: f.id, label: f.name, kind: "file", href: `/${guid}/files/${provider.provider}/${f.name}/view`, newTab: true, size: f.kind === "file" ? f.size : null },
            });
          }
        }
      }
    }

    // Components root
    if (components.length > 0) {
      rows.push({
        id: "components-root", depth: 0, expanded: !!expanded["components-root"], hasChildren: true,
        onToggle: toggle("components-root"),
        node: { id: "components-root", label: `Components (${components.length})`, kind: "components-root" },
      });
      if (expanded["components-root"]) {
        for (const c of components) {
          rows.push({
            id: `component/${c.id}`, depth: 1, expanded: false, hasChildren: false,
            onToggle: () => {},
            node: { id: c.id, label: c.title || c.id, kind: "component", href: `/${c.id}` },
          });
        }
      }
    }

    // Linked projects root
    if (linkedNodes.length > 0) {
      rows.push({
        id: "linked-root", depth: 0, expanded: !!expanded["linked-root"], hasChildren: true,
        onToggle: toggle("linked-root"),
        node: { id: "linked-root", label: `Linked projects (${linkedNodes.length})`, kind: "linked-root" },
      });
      if (expanded["linked-root"]) {
        for (const l of linkedNodes) {
          rows.push({
            id: `linked/${l.id}`, depth: 1, expanded: false, hasChildren: false,
            onToggle: () => {},
            node: { id: l.id, label: l.title || l.id, kind: "linked", href: `/${l.id}`, newTab: true },
          });
        }
      }
    }

    // Registrations root
    if (registrations.length > 0) {
      rows.push({
        id: "registrations-root", depth: 0, expanded: !!expanded["registrations-root"], hasChildren: true,
        onToggle: toggle("registrations-root"),
        node: { id: "registrations-root", label: `Registrations (${registrations.length})`, kind: "registrations-root" },
      });
      if (expanded["registrations-root"]) {
        for (const r of registrations) {
          rows.push({
            id: `registration/${r.id}`, depth: 1, expanded: false, hasChildren: false,
            onToggle: () => {},
            node: { id: r.id, label: r.title || r.id, kind: "registration", href: `/registrations/${r.id}`, badge: r.public ? undefined : "private" },
          });
        }
      }
    }

    return rows;
  }, [expanded, loadedFiles, skeleton, components, linkedNodes, registrations, pinned, rootTitle, guid, fetchFiles, setExpanded]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const r of flatRows) next[r.id] = true;
    setExpanded(next);
  };
  const collapseAll = () => {
    setExpanded({});
  };

  // Avoid unused-variable lint for useEffect import; effects placed here when needed
  useEffect(() => { /* hook reserved for future scroll-to-selection */ }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-neutral-200 dark:border-neutral-800 text-xs">
        <button type="button" onClick={expandAll} className="hover:underline">Expand all</button>
        <button type="button" onClick={collapseAll} className="hover:underline">Collapse all</button>
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
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
