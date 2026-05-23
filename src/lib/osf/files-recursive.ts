import "server-only";
import { getProviderRoots, getFolderContents, type FileEntry } from "./files";

export type RecursiveEntry = {
  provider: string;
  materializedPath: string;
  name: string;
  kind: "file" | "folder";
  downloadUrl?: string;
};

export async function fetchAllProjectEntries(
  guid: string,
  opts: { maxEntries?: number } = {}
): Promise<RecursiveEntry[]> {
  const maxEntries = opts.maxEntries ?? 5000;
  const out: RecursiveEntry[] = [];

  const providers = await getProviderRoots(guid);
  for (const p of providers) {
    if (!p.listingUrl) continue;
    await walk(p.provider, p.listingUrl);
  }

  return out;

  async function walk(provider: string, listingUrl: string): Promise<void> {
    const entries: FileEntry[] = await getFolderContents(listingUrl, guid);
    for (const e of entries) {
      if (out.length >= maxEntries) throw new Error(`fetchAllProjectEntries: maxEntries ${maxEntries} exceeded`);
      out.push({
        provider,
        materializedPath: e.materializedPath,
        name: e.name,
        kind: e.kind,
        downloadUrl: e.kind === "file" ? e.downloadUrl : undefined,
      });
      if (e.kind === "folder" && e.listingUrl) {
        await walk(provider, e.listingUrl);
      }
    }
  }
}
