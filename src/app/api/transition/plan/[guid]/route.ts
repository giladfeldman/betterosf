import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { isValidGuid } from "@/lib/osf/guid";
import { osfErrorResponse } from "@/lib/osf/error-response";
import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNodeWikis } from "@/lib/osf/wikis";
import { getNodeContributors } from "@/lib/osf/contributors";
import { getNodeIdentifiers, findDoi, getNodeAddons, getNodeLicense } from "@/lib/osf/project-extras";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { waterbutlerDownloadUrl } from "@/lib/osf/waterbutler-url";
import { relatedNodePrefix, type RelatedKind } from "@/lib/transition/related-nodes";
import { safeNameSegment } from "@/lib/paths/entry-path";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Build the export plan for one project: every file with its OSF checksums, plus the
 * non-file content that OSF offers no way to export.
 *
 * Since v1.12 the plan can cover MORE THAN ONE NODE. An export that silently stopped at the
 * root called itself "a complete copy" while leaving every component behind, and
 * `reconcile()` agreed with it — because it reconciles against a plan that never mentioned
 * them. Components are therefore included **by default**; registrations and linked projects
 * are listed but off, because they are not part of this project's fate (a registration is
 * frozen, stays on OSF at the same DOI, and copying it is completeness rather than rescue).
 *
 * Caps are hard limits, not suggestions, and a truncated walk is REPORTED rather than
 * silently returned short — an export that quietly covered 5000 of 12000 files and called
 * itself complete is the exact failure this whole feature exists to avoid.
 */
const MAX_FILES = 5000;
const MAX_DEPTH = 12;
const WALK_CONCURRENCY = 4;
/**
 * How many extra nodes one plan may walk.
 *
 * The walk is bounded by `maxDuration = 60`, and each node costs at least one provider
 * lookup plus a folder listing. Anything beyond this is reported as skipped rather than
 * quietly dropped.
 */
