import "server-only";
import { getProviderRoots, getFolderContents, type FileEntry, type FilesKind } from "./files";

export type SkeletonNode = {
  provider: string;
  name: string;
  materializedPath: string;
  listingUrl: string;
  uploadUrl?: string;
  newFolderUrl?: string;
  children: SkeletonNode[];
  /** Number of files (NOT folders) directly under this folder. Used by the UI
   *  to show "(N)" badges so users see there's content before clicking. */
  fileCount: number;
};

export async function collectFolderSkeleton(
  guid: string,
  opts: { maxFolders?: number; maxDepth?: number; kind?: FilesKind } = {}
): Promise<SkeletonNode[]> {
  const maxFolders = opts.maxFolders ?? 500;
  const maxDepth = opts.maxDepth ?? 1;
  let folderCount = 0;

  const providers = await getProviderRoots(guid, { kind: opts.kind });

  async function walk(
    listingUrl: string,
    depth: number,
    providerName: string
  ): Promise<{ subfolders: SkeletonNode[]; fileCount: number; ok: boolean }> {
    if (depth > maxDepth) return { subfolders: [], fileCount: 0, ok: true };
    // A single folder listing can 404 / 403 / time out — e.g. a deauthorized or
    // empty addon provider (github, googledrive) on a registration snapshot. Such
    // a failure must degrade THIS folder to empty, never abort the whole walk:
    // otherwise one broken provider blanks every other provider's files (the
    // c97pd registration showed zero files because its github addon listing 404s).
    // `ok: false` lets the provider loop drop a provider whose own root listing
    // is unreachable, instead of surfacing an empty node that errors on click.
    let entries: FileEntry[];
    try {
      entries = await getFolderContents(listingUrl, guid);
    } catch {
      return { subfolders: [], fileCount: 0, ok: false };
    }
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
        uploadUrl: f.uploadUrl,
        newFolderUrl: f.newFolderUrl,
        children: child.subfolders,
        fileCount: child.fileCount,
      });
    }
    return { subfolders: result, fileCount, ok: true };
  }

  const out: SkeletonNode[] = [];
  for (const p of providers) {
    if (!p.listingUrl) continue;
    const top = await walk(p.listingUrl, 1, p.provider);
    // Drop a provider whose own root listing is unreachable (broken/empty addon).
    // Genuinely-empty providers (listing succeeds, no entries) are still kept so
    // an empty osfstorage root remains visible/uploadable.
    if (!top.ok) continue;
    out.push({
      provider: p.provider,
      name: p.name,
      materializedPath: "/",
      listingUrl: p.listingUrl,
      uploadUrl: p.uploadUrl,
      newFolderUrl: p.newFolderUrl,
      children: top.subfolders,
      fileCount: top.fileCount,
    });
  }

  return out;
}
