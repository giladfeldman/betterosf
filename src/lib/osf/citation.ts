import "server-only";
import { osfGet } from "./client";

type CitationAttributes = {
  title?: string;
  doi?: string;
  publisher?: string;
  type?: string;
  author?: { given?: string; family?: string }[];
  issued?: { "date-parts"?: number[][] };
};

export async function getCitation(guid: string): Promise<CitationAttributes> {
  const raw = await osfGet<{ data: { attributes: CitationAttributes } }>(
    `/nodes/${guid}/citation/`,
    { tags: [`citation:${guid}`], revalidate: 3600 },
  );
  return raw.data.attributes;
}

/**
 * Our format names → OSF's CSL style ids. OSF has no style called `mla`
 * (`404 "mla.csl is not a known style."`); each id here was checked against live
 * OSF on 2026-10-29. Re-check against `/v2/citations/styles/` before adding one.
 */
const OSF_STYLE_ID = {
  apa: "apa",
  mla: "modern-language-association-8th-edition",
  "chicago-author-date": "chicago-author-date",
} as const;

export async function getStyledCitation(
  guid: string,
  style: keyof typeof OSF_STYLE_ID,
): Promise<string> {
  const raw = await osfGet<{ data: { attributes: { citation?: string } } }>(
    `/nodes/${guid}/citation/${OSF_STYLE_ID[style]}/`,
    { tags: [`citation:${guid}`], revalidate: 3600 },
  );
  return raw.data.attributes.citation ?? "";
}

export function toBibTeX(c: CitationAttributes, guid: string): string {
  const year = c.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
  const authors = (c.author ?? [])
    .map((a) => `${a.family ?? ""}, ${a.given ?? ""}`)
    .join(" and ");
  return `@misc{osf:${guid},
  title = {${c.title ?? "Untitled"}},
  author = {${authors}},
  year = {${year}},
  publisher = {${c.publisher ?? "Open Science Framework"}},
  ${c.doi ? `doi = {${c.doi}},` : ""}
  url = {https://osf.io/${guid}/}
}`;
}

export function toRIS(c: CitationAttributes, guid: string): string {
  const year = c.issued?.["date-parts"]?.[0]?.[0] ?? "";
  const authorLines = (c.author ?? [])
    .map((a) => `AU  - ${a.family ?? ""}, ${a.given ?? ""}`)
    .join("\n");
  return `TY  - DATA
TI  - ${c.title ?? "Untitled"}
${authorLines}
PY  - ${year}
PB  - ${c.publisher ?? "Open Science Framework"}
${c.doi ? `DO  - ${c.doi}` : ""}
UR  - https://osf.io/${guid}/
ER  - `;
}
