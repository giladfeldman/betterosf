import "server-only";
import { collectFolderSkeleton, type SkeletonNode } from "./folder-skeleton";
import { getAllChildren } from "./nodes";
import type { NodeView } from "./parse";

export type ComponentTree = {
  guid: string;
  title: string;
  category: string;
  isPublic: boolean;
  skeleton: SkeletonNode[];
  /** True when we hit the recursion cap and skipped fetching this component's skeleton. */
  skipped: boolean;
};

export type FullProjectTree = {
  rootSkeleton: SkeletonNode[];
  components: ComponentTree[];
  /** Total component count from OSF (may exceed components.length when capped). */
  totalComponents: number;
};

/**
 * Collect the full project tree:
 * - The root node's storage-provider folder skeleton, AND
 * - Each direct component's storage-provider folder skeleton, fetched in parallel.
 *
 * Linked projects and registrations are NOT recursed (they're external / immutable
 * and recursing them invites cycles + huge payloads). Callers fetch their metadata
 * separately and render them as leaf nodes.
 *
 * Caps: at most `maxComponentsToRecurse` components get their skeleton fetched
 * (default 30). The rest appear in the tree as leaf component links — clicking
 * navigates to the component's own page, which will then fetch its own tree.
 */
export async function collectFullTree(
  rootGuid: string,
  opts: { maxComponentsToRecurse?: number } = {}
): Promise<FullProjectTree> {
  const maxComp = opts.maxComponentsToRecurse ?? 30;

  // Parallel: root skeleton + direct children list
  const [rootSkeleton, children] = await Promise.all([
    collectFolderSkeleton(rootGuid).catch((): SkeletonNode[] => []),
    getAllChildren(rootGuid).catch((): NodeView[] => []),
  ]);

  // For the first N components, fetch each one's skeleton in parallel.
  const limit = Math.min(children.length, maxComp);
  const recursed = children.slice(0, limit);
  const skipped = children.slice(limit);

  const recursedTrees: ComponentTree[] = await Promise.all(
    recursed.map(async (c) => ({
      guid: c.id,
      title: c.title || c.id,
      category: c.category,
      isPublic: c.public,
      skeleton: await collectFolderSkeleton(c.id).catch((): SkeletonNode[] => []),
      skipped: false,
    }))
  );

  const skippedTrees: ComponentTree[] = skipped.map((c) => ({
    guid: c.id,
    title: c.title || c.id,
    category: c.category,
    isPublic: c.public,
    skeleton: [],
    skipped: true,
  }));

  return {
    rootSkeleton,
    components: [...recursedTrees, ...skippedTrees],
    totalComponents: children.length,
  };
}
