import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

export type RegistrationView = {
  id: string;
  title: string;
  dateRegistered: string;
  public: boolean;
  osfUrl: string;
};

type RawReg = {
  id: string;
  type: string;
  attributes: { title?: string; date_registered?: string; public?: boolean };
  links?: { html?: string };
};

type CollectionResponse = { data: RawReg[]; links: { next: string | null } };

function parse(raw: RawReg): RegistrationView {
  return {
    id: raw.id,
    title: String(raw.attributes.title ?? ""),
    dateRegistered: String(raw.attributes.date_registered ?? ""),
    public: Boolean(raw.attributes.public),
    osfUrl: raw.links?.html ?? `https://osf.io/${raw.id}/`,
  };
}

export async function getNodeRegistrations(guid: string): Promise<RegistrationView[]> {
  return collectAll<RegistrationView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<CollectionResponse>(nextUrl, { tags: [`node:${guid}`] })
      : await osfGet<CollectionResponse>(`/nodes/${guid}/registrations/?page[size]=100`, { tags: [`node:${guid}`] });
    return { data: raw.data.map(parse), links: raw.links };
  });
}
