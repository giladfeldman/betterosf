/**
 * Whole-tree and selected-items ZIPs, built IN THE BROWSER.
 *
 * The routes these replace (`/api/zip/[guid]` and `/api/zip/[guid]/selection`) fetch every
 * byte server-side and stream it through a Vercel function, so bandwidth equals project
 * size: one researcher zipping 5 GB costs 5 GB of egress, which was the app's largest cost
 * risk if it goes public. Measured for contrast on 2026-08-14, a 145 MB transition transfer
 * costs ~8 function invocations and ZERO bytes, because everything is browser ↔ OSF direct.
 *
 * Moving the bytes out does NOT move the abuse surface out: `/api/zip/[guid]/manifest` still
 * walks the node tree server-side under BetterOSF's app token, so it carries the same
 * anonymous rate limit — on the same key — as the route it replaces.
 *
 * This does the same thing for downloads. The pieces already existed:
 *   - `client-zip` streams rather than buffering, so a multi-gigabyte archive is possible.
 *   - Waterbutler's `?zip=` gives one ready-made archive per (node, provider), so no file
 *     enumeration is needed and the nesting matches the server route byte for byte.
 *   - `osfBrowserAuthHeader` supplies the `Authorization` header Waterbutler requires
 *     before it will send CORS headers — see its doc comment for the measurement.
 *   - `saveArchive` offers a save location where the browser supports one.
 *
 * **Everything here degrades.** The CORS behaviour it relies on is undocumented, so every
 * caller is expected to fall back to the server route when `downloadTree`/`downloadSelection`
 * throws. That is what makes depending on a quirk safe: if OSF changes it, downloads get
 * expensive again rather than breaking.
 */

import { downloadZip } from "client-zip";
import {
  osfBrowserAuthHeader,
  waterbutlerDownloadUrl,
  waterbutlerZipUrl,
} from "@/lib/osf/waterbutler-url";
import { saveArchive, type SaveOutcome } from "@/lib/transition/save-archive";
import { errorsFileName, errorsFileBody } from "@/lib/zip/tree-naming";

export type ZipManifest = {
  guid: string;
  rootTitle: string;
  filename: string;
  nodes: {
    guid: string;
    title: string;
    folder: string;
    linked: boolean;
    providers: string[];
    error: string | null;
  }[];
};

export type ZipProgress = {
  /** 1-based position of the archive currently being fetched. */
  index: number;
  total: number;
  label: string;
};

/** One entry in the outer archive, plus whatever went wrong getting it. */
type Assembled = {
  entries: { name: string; input: Blob }[];
  problems: string[];
};

/**
 * Fetch one Waterbutler archive.
 *
 * Buffered into a Blob rather than streamed straight into client-zip, deliberately: a
 * `?zip=` response is chunked with no `Content-Length`, and client-zip reads its inputs at
 * the END, so a live stream held open across the whole assembly would keep every connection
 * open at once.
 *
 * ⚠️ The consequence, stated plainly because a comment claiming otherwise is what broke the
 * export in v1.10.4: **peak client memory for a whole-tree download is the WHOLE PROJECT**,
 * not one archive. `runJobs` accumulates one Blob per (node, provider) and client-zip reads
 * them all at the end — the same lazy-consumer shape, here by design rather than by accident,
 * because a ZIP's central directory cannot be written until every entry is known. The
 * transition export avoids it by staging to OPFS; this path cannot, because it nests
 * ready-made archives it never opens.
 *
 * That cost is in `WholeTreeZipButton`'s copy rather than left for a researcher to discover
 * on a 5 GB project. If this ever needs to scale further, the fix is to stage each provider
 * archive into OPFS exactly as `stage-opfs.ts` does — not to hold more Blobs.
 */
async function fetchArchive(url: string, token: string | null, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, {
    headers: { Authorization: osfBrowserAuthHeader(token) },
    signal,
  });
  if (!res.ok) throw new Error(`OSF returned HTTP ${res.status}`);
  return await res.blob();
}

export type DownloadOptions = {
  /** The signed-in user's OSF token, or null. Public files need none. */
  token: string | null;
  onProgress?: (p: ZipProgress) => void;
  signal?: AbortSignal;
};

/**
 * The whole node tree — root, components and linked projects, every provider.
 *
 * Mirrors `/api/zip/[guid]` exactly, including the `<provider>.zip` nesting and the
 * `_BETTEROSF_ERRORS.txt` file listing partial failures. A researcher who unzips one cannot
 * tell which path produced it, which is the point.
 */
