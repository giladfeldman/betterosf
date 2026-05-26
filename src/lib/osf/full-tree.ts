import "server-only";
import { collectFolderSkeleton, type SkeletonNode } from "./folder-skeleton";
import { getAllChildren } from "./nodes";
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
};

export type RegistrationTree = {
  guid: string;
  title: string;
  dateRegistered: string;
  isPublic: boolean;
  skeleton: SkeletonNode[];
  skipped: boolean;
};

export type FullProjectTree = {
  rootSkeleton: SkeletonNode[];
  components: ComponentTree[];
  /** Total component count from OSF (may exceed components.length when capped). */
  totalComponents: number;
  /** Folder skeletons for each registration of this project. */
  registrationTrees: RegistrationTree[];
  totalRegistrations: number;
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
    componentTimeoutMs?: number;
    rootTimeoutMs?: number;
  } = {}
): Promise<FullProjectTree> {
  const maxComp = opts.maxComponentsToRecurse ?? 5;
  const maxReg = opts.maxRegistrationsToRecurse ?? 3;
  const componentTimeoutMs = opts.componentTimeoutMs ?? 8_000;
  const rootTimeoutMs = opts.rootTimeoutMs ?? 15_000;

  // Parallel: root skeleton + direct children list + registrations list,
  // each with timeout / fail-soft.
  const [rootSkeleton, children, registrations] = await Promise.all([
    raceTimeout(collectFolderSkeleton(rootGuid), rootTimeoutMs, [] as SkeletonNode[]).catch((): SkeletonNode[] => []),
    getAllChildren(rootGuid).catch((): NodeView[] => []),
    getNodeRegistrations(rootGuid).catch((): RegistrationView[] => []),
  ]);

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
      skeleton: await raceTimeout(
        collectFolderSkeleton(c.id),
        componentTimeoutMs,
        [] as SkeletonNode[]
      ).catch((): SkeletonNode[] => []),
      skipped: false,
    }))
  );

  const skippedTrees: ComponentTree[] = compSkipped.map((c) => ({
    guid: c.id,
    title: c.title || c.id,
    category: c.category,
    isPublic: c.public,
    skeleton: [],
    skipped: true,
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
      skeleton: await raceTimeout(
        collectFolderSkeleton(r.id, { kind: "registration" }),
        componentTimeoutMs,
        [] as SkeletonNode[]
      ).catch((): SkeletonNode[] => []),
      skipped: false,
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

  return {
    rootSkeleton,
    components: [...recursedTrees, ...skippedTrees],
    totalComponents: children.length,
    registrationTrees: [...recursedRegs, ...skippedRegs],
    totalRegistrations: registrations.length,
  };
}
