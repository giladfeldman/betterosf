import "server-only";
import { getNode, getAllChildren, getAllLinkedNodes } from "./nodes";
import { mapWithConcurrency } from "@/lib/util/concurrency";

export type TreeNode = {
  guid: string;
  title: string;
  depth: number;
  parentPath: string;
  linked: boolean;
};

// Sibling subtrees are fetched concurrently (bounded) instead of one-at-a-time —
// a multi-component project otherwise makes hundreds of sequential OSF round-
// trips before the ZIP can start, risking the function timeout. Output order is
// still deterministic DFS: each visit() returns its own ordered subtree and the
// parent concatenates children in order, so only the network I/O overlaps.
const NODE_FETCH_CONCURRENCY = 6;

export async function collectNodeTree(
  rootGuid: string,
  opts: { maxNodes?: number } = {}
): Promise<TreeNode[]> {
  const maxNodes = opts.maxNodes ?? 500;
  // Dedupe at ENQUEUE time (not visit time) so two concurrent branches can't
  // both queue the same guid. Seed with the root.
  const visited = new Set<string>([rootGuid]);
  let count = 0;
  const bump = () => {
    count += 1;
    if (count > maxNodes) throw new Error(`collectNodeTree: maxNodes ${maxNodes} exceeded`);
  };

  async function visit(guid: string, depth: number, parentPath: string, linked: boolean): Promise<TreeNode[]> {
    bump();
    const node = await getNode(guid);
    const self: TreeNode = { guid, title: node.title, depth, parentPath, linked };
    const nextPath = parentPath ? `${parentPath}/${node.title}` : node.title;

    const children = (await getAllChildren(guid)).filter((c) => {
      if (visited.has(c.id)) return false;
      visited.add(c.id);
      return true;
    });
    const childSubtrees = await mapWithConcurrency(
      children,
      NODE_FETCH_CONCURRENCY,
      (c) => visit(c.id, depth + 1, nextPath, false)
    );
    return [self, ...childSubtrees.flat()];
  }

  const out = await visit(rootGuid, 0, "", false);

  // Linked nodes only at root level, no recursion into THEIR children. Fetched
  // concurrently; appended after the main tree in their original order.
  const linkedNodes = (await getAllLinkedNodes(rootGuid)).filter((ln) => {
    if (visited.has(ln.id)) return false;
    visited.add(ln.id);
    return true;
  });
  const linkedRows = await mapWithConcurrency(linkedNodes, NODE_FETCH_CONCURRENCY, async (ln) => {
    bump();
    const node = await getNode(ln.id);
    return { guid: ln.id, title: node.title, depth: 1, parentPath: "", linked: true } satisfies TreeNode;
  });
  out.push(...linkedRows);

  return out;
}
