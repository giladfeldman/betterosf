import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { requireOsfWriteToken } from "./write";
import { collectionTotal } from "./users";
import {
  buildLicencePatch,
  confirmApplied,
  toLicenceRow,
  type ApplyInput,
  type ApplyResult,
  type LicenceOption,
  type LicenceRow,
} from "@/lib/licence/check";

const OSF_API_BASE = "https://api.osf.io/v2";

type Collection = {
  data: Parameters<typeof toLicenceRow>[0][];
  links: { next: string | null; meta?: { total?: number } };
};

export type LicencePage = { rows: LicenceRow[]; next: string | null; total: number | null };

/** ONE page (up to 100) of the signed-in user's projects and components, with licences. */
export async function getMyLicencePage(cursor?: string): Promise<LicencePage> {
  const raw = cursor
    ? await osfGetUrl<Collection>(cursor, { revalidate: 0 })
    : await osfGet<Collection>("/users/me/nodes/?embed=license&page[size]=100", { revalidate: 0 });
  return {
    rows: raw.data.map(toLicenceRow),
    next: raw.links?.next ?? null,
    total: collectionTotal(raw.links),
  };
}

/** OSF's licence vocabulary (19 entries on 2026-10-29). Public and stable: cached for a day. */
export async function listOsfLicences(): Promise<LicenceOption[]> {
  const raw = await osfGet<{
    data: { id: string; attributes: { name: string; url?: string | null; required_fields?: string[] } }[];
  }>("/licenses/?page[size]=100", { revalidate: 86_400 });
  return raw.data.map((l) => ({
    id: l.id,
    name: l.attributes.name,
    url: l.attributes.url || null,
    requiredFields: l.attributes.required_fields ?? [],
  }));
}

/**
 * Set one node's licence, then read it back. The read-back alone decides success.
 * Throws OsfWriteError when the user has not granted OSF write access.
 */
export async function applyLicence(guid: string, input: ApplyInput): Promise<ApplyResult> {
  const token = await requireOsfWriteToken();
  const res = await fetch(`${OSF_API_BASE}/nodes/${encodeURIComponent(guid)}/`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(buildLicencePatch(guid, input)),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { guid, ok: false, reason: describePatchFailure(res.status, body) };
  }
  const readBack = await osfGet<{ data: Parameters<typeof toLicenceRow>[0] }>(
    `/nodes/${encodeURIComponent(guid)}/?embed=license`,
    { revalidate: 0 },
  );
  return confirmApplied(toLicenceRow(readBack.data), input);
}

/** OSF's error → one plain sentence. Exported for tests. */
export function describePatchFailure(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { errors?: { detail?: string }[] };
    detail = parsed.errors?.map((e) => e.detail).filter(Boolean).join(" ") ?? "";
  } catch {
    detail = "";
  }
  if (status === 401) return "Your OSF sign-in has expired. Sign in again and retry.";
  if (status === 403) return "OSF refused: you need write permission on this project to change its licence.";
  if (status === 429) return "OSF is rate-limiting requests. Wait a minute and retry.";
  if (status === 400 && detail) return `OSF rejected the change: ${detail}`;
  // Not "nothing was changed": a 5xx can arrive after OSF saved the change.
  if (status >= 500) return `OSF had a server error (${status}). The change may or may not have been saved — run the check again to see.`;
  return `OSF returned ${status}${detail ? `: ${detail}` : ""}.`;
}
