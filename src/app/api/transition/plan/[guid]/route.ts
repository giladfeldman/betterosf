import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { isValidGuid } from "@/lib/osf/guid";
import { osfErrorResponse } from "@/lib/osf/error-response";
import { getNode } from "@/lib/osf/nodes";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNodeWikis } from "@/lib/osf/wikis";
import { getNodeContributors } from "@/lib/osf/contributors";
import { getNodeIdentifiers, findDoi, getNodeAddons, getNodeLicense } from "@/lib/osf/project-extras";
import { mapWithConcurrency } from "@/lib/util/concurrency";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Build the export plan for one project: every file with its OSF checksums, plus the
 * non-file content that OSF offers no way to export.
 *
 * Caps are hard limits, not suggestions, and a truncated walk is REPORTED rather than
 * silently returned short — an export that quietly covered 5000 of 12000 files and called
 * itself complete is the exact failure this whole feature exists to avoid.
 */
const MAX_FILES = 5000;
const MAX_DEPTH = 12;
const WALK_CONCURRENCY = 4;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const { guid } = await params;
  if (!isValidGuid(guid)) {
    return Response.json({ error: "Not a valid OSF id." }, { status: 400, headers: noStore });
  }

  try {
    const [node, providers, wikis, contributors, identifiers, addons, license] = await Promise.all([
      getNode(guid),
      getProviderRoots(guid),
      getNodeWikis(guid).catch(() => null),
      getNodeContributors(guid).catch(() => null),
      getNodeIdentifiers(guid).catch(() => null),
      getNodeAddons(guid).catch(() => null),
      // `undefined` distinguishes "the lookup failed" from `null`, "OSF asserts no
      // licence". The crosswalk treats the second as "you must choose one before
      // publishing"; treating a failed lookup the same way would be inventing a fact
      // about someone's rights statement.
      getNodeLicense(guid).catch(() => undefined),
    ]);

    const files: PlanFile[] = [];
    let truncated = false;

    async function walk(listingUrl: string, prefix: string, depth: number): Promise<void> {
      if (truncated) return;
      if (depth > MAX_DEPTH) {
        truncated = true;
        return;
      }
      const entries: FileEntry[] = await getFolderContents(listingUrl, guid, { fresh: false });
      const folders: { listingUrl: string; prefix: string }[] = [];

      for (const entry of entries) {
        if (truncated) return;
        if (entry.kind === "folder") {
          folders.push({ listingUrl: entry.listingUrl, prefix: `${prefix}${entry.name}/` });
          continue;
        }
        files.push({
          osfFileId: entry.id,
          path: `${prefix}${entry.name}`,
          size: entry.size ?? 0,
          downloadUrl: entry.downloadUrl,
          md5: entry.md5,
          sha256: entry.sha256,
        });
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
      }

      await mapWithConcurrency(folders, WALK_CONCURRENCY, (f) => walk(f.listingUrl, f.prefix, depth + 1));
    }

    await mapWithConcurrency(providers, 2, (p) => walk(p.listingUrl, `${p.name}/`, 0));

    return Response.json(
      {
        guid,
        title: node.title,
        description: node.description,
        osfUrl: node.osfUrl,
        dateCreated: node.dateCreated,
        dateModified: node.dateModified,
        tags: node.tags,
        category: node.category,
        doi: identifiers ? findDoi(identifiers) : null,
        addonProviders: addons ? addons.map((a) => a.id) : null,
        /** `null` = no licence on OSF; `undefined` (absent) = we could not find out. */
        license: license === undefined ? undefined : license,
        licenseLookupFailed: license === undefined,
        files,
        wikis: wikis?.map((w) => ({ id: w.id, name: w.name, size: w.size })) ?? null,
        contributors,
        /** True when a cap was hit. The UI must refuse to call such an export complete. */
        truncated,
        limits: { maxFiles: MAX_FILES, maxDepth: MAX_DEPTH },
        // Files with no checksum can never be verified — surfaced up front so the
        // preflight can say so BEFORE someone commits an afternoon to the run.
        unverifiableCount: files.filter((f) => !f.md5 && !f.sha256).length,
      },
      { headers: noStore },
    );
  } catch (e) {
    const mapped = osfErrorResponse(e);
    if (mapped) return mapped;
    console.error(`[transition/plan/${guid}] error:`, e);
    return Response.json(
      { error: "Could not read this project from OSF. Nothing was changed — try again." },
      { status: 502, headers: noStore },
    );
  }
}

type PlanFile = {
  osfFileId: string;
  path: string;
  size: number;
  downloadUrl: string;
  md5: string | null;
  sha256: string | null;
};

const noStore = { "Cache-Control": "private, no-store" } as const;
