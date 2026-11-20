/** A crumb with no `href` is a non-link label, used for a step whose target is unknown. */
export type Crumb = { label: string; href?: string };

/** Label shown when a parent exists (or may exist) but OSF did not return it. */
export const PARENT_NOT_LOADED_LABEL = "Parent project (could not load)";

/**
 * The parent-project crumb for a node, from its resolved tree. A failed parent lookup is
 * shown as "could not load", never dropped: dropping it reads as "this is a top-level
 * project", a true-looking state built from an unknown (d-628841).
 */
export function parentCrumbs(tree: {
  parentTree: { guid: string; title: string } | null;
  parentFailed?: boolean;
}): Crumb[] {
  if (tree.parentTree) return [{ label: tree.parentTree.title || tree.parentTree.guid, href: `/${tree.parentTree.guid}` }];
  if (tree.parentFailed) return [{ label: PARENT_NOT_LOADED_LABEL }];
  return [];
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const display = crumbs.length <= 7 ? crumbs : [
    crumbs[0]!,
    { label: "…", href: crumbs[crumbs.length - 4]?.href },
    ...crumbs.slice(-3),
  ];

  // A horizontal scroller here hides the DEEPEST crumb, not the first: an LTR
  // overflow container starts at scrollLeft 0, so the trail runs off the right
  // edge with no scrollbar on a phone. Wrapping keeps every crumb visible and
  // costs at most a second line (mobile-ux rule M1).
  return (
    <nav aria-label="Breadcrumb" className="sticky top-0 z-10 flex flex-wrap items-center gap-x-1 overflow-visible border-b border-neutral-200 bg-white/95 px-4 py-2 text-sm text-neutral-600 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 dark:text-neutral-400">
      {display.map((c, i) => (
        <span key={`${c.href}:${i}`}>
          {i > 0 && <span aria-hidden> › </span>}
          {c.label === "…" ? (
            <span className="text-neutral-400" title="More segments hidden">…</span>
          ) : c.href === undefined ? (
            <span className="text-amber-700 dark:text-amber-300" title="OSF did not answer this lookup just now; refresh to try again">{c.label}</span>
          ) : (
            <a href={c.href} className="hover:underline">{c.label}</a>
          )}
        </span>
      ))}
    </nav>
  );
}
