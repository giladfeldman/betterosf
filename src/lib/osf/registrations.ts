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

export type RegistrationDetailView = RegistrationView & {
  description: string;
  responses: Record<string, string | string[] | number | boolean | null>;
  registeredFromNodeId: string | null;
  schemaUrl: string;
};

type RawRegDetail = {
  data: {
    id: string;
    type: string;
    attributes: {
      title?: string;
      description?: string;
      date_registered?: string;
      public?: boolean;
      registration_responses?: Record<string, string | string[] | number | boolean | null>;
    };
    relationships?: {
      registered_from?: { data?: { id?: string } };
      registration_schema?: { links?: { related?: { href?: string } } };
    };
    links?: { html?: string };
  };
};

export async function getRegistration(guid: string): Promise<RegistrationDetailView> {
  const raw = await osfGet<RawRegDetail>(`/registrations/${guid}/`, {
    tags: [`registration:${guid}`],
    revalidate: 300,
  });
  const a = raw.data.attributes;
  return {
    id: raw.data.id,
    title: String(a.title ?? ""),
    description: String(a.description ?? ""),
    dateRegistered: String(a.date_registered ?? ""),
    public: Boolean(a.public),
    osfUrl: raw.data.links?.html ?? `https://osf.io/${raw.data.id}/`,
    responses: a.registration_responses ?? {},
    registeredFromNodeId: raw.data.relationships?.registered_from?.data?.id ?? null,
    schemaUrl: raw.data.relationships?.registration_schema?.links?.related?.href ?? "",
  };
}
