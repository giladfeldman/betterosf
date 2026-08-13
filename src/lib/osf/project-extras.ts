import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

/**
 * The rest of what a project is, beyond its files and wikis: activity logs, comments,
 * identifiers, institutions, add-ons, and per-file version history.
 *
 * Each of these is a thing a researcher may not realise they are about to lose the
 * ability to change — and in the case of logs and comments, a thing OSF offers no way to
 * export at all.
 *
 * Every reader here returns a plain array and NEVER invents an empty one to paper over a
 * failure: a caller that cannot tell "no comments" from "the comments call failed" would
 * write a manifest claiming a project had no discussion when it had two hundred. Errors
 * propagate; the export layer records them per-section.
 */

// ---------------------------------------------------------------------------- logs

export type ActivityLogView = {
  id: string;
  /** e.g. "wiki_updated", "osf_storage_file_added", "contributor_added". */
  action: string;
  date: string;
  /** Free-form per action. Kept whole because its shape varies by action type. */
  params: Record<string, unknown>;
};

type RawLog = {
  id: string;
  attributes?: { action?: string; date?: string; params?: Record<string, unknown> };
};

/**
 * Activity log, newest first.
 *
 * `maxPages` is capped because a decade-old lab project can have tens of thousands of
 * entries, and an unbounded crawl through our own proxy is exactly the cost profile the
 * toolkit is designed to avoid. The cap is surfaced to the caller by `truncated`.
 */
export async function getNodeLogs(
  guid: string,
  opts: { maxPages?: number } = {},
): Promise<{ logs: ActivityLogView[]; truncated: boolean }> {
  const maxPages = opts.maxPages ?? 10; // 10 × 100 = 1000 entries
  const logs: ActivityLogView[] = [];
  let truncated = false;

  try {
    const all = await collectAll<ActivityLogView>(
      async (nextUrl) => {
        const raw = nextUrl
          ? await osfGetUrl<{ data: RawLog[]; links: { next: string | null } }>(nextUrl, {
              tags: [`node:${guid}`],
            })
          : await osfGet<{ data: RawLog[]; links: { next: string | null } }>(
              `/nodes/${guid}/logs/?page[size]=100`,
              { tags: [`node:${guid}`] },
            );
        return {
          data: raw.data.map((l) => ({
            id: l.id,
            action: String(l.attributes?.action ?? ""),
            date: String(l.attributes?.date ?? ""),
            params: l.attributes?.params ?? {},
          })),
          links: raw.links,
        };
      },
      { maxPages },
    );
    logs.push(...all);
  } catch (e) {
    // collectAll throws specifically when it hits maxPages. That is a truncation, not a
    // failure — but any OTHER error is real and must not be swallowed into a short list.
    if (e instanceof Error && /maxPages/.test(e.message)) truncated = true;
    else throw e;
  }

  return { logs, truncated };
}

// ------------------------------------------------------------------------ comments

export type CommentView = {
  id: string;
  content: string;
  dateCreated: string;
  dateModified: string;
  deleted: boolean;
  /** "node" | "files" | "wiki" — what the comment is attached to. */
  page: string;
};

type RawComment = {
  id: string;
  attributes?: {
    content?: string;
    date_created?: string;
    date_modified?: string;
    deleted?: boolean;
    page?: string;
  };
};

/** Comments on a node. Public projects expose these publicly; OSF offers no export. */
export async function getNodeComments(guid: string): Promise<CommentView[]> {
  return collectAll<CommentView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<{ data: RawComment[]; links: { next: string | null } }>(nextUrl, {
          tags: [`node:${guid}`],
        })
      : await osfGet<{ data: RawComment[]; links: { next: string | null } }>(
          `/nodes/${guid}/comments/?page[size]=100`,
          { tags: [`node:${guid}`] },
        );
    return {
      data: raw.data.map((c) => ({
        id: c.id,
        content: String(c.attributes?.content ?? ""),
        dateCreated: String(c.attributes?.date_created ?? ""),
        dateModified: String(c.attributes?.date_modified ?? ""),
        deleted: Boolean(c.attributes?.deleted),
        page: String(c.attributes?.page ?? ""),
      })),
      links: raw.links,
    };
  });
}

// ----------------------------------------------------------------------- identifiers

export type IdentifierView = { category: string; value: string };

/**
 * DOIs and ARKs minted for a node.
 *
 * Load-bearing for the transition: a project WITH a DOI is one COS will keep resolving,
 * and is therefore usually one to leave in place and redirect rather than mirror. The
 * recommendation engine reads this.
 */
export async function getNodeIdentifiers(guid: string): Promise<IdentifierView[]> {
  const raw = await osfGet<{
    data: { attributes?: { category?: string; value?: string } }[];
    links: { next: string | null };
  }>(`/nodes/${guid}/identifiers/?page[size]=100`, { tags: [`node:${guid}`] });

  return raw.data.map((i) => ({
    category: String(i.attributes?.category ?? ""),
    value: String(i.attributes?.value ?? ""),
  }));
}