export async function downloadTree(
  manifest: ZipManifest,
  opts: DownloadOptions,
): Promise<SaveOutcome> {
  const jobs: { url: string; name: string; label: string }[] = [];
  const problems: string[] = [];

  for (const node of manifest.nodes) {
    if (node.error) {
      problems.push(`[${node.guid} "${node.title}"] ${node.error}`);
      continue;
    }
    for (const provider of node.providers) {
      jobs.push({
        url: waterbutlerZipUrl({ guid: node.guid, provider }),
        name: `${node.folder}/${provider}.zip`,
        label: `${node.title} — ${provider}`,
      });
    }
  }

  const assembled = await runJobs(jobs, problems, opts);
  return finish(assembled, manifest.rootTitle, manifest.filename, opts.signal, manifest.guid);
}

export type SelectionItem =
  | { kind: "file"; guid: string; provider: string; path: string; name: string; providerPath: string }
  | { kind: "folder"; guid: string; provider: string; path: string; name: string };

/**
 * The items a user ticked in the tree.
 *
 * Folders come down as Waterbutler `?zip=` archives (one request, whatever is inside);
 * files come down individually through `?direct=`. Same shape the server route produced.
 */
export async function downloadSelection(
  guid: string,
  items: SelectionItem[],
  opts: DownloadOptions,
): Promise<SaveOutcome> {
  const problems: string[] = [];
  const jobs = items.map((item) =>
    item.kind === "folder"
      ? {
          url: waterbutlerZipUrl({ guid: item.guid, provider: item.provider, path: item.path }),
          name: `${safePart(item.guid)}/${safePart(item.provider)}/${
            item.path === "/" ? `${item.provider}.zip` : `${safePart(item.name)}.zip`
          }`,
          label: item.name,
        }
      : {
          url: waterbutlerDownloadUrl({
            guid: item.guid,
            provider: item.provider,
            path: item.providerPath,
          }),
          name: zipPath(item.guid, item.provider, item.path),
          label: item.name,
        },
  );

  const assembled = await runJobs(jobs, problems, opts);
  return finish(assembled, `betterosf-selection-${guid}`, `betterosf-selection-${guid}.zip`, opts.signal);
}

async function runJobs(
  jobs: { url: string; name: string; label: string }[],
  problems: string[],
  opts: DownloadOptions,
): Promise<Assembled> {
  const entries: { name: string; input: Blob }[] = [];
  for (const [i, job] of jobs.entries()) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.({ index: i + 1, total: jobs.length, label: job.label });
    try {
      entries.push({ name: job.name, input: await fetchArchive(job.url, opts.token, opts.signal) });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // Recorded and carried on: a researcher gets the rest plus a list of what is missing,
      // which is strictly better than a failed download with no explanation. The very first
      // failure is still rethrown by the caller's fallback logic if NOTHING succeeded.
      problems.push(`[${job.name}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { entries, problems };
}

async function finish(
  assembled: Assembled,
  rootTitle: string,
  filename: string,
  signal?: AbortSignal,
  /** For the errors file's header, so it matches the server route's byte for byte. */
  guid?: string,
): Promise<SaveOutcome> {
  if (assembled.entries.length === 0) {
    // An archive containing only an error file looks like a successful download of an
    // empty project. Throwing hands the caller its fallback instead.
    throw new Error(
      assembled.problems[0] ?? "Nothing could be downloaded directly from OSF.",
    );
  }

  const inputs: { name: string; input: Blob | string }[] = [...assembled.entries];
  if (assembled.problems.length > 0) {
    // Deliberately identical to the server route's wording, not merely similar. The claim
    // above — that a researcher cannot tell which path produced their archive — is only
    // true if the artefacts really match, and this file was the one place they diverged.
    inputs.push({
      name: errorsFileName(rootTitle),
      input: errorsFileBody({
        guid: guid ?? "(unknown)",
        generatedAt: new Date().toISOString(),
        problems: assembled.problems,
      }),
    });
  }

  signal?.throwIfAborted();
  const blob = await downloadZip(inputs).blob();
  return await saveArchive(blob, filename);
}

function safePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

function zipPath(guid: string, provider: string, path: string): string {
  const parts = path.split("/").filter(Boolean).map(safePart);
  return [safePart(guid), safePart(provider), ...parts].join("/");
}
