import "server-only";
import { collectFullTree, type FullProjectTree } from "./full-tree";
import { collectFolderSkeleton } from "./folder-skeleton";
import { getNode, getAllLinkedNodes } from "./nodes";
import { getRegistration, getNodeRegistrations, type RegistrationView } from "./registrations";
import { OsfError } from "./types";
import type { NodeView } from "./parse";

export const EMPTY_TREE: FullProjectTree = {
  rootSkeleton: [],
  components: [],
  totalComponents: 0,
  registrationTrees: [],
  totalRegistrations: 0,
  linkedTrees: [],
  totalLinked: 0,
};

const TREE_OPTS = {
  maxComponentsToRecurse: 3,
  maxRegistrationsToRecurse: 1,
  maxLinkedToRecurse: 1,
  componentTimeoutMs: 5_000,
  rootTimeoutMs: 10_000,
} as const;

export type ResourceKind = "node" | "registration";

export type ResourceTree = {
  kind: ResourceKind;
  title: string;
  fullTree: FullProjectTree;
  linked: NodeView[];
  registrations: RegistrationView[];
  /** NodeView-shaped components for the UnifiedTree + component lists. */
  components: NodeView[];
};

/** Map full-tree ComponentTree entries to the NodeView shape the tree/lists use. */
export function componentsFromTree(fullTree: FullProjectTree): NodeView[] {
  return fullTree.components.map((c) => ({
    id: c.guid,
    title: c.title,
    description: "",
    category: c.category,
    public: c.isPublic,
    tags: [] as string[],
    dateCreated: "",
    dateModified: "",
    osfUrl: `https://osf.io/${c.guid}/`,
    related: { children: "", linkedNodes: "", registrations: "", files: "", contributors: "" },
  }));
}

/**
 * Resolve a guid that is EITHER a node (project/component) or a registration and
 * return everything the UnifiedTree needs in one shape.
 *
 * OSF registrations are addressed by the same flat guid namespace as nodes but
 * live under `/v2/registrations/<guid>/` — the node endpoints 404 for them. This
 * helper tries the node path first (the common case), and on a 404 falls back to
 * the registration path so the file tree, files browser, and registration
 * overview can all render a registration's files the same way they render a
 * project's. Registrations have no components / linked projects / sub-
 * registrations, so those come back empty; their files load via the
 * registration files API (the skeleton's listing URLs are absolute, so folder
 * hydration in the tree works unchanged).
 *
 * Throws OsfError("not_found") only when the guid is neither a node nor a
 * registration. Other OsfErrors (forbidden/rate_limited/upstream) propagate.
 */
export async function collectResourceTree(guid: string): Promise<ResourceTree> {
  try {
    const node = await getNode(guid);
    const [fullTree, linked, registrations]: [FullProjectTree, NodeView[], RegistrationView[]] =
      await Promise.all([
        collectFullTree(guid, TREE_OPTS).catch((): FullProjectTree => EMPTY_TREE),
        getAllLinkedNodes(guid).catch((): NodeView[] => []),
        getNodeRegistrations(guid).catch((): RegistrationView[] => []),
      ]);
    return {
      kind: "node",
      title: node.title || guid,
      fullTree,
      linked,
      registrations,
      components: componentsFromTree(fullTree),
    };
  } catch (e) {
    if (!(e instanceof OsfError && e.code === "not_found")) throw e;
    // Registration path. getRegistration re-throws not_found if the guid is
    // neither a node nor a registration.
    const reg = await getRegistration(guid);
    const rootSkeleton = await collectFolderSkeleton(guid, { kind: "registration" }).catch(() => []);
    return {
      kind: "registration",
      title: reg.title || guid,
      fullTree: { ...EMPTY_TREE, rootSkeleton },
      linked: [],
      registrations: [],
      components: [],
    };
  }
}
