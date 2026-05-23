import "server-only";
import { getNode, getAllChildren, getAllLinkedNodes } from "./nodes";

export type TreeNode = {
  guid: string;
  title: string;
  depth: number;
  parentPath: string;
  linked: boolean;
};

export async function collectNodeTree(
  rootGuid: string,
  opts: { maxNodes?: number } = {}
): Promise<TreeNode[]> {
  const maxNodes = opts.maxNodes ?? 500;
  const visited = new Set<string>();
  const out: TreeNode[] = [];

  async function visit(guid: string, depth: number, parentPath: string, linked: boolean): Promise<void> {
    if (visited.has(guid)) return;
    if (out.length >= maxNodes) throw new Error(`collectNodeTree: maxNodes ${maxNodes} exceeded`);
    visited.add(guid);

    const node = await getNode(guid);
    out.push({ guid, title: node.title, depth, parentPath, linked });

    const nextPath = parentPath ? `${parentPath}/${node.title}` : node.title;

    const children = await getAllChildren(guid);
    for (const c of children) {
      await visit(c.id, depth + 1, nextPath, false);
    }
  }

  await visit(rootGuid, 0, "", false);

  // Linked nodes only at root level, no recursion into THEIR children
  const linked = await getAllLinkedNodes(rootGuid);
  for (const ln of linked) {
    if (!visited.has(ln.id)) {
      if (out.length >= maxNodes) throw new Error(`collectNodeTree: maxNodes ${maxNodes} exceeded`);
      visited.add(ln.id);
      const node = await getNode(ln.id);
      out.push({ guid: ln.id, title: node.title, depth: 1, parentPath: "", linked: true });
    }
  }

  return out;
}
