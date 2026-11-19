import "server-only";
import { collectFolderSkeleton, type SkeletonNode } from "./folder-skeleton";
import { getAllChildren, getAllLinkedNodes, getParentNode } from "./nodes";
import { getNodeRegistrations, type RegistrationView } from "./registrations";
import type { NodeView } from "./parse";

export type ComponentTree = {
  guid: string;
  title: string;
  category: string;
  isPublic: boolean;
  skeleton: SkeletonNode[];
  /** True when we hit the recursion cap and skipped fetching this component's skeleton. */
  skipped: boolean;
  /** This component's own component count from OSF; undefined = OSF did not say (unknown, not 0). */
  childCount?: number;
};

export type RegistrationTree = {
  guid: string;
  title: string;
  dateRegistered: string;
  isPublic: boolean;
  skeleton: SkeletonNode[];
  skipped: boolean;
};

export type LinkedTree = {
  guid: string;
  title: string;
  category: string;
  isPublic: boolean;
  skeleton: SkeletonNode[];
  skipped: boolean;
  /** The linked project's own component count; undefined = unknown. */
  childCount?: number;
};

export type FullProjectTree = {
  rootSkeleton: SkeletonNode[];
  components: ComponentTree[];
  /** Total component count from OSF (may exceed components.length when capped). */
  totalComponents: number;
  /** True when OSF's component list could not be fetched — the count is UNKNOWN, not 0. */
  componentsFailed?: boolean;
  /** Same, for the registration and linked-project lists (d-99070d). */
  registrationsFailed?: boolean;
  linkedFailed?: boolean;
  /** Folder skeletons for each registration of this project. */
  registrationTrees: RegistrationTree[];
  totalRegistrations: number;
  /** Folder skeletons for each linked project of this project. */
  linkedTrees: LinkedTree[];
  totalLinked: number;
  /**
   * Immediate OSF parent project, when this node is a component/child.
   * Skeleton starts skipped so expand-in-tree hydrates on demand (no extra
   * full skeleton fetch on every page load).
   */
  parentTree: LinkedTree | null;
  /** True when the ROOT folder skeleton fetch failed (OSF 429/503/timeout) and
   *  was degraded to empty — i.e. this tree may be missing folders that exist on
   *  OSF. Lets the UI show "partially loaded — refresh" instead of a silent empty
   *  project. Absent/false means the (possibly empty) tree is authoritative. */
  degraded?: boolean;
};

/** Canonical empty tree — the fail-soft fallback shared by every caller. */
/**
 * One component's / registration's / linked project's folder skeleton, raced against its
 * timeout. A timeout or a failure is NOT an empty item (d-db0b03): it comes back as
 * `skipped: true`, which the tree hydrates in the browser on its own, exactly like an item
 * past the recursion cap. Before, it came back as `skeleton: []` + `skipped: false` and the
 * tree showed the component as having no files.
 */
async function skeletonOrHydrateLater(
  walk: Promise<SkeletonNode[]>,
  timeoutMs: number,
): Promise<{ skeleton: SkeletonNode[]; skipped: boolean }> {
  const FAILED = Symbol("skeleton-failed");
  const result = await raceTimeout<SkeletonNode[] | typeof FAILED>(walk, timeoutMs, FAILED).catch(
    (): typeof FAILED => FAILED,
  );
  return result === FAILED ? { skeleton: [], skipped: true } : { skeleton: result, skipped: false };
}

export const EMPTY_TREE: FullProjectTree = {
  rootSkeleton: [],
  components: [],
  totalComponents: 0,
  registrationTrees: [],
  totalRegistrations: 0,
  linkedTrees: [],
  totalLinked: 0,
  parentTree: null,
};

/**
 * Race a promise against a timeout. Returns the resolved value or a sentinel.
 */
async function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

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
 * (default 5 — Vercel's 60s function budget combined with OSF's per-call latency
 * means more than that risks timeouts on multi-component projects like Many Labs).
 * Plus a per-component timeout (default 8s): a slow component yields an empty
 * skeleton instead of blocking the whole page. The rest appear in the tree as
 * leaf component links — clicking navigates to the component's own page, which
 * will then fetch its own tree.
 */
