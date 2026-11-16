// Pure rules for the navigator's component sections (no React, unit-tested in
// tests/unit/nested-components.test.ts). UnifiedTree calls these; keeping them here
// lets the cost rules be pinned without rendering the tree.

/** A section that still needs its folder skeleton loaded. Row id = `${kind}/${guid}`. */
export type SectionTask = { id: string; kind: string; guid: string };

/**
 * Which un-indexed sections load now.
 *
 * - Top-level sections (components, linked projects, registrations, parent): all of
 *   them in the background when there are at most `max`, as before; above that, only
 *   the ones the user has opened. Each load is several OSF calls, so a 100-component
 *   project must not fire 100 of them on every visit.
 * - Nested components: only when opened, never in the background.
 */
export function selectHydrationTasks<T extends SectionTask>(
  top: T[],
  nested: T[],
  expanded: Record<string, boolean>,
  max: number
): T[] {
  const isOpen = (t: T) => expanded[`${t.kind}/${t.guid}`] === true;
  const chosen = [...(top.length <= max ? top : top.filter(isOpen)), ...nested.filter(isOpen)];
  const seen = new Set<string>();
  return chosen.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/**
 * Whether a node may have components of its own. OSF's count is `undefined` when it
 * was not reported — that is unknown, so the row stays openable; only a known 0
 * rules components out.
 */
export function mayHaveComponents(childCount: number | undefined): boolean {
  return childCount !== 0;
}

/**
 * Which nodes' component lists to fetch now: open rows that may have components and
 * whose list has not been requested yet (any status counts as requested, so a failed
 * list waits for an explicit retry instead of looping).
 */
export function componentListsToFetch(
  nodes: { rowId: string; guid: string; childCount?: number }[],
  expanded: Record<string, boolean>,
  requested: Record<string, unknown>
): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (expanded[n.rowId] !== true) continue;
    if (!mayHaveComponents(n.childCount)) continue;
    if (n.guid in requested) continue;
    if (!out.includes(n.guid)) out.push(n.guid);
  }
  return out;
}