const MAX_RELATED_NODES = 25;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const { guid } = await params;
  if (!isValidGuid(guid)) {
    return Response.json({ error: "Not a valid OSF id." }, { status: 400, headers: noStore });
  }

  // `include` absent  → every component, which is the default this feature exists for.
  // `include` present → exactly those guids, INCLUDING the empty list, which is how the UI
  //                     says "root only". The two cases have to be distinguishable: an
  //                     absent parameter meaning "none" would make unticking everything
  //                     indistinguishable from a first load.
  const includeParam = new URL(req.url).searchParams.get("include");
  const requested =
    includeParam === null
      ? null
      : includeParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => isValidGuid(s));

  try {
    const [node, providers, wikis, contributors, identifiers, addons, license, children, linked, registrations] =
      await Promise.all([
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
        // `null` rather than `[]` on failure, all three times. An empty list is a
        // statement that this project HAS no components; a failed lookup is not, and the
        // UI must not be able to render the second as the first.
        collectComponents(guid).catch(() => null),
        getAllLinkedNodes(guid)
          .then((rows) => rows.map((r) => ({ guid: r.id, title: r.title })))
          .catch(() => null),
        getNodeRegistrations(guid)
          .then((rows) => rows.map((r) => ({ guid: r.id, title: r.title, dateRegistered: r.dateRegistered, public: r.public })))
          .catch(() => null),
      ]);

    const files: PlanFile[] = [];
    let truncated = false;

    async function walk(
      listingUrl: string,
      sourceGuid: string,
      prefix: string,
      depth: number,
      /** The same prefix built from OSF's untouched names, for reporting a rename. */
      rawPrefix: string = prefix,
    ): Promise<void> {
      if (truncated) return;
      if (depth > MAX_DEPTH) {
        truncated = true;
        return;
      }
      const entries: FileEntry[] = await getFolderContents(listingUrl, sourceGuid, { fresh: false });
      const folders: { listingUrl: string; prefix: string; rawPrefix: string }[] = [];

      for (const entry of entries) {
        if (truncated) return;
        if (entry.kind === "folder") {
          // A folder name becomes a path segment. OSF rejects the hostile folder names
          // outright (measured), but sanitising here costs nothing and means the prefix
          // is safe by construction rather than by OSF's good manners.
          folders.push({
            listingUrl: entry.listingUrl,
            prefix: `${prefix}${safeNameSegment(entry.name)}/`,
            rawPrefix: `${rawPrefix}${entry.name}/`,
          });
          continue;
        }
        // The BROWSER fetches these, so the URL has to be one a browser can fetch.
        // OSF's own `links.download` (osf.io/download/<id>/) sends no CORS headers at
        // all, so every file failed with "NetworkError when attempting to fetch
        // resource" — the export never worked on real data. Waterbutler with `?direct=`
        // is the form that answers the preflight and streams the bytes without a
        // redirect to a CORS-less storage bucket. Measured 2026-08-14. Registration
        // files use the identical shape under their own guid, also measured.
        let downloadUrl: string;
        try {
          downloadUrl = waterbutlerDownloadUrl({
            guid: sourceGuid,
            provider: entry.provider ?? "",
            path: entry.providerPath ?? "",
          });
        } catch {
          // A file OSF described without a provider or path cannot be fetched by the
          // browser at all. Skipping it silently would produce an export that looks
          // complete and is not, so it is planned with no URL and fails loudly during
          // the run, where reconcile() counts it.
          downloadUrl = "";
        }

        // OSF accepts file names a filesystem cannot write. Measured 2026-08-14 on a
        // throwaway project: `a\b.txt`, `CON` and `we<ird>.txt` are all stored verbatim
        // (traversal is not — OSF rejects `..` in file AND folder names with 400). Left
        // alone, `a\b.txt` silently becomes a folder on Windows extraction and `CON` cannot
        // be written at all, so the report would say `verified` for a file the researcher
        // does not actually have.
        //
        // `path` is therefore the name the archive and the Zenodo key use, and `osfPath`
        // keeps OSF's own name whenever they differ, so the rename is reported rather than
        // silent. See `safeEntryPath` for the full measurement.
        const rawPath = `${rawPrefix}${entry.name}`;
        const safePath = `${prefix}${safeNameSegment(entry.name)}`;

        files.push({
          osfFileId: entry.id,
          path: safePath,
          ...(safePath === rawPath ? {} : { osfPath: rawPath }),
          size: entry.size ?? 0,
          downloadUrl,
          md5: entry.md5,
          sha256: entry.sha256,
          sourceGuid,
        });
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
      }

      await mapWithConcurrency(folders, WALK_CONCURRENCY, (f) =>
        walk(f.listingUrl, sourceGuid, f.prefix, depth + 1, f.rawPrefix),
      );
    }

    await mapWithConcurrency(providers, 2, (p) => walk(p.listingUrl, guid, `${p.name}/`, 0));
    const rootFileCount = files.length;

    // --------------------------------------------------------------- related nodes
    const catalogue = new Map<string, { title: string; kind: RelatedKind }>();
    for (const c of children ?? []) catalogue.set(c.guid, { title: c.title, kind: "component" });
    for (const l of linked ?? []) catalogue.set(l.guid, { title: l.title, kind: "linked" });
    for (const r of registrations ?? []) catalogue.set(r.guid, { title: r.title, kind: "registration" });

    const wanted = requested === null ? (children ?? []).map((c) => c.guid) : requested;
    // A guid the caller asked for that is not on this project is refused rather than
    // walked: the plan endpoint must not become a way to bundle arbitrary OSF nodes into
    // somebody else's deposit.
    const resolvable = wanted.filter((g) => catalogue.has(g) && g !== guid);
    const unknown = wanted.filter((g) => !catalogue.has(g) && g !== guid);
    const skipped = resolvable.slice(MAX_RELATED_NODES);
    const included: IncludedNode[] = [];

    for (const relatedGuid of resolvable.slice(0, MAX_RELATED_NODES)) {
      if (truncated) {
        skipped.push(relatedGuid);
        continue;
      }
      const meta = catalogue.get(relatedGuid)!;
      const prefix = relatedNodePrefix(meta.kind, relatedGuid, meta.title);
      const before = files.length;
      try {
        // Registrations live under /v2/registrations/{id}/files/, and their listing URLs
        // are what keeps them immutable everywhere else in the app — read here, never
        // written, and never routed through the node reader.
        const roots = await getProviderRoots(relatedGuid, {
          kind: meta.kind === "registration" ? "registration" : "node",
        });
        await mapWithConcurrency(roots, 2, (p) => walk(p.listingUrl, relatedGuid, `${prefix}${p.name}/`, 0));
        included.push({
          guid: relatedGuid,
          title: meta.title,
          kind: meta.kind,
          prefix,
          fileCount: files.length - before,
          error: null,
        });
      } catch (e) {
        // Recorded, never dropped. A component we could not read is the difference
        // between "complete" and "complete except the part you cannot see".
        included.push({
          guid: relatedGuid,
          title: meta.title,
          kind: meta.kind,
          prefix,
          fileCount: files.length - before,
          error: e instanceof Error ? e.message : "Could not read this node's files from OSF.",
        });
      }
    }

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
        limits: { maxFiles: MAX_FILES, maxDepth: MAX_DEPTH, maxRelatedNodes: MAX_RELATED_NODES },
        // Files with no checksum can never be verified — surfaced up front so the
        // preflight can say so BEFORE someone commits an afternoon to the run.
        unverifiableCount: files.filter((f) => !f.md5 && !f.sha256).length,
        // `null` on any of these three means the lookup FAILED, which is not the same as
        // "there are none" and must never be shown as such.
        components: children,
        linkedProjects: linked,
        registrations,
        included,
        rootFileCount,
        skippedNodes: skipped,
        unknownNodes: unknown,
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

/**
 * Every component beneath this project, depth-first, deduplicated.
 *
 * Recurses, because a component's own components share the project's fate just as much as
 * the top-level ones do. Linked projects are NOT here: they belong to other people and are
 * offered separately, off by default.
 */
async function collectComponents(
  rootGuid: string,
  maxNodes = 200,
): Promise<{ guid: string; title: string }[]> {
  const seen = new Set<string>([rootGuid]);
  const out: { guid: string; title: string }[] = [];

  async function visit(parentGuid: string): Promise<void> {
    if (out.length >= maxNodes) return;
    const kids = await getAllChildren(parentGuid);
    const fresh = kids.filter((k) => {
      if (seen.has(k.id)) return false;
      seen.add(k.id);
      return true;
    });
    for (const k of fresh) {
      if (out.length >= maxNodes) return;
      out.push({ guid: k.id, title: k.title });
    }
    await mapWithConcurrency(fresh, 4, (k) => visit(k.id));
  }

  await visit(rootGuid);
  return out;
}

type PlanFile = {
  osfFileId: string;
  /** The name used in the archive and as the Zenodo key — safe on every filesystem. */
  path: string;
  /** OSF's own name, present ONLY when sanitising had to change it. Never silent. */
  osfPath?: string;
  size: number;
  downloadUrl: string;
  md5: string | null;
  sha256: string | null;
  /** The node the file actually lives on — the root, or a component/registration. */
  sourceGuid: string;
};

type IncludedNode = {
  guid: string;
  title: string;
  kind: RelatedKind;
  prefix: string;
  fileCount: number;
  error: string | null;
};

const noStore = { "Cache-Control": "private, no-store" } as const;