export async function collectFullTree(
  rootGuid: string,
  opts: {
    maxComponentsToRecurse?: number;
    maxRegistrationsToRecurse?: number;
    maxLinkedToRecurse?: number;
    componentTimeoutMs?: number;
    rootTimeoutMs?: number;
    /** When set, resolve the parent node for the navigator (skipped skeleton). */
    parentId?: string | null;
  } = {}
): Promise<FullProjectTree> {
  const maxComp = opts.maxComponentsToRecurse ?? 5;
  const maxReg = opts.maxRegistrationsToRecurse ?? 3;
  const maxLinked = opts.maxLinkedToRecurse ?? 3;
  const componentTimeoutMs = opts.componentTimeoutMs ?? 8_000;
  const rootTimeoutMs = opts.rootTimeoutMs ?? 15_000;

  // Sentinel distinguishes "root skeleton fetch failed/timed-out" from "fetch
  // succeeded with no folders" — only the former is a degraded (incomplete) tree.
  const SKELETON_FAILED = Symbol("skeleton-failed");
  // Parallel: root skeleton + direct children list + registrations + linked + parent.
  const [rootSkeletonResult, childrenResult, registrationsResult, linkedResult, parentNode] = await Promise.all([
    raceTimeout<SkeletonNode[] | typeof SKELETON_FAILED>(
      collectFolderSkeleton(rootGuid),
      rootTimeoutMs,
      SKELETON_FAILED
    ).catch((): typeof SKELETON_FAILED => SKELETON_FAILED),
    // null, not [], on failure: "this project has no components" and "we could not
    // ask" must not render the same (df9tj showed "Components 0" for 100 components).
    getAllChildren(rootGuid).catch((): NodeView[] | null => null),
    // Same for registrations and linked projects (d-99070d).
    getNodeRegistrations(rootGuid).catch((): RegistrationView[] | null => null),
    getAllLinkedNodes(rootGuid).catch((): NodeView[] | null => null),
    getParentNode(opts.parentId),
  ]);
  const registrationsFailed = registrationsResult === null;
  const linkedFailed = linkedResult === null;
  const registrations = registrationsResult ?? [];
  const linkedNodes = linkedResult ?? [];
  const degraded = rootSkeletonResult === SKELETON_FAILED;
  const componentsFailed = childrenResult === null;
  const children = childrenResult ?? [];
  const rootSkeleton = degraded ? [] : rootSkeletonResult;

  // Parent is metadata-only on first paint; expand-in-tree hydrates the skeleton.
  const parentTree: LinkedTree | null = parentNode
    ? {
        guid: parentNode.id,
        title: parentNode.title || parentNode.id,
        category: parentNode.category,
        isPublic: parentNode.public,
        skeleton: [],
        skipped: true,
      }
    : null;

  // For the first N components, fetch each one's skeleton in parallel — each
  // racing its own timeout so one slow component can't sink the whole page.
  const compLimit = Math.min(children.length, maxComp);
  const compRecursed = children.slice(0, compLimit);
  const compSkipped = children.slice(compLimit);

  const recursedTrees: ComponentTree[] = await Promise.all(
    compRecursed.map(async (c) => ({
      guid: c.id,
      title: c.title || c.id,
      category: c.category,
      isPublic: c.public,
      ...(await skeletonOrHydrateLater(collectFolderSkeleton(c.id), componentTimeoutMs)),
      ...(c.childCount !== undefined ? { childCount: c.childCount } : {}),
    }))
  );

  const skippedTrees: ComponentTree[] = compSkipped.map((c) => ({
    guid: c.id,
    title: c.title || c.id,
    category: c.category,
    isPublic: c.public,
    skeleton: [],
    skipped: true,
    ...(c.childCount !== undefined ? { childCount: c.childCount } : {}),
  }));

  // Same pattern for registrations — capped + timeout + fail-soft. Registrations
  // live under /v2/registrations/<guid>/files/ so we pass kind:"registration".
  const regLimit = Math.min(registrations.length, maxReg);
  const regRecursed = registrations.slice(0, regLimit);
  const regSkipped = registrations.slice(regLimit);

  const recursedRegs: RegistrationTree[] = await Promise.all(
    regRecursed.map(async (r) => ({
      guid: r.id,
      title: r.title || r.id,
      dateRegistered: r.dateRegistered,
      isPublic: r.public,
      ...(await skeletonOrHydrateLater(collectFolderSkeleton(r.id, { kind: "registration" }), componentTimeoutMs)),
    }))
  );

  const skippedRegs: RegistrationTree[] = regSkipped.map((r) => ({
    guid: r.id,
    title: r.title || r.id,
    dateRegistered: r.dateRegistered,
    isPublic: r.public,
    skeleton: [],
    skipped: true,
  }));

  // Same pattern for linked projects — capped + timeout + fail-soft.
  const linkedLimit = Math.min(linkedNodes.length, maxLinked);
  const linkedRecursed = linkedNodes.slice(0, linkedLimit);
  const linkedSkipped = linkedNodes.slice(linkedLimit);

  const recursedLinked: LinkedTree[] = await Promise.all(
    linkedRecursed.map(async (l) => ({
      guid: l.id,
      title: l.title || l.id,
      category: l.category,
      isPublic: l.public,
      ...(await skeletonOrHydrateLater(collectFolderSkeleton(l.id), componentTimeoutMs)),
      ...(l.childCount !== undefined ? { childCount: l.childCount } : {}),
    }))
  );

  const skippedLinked: LinkedTree[] = linkedSkipped.map((l) => ({
    guid: l.id,
    title: l.title || l.id,
    category: l.category,
    isPublic: l.public,
    skeleton: [],
    skipped: true,
    ...(l.childCount !== undefined ? { childCount: l.childCount } : {}),
  }));

  return {
    rootSkeleton,
    components: [...recursedTrees, ...skippedTrees],
    totalComponents: children.length,
    componentsFailed,
    registrationsFailed,
    linkedFailed,
    registrationTrees: [...recursedRegs, ...skippedRegs],
    totalRegistrations: registrations.length,
    linkedTrees: [...recursedLinked, ...skippedLinked],
    totalLinked: linkedNodes.length,
    parentTree,
    degraded,
  };
}
