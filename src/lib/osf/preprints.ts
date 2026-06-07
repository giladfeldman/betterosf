import "server-only";
import { osfGet, osfGetUrl } from "./client";

export type PreprintView = {
  id: string;
  title: string;
  description: string;
  datePublished: string;
  doi: string | null;
  osfUrl: string;
  isPublished: boolean;
  dateWithdrawn: string | null;
  /** The supplemental project node guid, if the preprint has one. */
  supplementalNodeId: string | null;
  /** Primary file (the manuscript) — usually a PDF rendered inline. */
  primaryFile: { name: string; size: number | null; downloadUrl: string } | null;
  authors: string[];
};

type RawPreprint = {
  data: {
    id: string;
    type: string;
    attributes: {
      title?: string;
      description?: string;
      date_published?: string;
      doi?: string | null;
      is_published?: boolean;
      date_withdrawn?: string | null;
    };
    relationships?: {
      node?: { data?: { id?: string } | null };
      primary_file?: { links?: { related?: { href?: string } } };
    };
    links?: { html?: string; preprint_doi?: string };
  };
};

type RawFile = {
  data?: {
    attributes?: { name?: string; size?: number | null };
    links?: { download?: string };
  };
};

type RawContribs = {
  data: Array<{
    embeds?: { users?: { data?: { attributes?: { full_name?: string } } } };
  }>;
};

function parse(raw: RawPreprint): PreprintView {
  const a = raw.data.attributes;
  return {
    id: raw.data.id,
    title: String(a.title ?? ""),
    description: String(a.description ?? ""),
    datePublished: String(a.date_published ?? ""),
    doi: a.doi ?? null,
    osfUrl: raw.data.links?.html ?? `https://osf.io/${raw.data.id}/`,
    isPublished: a.is_published !== false,
    dateWithdrawn: a.date_withdrawn ?? null,
    supplementalNodeId: raw.data.relationships?.node?.data?.id ?? null,
    // primaryFile + authors are filled in best-effort by getPreprint().
    primaryFile: null,
    authors: [],
  };
}

export type PreprintListItem = { id: string; title: string; datePublished: string; osfUrl: string };

type RawPreprintList = {
  data: Array<{
    id: string;
    attributes: { title?: string; date_published?: string };
    links?: { html?: string };
  }>;
  meta?: { total?: number };
};

/** First page (up to 100) of a user's preprints, with total count. */
export async function getUserPreprints(userId: string): Promise<{ results: PreprintListItem[]; total: number }> {
  const raw = await osfGet<RawPreprintList>(`/users/${userId}/preprints/?page[size]=100`, {
    tags: [`user:${userId}`],
    revalidate: 300,
  });
  return {
    results: raw.data.map((p) => ({
      id: p.id,
      title: String(p.attributes.title ?? ""),
      datePublished: String(p.attributes.date_published ?? ""),
      osfUrl: p.links?.html ?? `https://osf.io/${p.id}/`,
    })),
    total: raw.meta?.total ?? raw.data.length,
  };
}

export async function getPreprint(guid: string): Promise<PreprintView> {
  // NOTE: do NOT use `?embed=primary_file` here. OSF's API reliably returns
  // 502 Bad Gateway for `/v2/preprints/<id>/?embed=primary_file` (confirmed
  // 2026-06-07 for both base and versioned guids), even though the bare
  // endpoint is 200. We therefore fetch the bare preprint and resolve the
  // manuscript via the primary_file relationship link separately, best-effort.
  const raw = await osfGet<RawPreprint>(`/preprints/${guid}/`, {
    tags: [`preprint:${guid}`],
    revalidate: 300,
  });
  const view = parse(raw);

  // Primary file (the manuscript). Best-effort: a missing/forbidden file must
  // not break the whole preprint page — metadata + abstract still render.
  const pfHref = raw.data.relationships?.primary_file?.links?.related?.href;
  if (pfHref) {
    try {
      const file = await osfGetUrl<RawFile>(pfHref, { tags: [`preprint:${guid}`], revalidate: 300 });
      const download = file.data?.links?.download ?? "";
      if (download) {
        view.primaryFile = {
          name: String(file.data?.attributes?.name ?? "manuscript"),
          size: file.data?.attributes?.size ?? null,
          downloadUrl: download,
        };
      }
    } catch {
      /* leave primaryFile null — page renders without the inline manuscript */
    }
  }

  // Authors are a nice-to-have; fetch them best-effort so a contributors 403
  // (e.g. anonymized preprint) never breaks the page.
  try {
    const contribs = await osfGet<RawContribs>(
      `/preprints/${guid}/bibliographic_contributors/?embed=users&page[size]=100`,
      { tags: [`preprint:${guid}`], revalidate: 300 },
    );
    view.authors = contribs.data
      .map((c) => c.embeds?.users?.data?.attributes?.full_name ?? "")
      .filter((n) => n.length > 0);
  } catch {
    /* leave authors empty */
  }

  return view;
}
