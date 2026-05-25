import "server-only";
import { getProviderRoots, getFolderContents, type FileEntry } from "./files";

export type SkeletonNode = {
  provider: string;
  name: string;
  materializedPath: string;
  listingUrl: string;
  children: SkeletonNode[];
  /** Number of files (NOT folders) directly under this folder. Used by the UI
   *  to show "(N)" badges so users see there's content before clicking. */
  fileCount: number;
};

export async function collectFolderSkeleton(
  guid: string,
  opts: { maxFolders?: number; maxDepth?: number } = {}
): Promise<SkeletonNode[]> {
  const maxFolders = opts.maxFolders ?? 500;
  const maxDepth = opts.maxDepth ?? 8;
  let folderCount = 0;

  const providers = await getProviderRoots(guid);

  async function walk(
    listingUrl: string,
    depth: number,
    providerName: string
  ): Promise<{ subfolders: SkeletonNode[]; fileCount: number }> {
    if (depth > maxDepth) return { subfolders: [], fileCount: 0 };
    const entries: FileEntry[] = await getFolderContents(listingUrl, guid);
    const subfolders = entries.filter((e) => e.kind === "folder");
    const fileCount = entries.length - subfolders.length;
    const result: SkeletonNode[] = [];
    for (const f of subfolders) {
      if (folderCount >= maxFolders) {
        throw new Error(`collectFolderSkeleton: maxFolders ${maxFolders} exceeded`);
      }
      folderCount += 1;
      if (f.kind !== "folder") continue;
      const child = f.listingUrl ? await walk(f.listingUrl, depth + 1, providerName) : { subfolders: [], fileCount: 0 };
      result.push({
        provider: providerName,
        name: f.name,
        materializedPath: f.materializedPath,
        listingUrl: f.listingUrl,
        children: child.subfolders,
        fileCount: child.fileCount,
      });
    }
    return { subfolders: result, fileCount };
  }

  const out: SkeletonNode[] = [];
  for (const p of providers) {
    if (!p.listingUrl) continue;
    const top = await walk(p.listingUrl, 1, p.provider);
    out.push({
      provider: p.provider,
      name: p.name,
      materializedPath: "/",
      listingUrl: p.listingUrl,
      children: top.subfolders,
      fileCount: top.fileCount,
    });
  }

  return out;
}
