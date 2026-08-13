import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

/**
 * OSF wikis.
 *
 * OSF has NO wiki export in its own UI — the help guide tells people to copy the text out
 * by hand or use the API. That makes this the single highest-value reader in the toolkit:
 * once a project goes read-only, a wiki is the part most likely to be lost, because it is
 * the part nobody has a copy of.
 *
 * Endpoints (all verified live 2026-08-13):
 *   /v2/nodes/{guid}/wikis/       → list, each with links.download
 *   /v2/wikis/{id}/content/       → the raw markdown, Content-Type: text/markdown
 *   /v2/wikis/{id}/versions/      → version history, newest first
 */

export type WikiPageView = {
  id: string;
  name: string;
  /** Bytes, as OSF reports them. Cross-checked against the fetched body. */
  size: number;
  contentType: string;
  dateModified: string;
  /** Absolute URL of the raw markdown. */
  contentUrl: string;
  /** OSF's own version counter, when present. */
  version: number | null;
};

type RawWiki = {
  id: string;
  attributes?: {
    name?: string;
    size?: number;
    content_type?: string;
    date_modified?: string;
    extra?: { version?: number };
  };
  links?: { download?: string; info?: string };
};

type WikiCollection = { data: RawWiki[]; links: { next: string | null } };

function parseWiki(raw: RawWiki): WikiPageView {
  return {
    id: raw.id,
    name: String(raw.attributes?.name ?? ""),
    size: Number(raw.attributes?.size ?? 0),
    contentType: String(raw.attributes?.content_type ?? "text/markdown"),
    dateModified: String(raw.attributes?.date_modified ?? ""),
    contentUrl: raw.links?.download ?? `https://api.osf.io/v2/wikis/${raw.id}/content/`,
    version: raw.attributes?.extra?.version ?? null,
  };
}

/** Every wiki page on a node. Empty array when the node has none or wikis are disabled. */
export async function getNodeWikis(guid: string): Promise<WikiPageView[]> {
  return collectAll<WikiPageView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<WikiCollection>(nextUrl, { tags: [`node:${guid}`] })
      : await osfGet<WikiCollection>(`/nodes/${guid}/wikis/?page[size]=100`, {
          tags: [`node:${guid}`],
        });
    return { data: raw.data.map(parseWiki), links: raw.links };
  });
}

export type WikiVersionView = {
  id: string;
  size: number;
  contentType: string;
  dateCreated: string;
};

type RawWikiVersion = {
  id: string;
  attributes?: { size?: number; content_type?: string; date_created?: string };
};

/**
 * Version history for one wiki page, newest first.
 *
 * Only fetched when the user asks for version history: a project with many wikis and long
 * histories multiplies into a lot of requests, and the current text is what most people
 * actually need.
 */
export async function getWikiVersions(wikiId: string): Promise<WikiVersionView[]> {
  return collectAll<WikiVersionView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<{ data: RawWikiVersion[]; links: { next: string | null } }>(nextUrl, {
          tags: [`wiki:${wikiId}`],
        })
      : await osfGet<{ data: RawWikiVersion[]; links: { next: string | null } }>(
          `/wikis/${wikiId}/versions/?page[size]=100`,
          { tags: [`wiki:${wikiId}`] },
        );
    return {
      data: raw.data.map((v) => ({
        id: v.id,
        size: Number(v.attributes?.size ?? 0),
        contentType: String(v.attributes?.content_type ?? "text/markdown"),
        dateCreated: String(v.attributes?.date_created ?? ""),
      })),
      links: raw.links,
    };
  });
}
