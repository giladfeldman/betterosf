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

export async function getStyledCitation(
  guid: string,
  style: "apa" | "mla" | "chicago-author-date",
): Promise<string> {
  const raw = await osfGet<{ data: { attributes: { citation?: string } } }>(
    `/nodes/${guid}/citation/${style}/`,
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
