import "server-only";
import { getProviderRoots, getFolderContents, type FileEntry } from "./files";

export type RecursiveEntry = {
  provider: string;
  materializedPath: string;
  name: string;
  kind: "file" | "folder";
  downloadUrl?: string;
};

export type ProjectWalk = {
  entries: RecursiveEntry[];
  /**
   * True when the walk stopped at `maxEntries` — so `entries` is NOT every file in the
   * project. Callers must say so (d-3fadc2): this used to throw, the search caught the throw
   * as "no entries", and a project too big to walk read as "no files match".
   */
  truncated: boolean;
};

/**
 * Every file and folder in a project's storage, walked folder by folder.
 *
 * Folder listings run in parallel, at most `concurrency` at a time (d-bd150b). The walk used
 * to await each listing in turn: 16 OSF calls on project 3kmr9 took 8.5 s, measured locally
 * on 2026-10-29, and the first visitor after a deploy could hit the gateway timeout. The
 * number of OSF calls is unchanged — only their overlap — and the bound keeps a deep
 * project from firing a burst of simultaneous requests at OSF.
 */
export async function fetchAllProjectEntries(
  guid: string,
  opts: { maxEntries?: number; concurrency?: number } = {},
): Promise<ProjectWalk> {
  const maxEntries = opts.maxEntries ?? 5000;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const out: RecursiveEntry[] = [];
  let truncated = false;
  // Guard against a cyclic Waterbutler graph (a folder that links back to an ancestor):
  // without this the walk would list the same URLs forever. Keyed on listingUrl.
  const visited = new Set<string>();
  const queue: { provider: string; listingUrl: string }[] = [];

  const providers = await getProviderRoots(guid);
  for (const p of providers) {
    if (p.listingUrl) queue.push({ provider: p.provider, listingUrl: p.listingUrl });
  }

  // A small worker pool over a growing queue: each listing may add folders to the queue.
  let active = 0;
  let failure: unknown = null;
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (failure !== null || (truncated && active === 0) || (queue.length === 0 && active === 0)) {
        resolve();
        return;
      }
      while (!truncated && failure === null && active < concurrency && queue.length > 0) {
        const job = queue.shift()!;
        if (visited.has(job.listingUrl)) continue;
        visited.add(job.listingUrl);
        active++;
        getFolderContents(job.listingUrl, guid)
          .then((entries: FileEntry[]) => {
            for (const e of entries) {
              if (out.length >= maxEntries) {
                truncated = true;
                break;
              }
              out.push({
                provider: job.provider,
                materializedPath: e.materializedPath,
                name: e.name,
                kind: e.kind,
                downloadUrl: e.kind === "file" ? e.downloadUrl : undefined,
              });
              if (e.kind === "folder" && e.listingUrl) queue.push({ provider: job.provider, listingUrl: e.listingUrl });
            }
          })
          .catch((e: unknown) => {
            failure ??= e;
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0) resolve();
    };
    pump();
  });

  // A folder that could not be listed is a failed walk, not a smaller project: an OSF
  // error propagates exactly as it did when the walk was serial.
  if (failure !== null) throw failure;
  return { entries: out, truncated };
}
