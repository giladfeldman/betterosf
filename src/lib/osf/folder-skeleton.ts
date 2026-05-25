import "server-only";
import { getProviderRoots, getFolderContents, type FileEntry } from "./files";

export type SkeletonNode = {
  provider: string;
  name: string;
  materializedPath: string;
  listingUrl: string;
  children: SkeletonNode[];
};

export async function collectFolderSkeleton(
  guid: string,
  opts: { maxFolders?: number; maxDepth?: number } = {}
): Promise<SkeletonNode[]> {
  const maxFolders = opts.maxFolders ?? 500;
  const maxDepth = opts.maxDepth ?? 8;
  let folderCount = 0;

  const providers = await getProviderRoots(guid);

  async function walk(listingUrl: string, depth: number): Promise<SkeletonNode[]> {
    if (depth > maxDepth) return [];
    const entries: FileEntry[] = await getFolderContents(listingUrl, guid);
    const subfolders = entries.filter((e) => e.kind === "folder");
    const result: SkeletonNode[] = [];
    for (const f of subfolders) {
      if (folderCount >= maxFolders) {
        throw new Error(`collectFolderSkeleton: maxFolders ${maxFolders} exceeded`);
      }
      folderCount += 1;
      if (f.kind !== "folder") continue;
      const children = f.listingUrl ? await walk(f.listingUrl, depth + 1) : [];
      result.push({
        provider: "", // filled in by caller
        name: f.name,
        materializedPath: f.materializedPath,
        listingUrl: f.listingUrl,
        children,
      });
    }
    return result;
  }

  const out: SkeletonNode[] = [];
  for (const p of providers) {
    if (!p.listingUrl) continue;
    const children = await walk(p.listingUrl, 1);
    out.push({
      provider: p.provider,
      name: p.name,
      materializedPath: "/",
      listingUrl: p.listingUrl,
      children: children.map((c) => ({ ...c, provider: p.provider })),
    });
  }

  return out;
}