/** The DOI, if the node has one. */
export function findDoi(identifiers: IdentifierView[]): string | null {
  return identifiers.find((i) => i.category.toLowerCase() === "doi")?.value ?? null;
}

// ---------------------------------------------------------------------- institutions

export type InstitutionView = { id: string; name: string };

export async function getNodeInstitutions(guid: string): Promise<InstitutionView[]> {
  const raw = await osfGet<{ data: { id: string; attributes?: { name?: string } }[] }>(
    `/nodes/${guid}/institutions/?page[size]=100`,
    { tags: [`node:${guid}`] },
  );
  return raw.data.map((i) => ({ id: i.id, name: String(i.attributes?.name ?? "") }));
}

// --------------------------------------------------------------------------- addons

export type AddonView = { id: string; nodeHasAuth: boolean };

/**
 * Connected third-party storage add-ons (Dropbox, Google Drive, S3, GitHub, …).
 *
 * Their CONTENTS are not OSF-hosted. Waterbutler proxies them through an OAuth grant that
 * can expire or be revoked independently of anything COS does, and once project metadata
 * freezes a broken connection may be unfixable. Files behind an add-on also generally lack
 * the `extra.hashes` that make verification possible.
 *
 * So this is not a cosmetic field: it is the flag that tells a researcher a part of their
 * project is more fragile than the rest, and tells the export layer those files can only
 * ever be marked `unverifiable`.
 */
export async function getNodeAddons(guid: string): Promise<AddonView[]> {
  const raw = await osfGet<{
    data: { id: string; attributes?: { node_has_auth?: boolean } }[];
  }>(`/nodes/${guid}/addons/?page[size]=100`, { tags: [`node:${guid}`] });
  return raw.data.map((a) => ({ id: a.id, nodeHasAuth: Boolean(a.attributes?.node_has_auth) }));
}

// -------------------------------------------------------------------------- licence

export type NodeLicenseView = {
  /** OSF's licence id, e.g. "563c1cf88c5e4a3877f9e96a". */
  id: string;
  /** VERBATIM OSF licence name. The crosswalk matches on this exactly — never retype it. */
  name: string;
  /** Full licence text OSF stores, used when no exact Zenodo id matches. */
  text: string | null;
  /** `node_license`: who holds copyright and for what year. Free-form, often blank. */
  copyrightHolders: string[];
  year: string | null;
};

/**
 * The licence a project asserts, read with `?embed=license`.
 *
 * Measured live on 2026-08-13 against `3kmr9` and `ezcuj`: the licence NAME lives at
 * `data.embeds.license.data.attributes.name` (e.g. "CC-By Attribution 4.0 International" —
 * note the capital B, which is why `mapLicence` lowercases before matching), while
 * `attributes.node_license` carries only `{copyright_holders, year}` and never the name.
 * A project with no licence set has no `license` relationship at all.
 *
 * Returns null when nothing is set. Null here means "OSF asserts no licence", which the
 * crosswalk turns into "choose one before publishing" — never into a guessed licence.
 */
export async function getNodeLicense(guid: string): Promise<NodeLicenseView | null> {
  const raw = await osfGet<{
    data: {
      attributes?: { node_license?: { copyright_holders?: string[]; year?: string | null } };
      embeds?: {
        license?: { data?: { id?: string; attributes?: { name?: string; text?: string } } };
      };
    };
  }>(`/nodes/${guid}/?embed=license`, { tags: [`node:${guid}`] });

  const embedded = raw.data.embeds?.license?.data;
  const name = embedded?.attributes?.name?.trim();
  if (!embedded || !name) return null;

  const nodeLicense = raw.data.attributes?.node_license;
  return {
    id: String(embedded.id ?? ""),
    name,
    text: embedded.attributes?.text ?? null,
    copyrightHolders: (nodeLicense?.copyright_holders ?? []).filter((h) => h.trim().length > 0),
    year: nodeLicense?.year?.trim() || null,
  };
}

// -------------------------------------------------------------------- file versions

export type FileVersionView = {
  id: string;
  size: number;
  contentType: string;
  dateCreated: string;
};

/**
 * Version history for one file (`/v2/files/{id}/versions/`).
 *
 * OSF keeps every uploaded revision, and the default export takes only the current one.
 * Verified live: file `iuky6` returns versions "1" and "2" with different sizes.
 */
export async function getFileVersions(fileId: string): Promise<FileVersionView[]> {
  const raw = await osfGet<{
    data: {
      id: string;
      attributes?: { size?: number; content_type?: string; date_created?: string };
    }[];
  }>(`/files/${fileId}/versions/?page[size]=100`, { tags: [`file:${fileId}`] });

  return raw.data.map((v) => ({
    id: v.id,
    size: Number(v.attributes?.size ?? 0),
    contentType: String(v.attributes?.content_type ?? ""),
    dateCreated: String(v.attributes?.date_created ?? ""),
  }));
}
