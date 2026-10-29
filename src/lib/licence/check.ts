/**
 * Licence check — pure logic shared by the API routes and the page.
 *
 * Why this exists: when OSF goes read-only (2027-02-19) a project's licence freezes with
 * it. Siepe, Heck & Quintana found only 27% of papers with OSF materials are licensed
 * (https://osf.io/preprints/psyarxiv/4rjg3_v1); once frozen, the only way left to reuse an
 * unlicensed project is to email its author. So the check is worth most before the freeze,
 * while the licence can still be set.
 *
 * Facts this file rests on, checked 2026-10-29:
 * - `GET /v2/users/me/nodes/?embed=license` returns each node's licence in one call.
 *   Licence NAME at `embeds.license.data.attributes.name`; no licence = no embed data.
 * - OSF's vocabulary (`/v2/licenses/`, 19 entries) includes "No license" and "Other",
 *   which are not reuse licences (same rule as `crosswalk.ts` NON_LICENCE_NAMES).
 * - OSF source `website/project/licenses/__init__.py` `set_license`: WRITE permission is
 *   enough ("You need admin or write permissions to change a node's license"), and a
 *   licence's `required_fields` (year, copyrightHolders — MIT, BSD) must be non-empty.
 * - A component with no licence of its own reports its parent's: OSF's `AbstractNode.license`
 *   walks up the parent chain (`LICENSE_QUERY` in osf/models/node.py). So "Licensed" on a
 *   component can mean inherited, which is the licence that actually applies to it.
 */

/** OSF's id for "CC-By Attribution 4.0 International" — the owner-chosen default (2026-10-29). */
export const DEFAULT_LICENCE_ID = "563c1cf88c5e4a3877f9e96a";

/** Above this, a bulk apply is split into several requests (bounds one invocation's runtime). */
export const APPLY_BATCH_SIZE = 10;

export type LicenceStatus = "licensed" | "none" | "other" | "unknown";

export type LicenceOption = {
  id: string;
  /** VERBATIM OSF name. */
  name: string;
  url: string | null;
  /** OSF's `required_fields`, e.g. ["year", "copyrightHolders"]. */
  requiredFields: string[];
};

export type LicenceRow = {
  guid: string;
  title: string;
  public: boolean;
  /** Parent guid when this is a component, else null. */
  parentId: string | null;
  osfUrl: string;
  /** VERBATIM OSF licence name, or null when none is set. */
  licenceName: string | null;
  licenceId: string | null;
  copyrightHolders: string[];
  year: string | null;
  status: LicenceStatus;
  /** True when the signed-in user has write permission on this node (enough to relicense). */
  canEdit: boolean;
};

const NON_LICENCE = new Map([
  ["no license", "none"],
  ["other", "other"],
] as const);

/**
 * Status of one node's licence.
 *
 * `undefined` = the lookup did not tell us (embed missing or errored) → "unknown", never
 * "none": telling someone a project has no licence when we simply could not read it would
 * send them to relicense something that may already be licensed.
 */
export function classifyLicence(name: string | null | undefined): LicenceStatus {
  if (name === undefined) return "unknown";
  if (name === null) return "none";
  const trimmed = name.trim();
  if (trimmed === "") return "none";
  return NON_LICENCE.get(trimmed.toLowerCase() as "no license" | "other") ?? "licensed";
}

type RawNode = {
  id: string;
  attributes?: {
    title?: string;
    public?: boolean;
    current_user_permissions?: string[];
    node_license?: { copyright_holders?: string[]; year?: string | null } | null;
  };
  relationships?: {
    parent?: { data?: { id?: string } | null };
    license?: { data?: { id?: string } | null };
  };
  links?: { html?: string };
  embeds?: {
    license?: {
      data?: { id?: string; attributes?: { name?: string } } | null;
      errors?: unknown;
    };
  };
};

/** One node from a `?embed=license` listing → a row. Exported for tests. */
export function toLicenceRow(n: RawNode): LicenceRow {
  const a = n.attributes ?? {};
  const embed = n.embeds?.license;
  // No `license` key in embeds at all happens when the node has no licence relationship
  // (measured: `7t8nm` had no embed data). An `errors` member means the embed FAILED.
  // A licence relationship with no readable name in the embed is also "unknown": OSF
  // says a licence exists, we just could not read which one.
  const relatedId = n.relationships?.license?.data?.id ?? null;
  let licenceName: string | null | undefined;
  if (embed?.errors) licenceName = undefined;
  else if (embed?.data?.attributes?.name) licenceName = embed.data.attributes.name;
  else licenceName = relatedId ? undefined : null;
  const holders = (a.node_license?.copyright_holders ?? []).filter((h) => h.trim().length > 0);
  return {
    guid: n.id,
    title: String(a.title ?? ""),
    public: Boolean(a.public),
    parentId: n.relationships?.parent?.data?.id ?? null,
    osfUrl: n.links?.html ?? `https://osf.io/${n.id}/`,
    licenceName: licenceName ?? null,
    licenceId: embed?.data?.id ?? relatedId,
    copyrightHolders: holders,
    year: a.node_license?.year?.trim() || null,
    status: classifyLicence(licenceName),
    canEdit: (a.current_user_permissions ?? []).includes("write"),
  };
}

/** Licences a user may pick: OSF's list minus the two names that are not reuse licences. */
export function pickableLicences(all: LicenceOption[]): LicenceOption[] {
  return all
    .filter((l) => classifyLicence(l.name) === "licensed")
    .sort((x, y) => (x.id === DEFAULT_LICENCE_ID ? -1 : y.id === DEFAULT_LICENCE_ID ? 1 : x.name.localeCompare(y.name)));
}

export type ApplyInput = {
  licenceId: string;
  copyrightHolders: string[];
  year: string;
};

/** Problems with the input, in plain words; empty = OK to send. */
export function validateApply(input: ApplyInput, option: LicenceOption | undefined): string[] {
  const problems: string[] = [];
  if (!option) {
    problems.push("Choose a licence from the list.");
    return problems;
  }
  if (classifyLicence(option.name) !== "licensed") problems.push(`"${option.name}" is not a reuse licence.`);
  const holders = input.copyrightHolders.filter((h) => h.trim().length > 0);
  if (option.requiredFields.includes("copyrightHolders") && holders.length === 0) {
    problems.push(`${option.name} needs at least one copyright holder.`);
  }
  if (option.requiredFields.includes("year") && !/^\d{4}$/.test(input.year.trim())) {
    problems.push(`${option.name} needs a four-digit year.`);
  }
  if (input.year.trim() !== "" && !/^\d{4}$/.test(input.year.trim())) {
    problems.push("Year must be four digits, or left blank.");
  }
  return problems;
}

/** JSON:API body for `PATCH /v2/nodes/{guid}/` that sets a licence (shape from OSF's NodeSerializer). */
export function buildLicencePatch(guid: string, input: ApplyInput) {
  return {
    data: {
      type: "nodes",
      id: guid,
      attributes: {
        node_license: {
          year: input.year.trim(),
          copyright_holders: input.copyrightHolders.map((h) => h.trim()).filter((h) => h.length > 0),
        },
      },
      relationships: { license: { data: { type: "licenses", id: input.licenceId } } },
    },
  };
}

export type ApplyResult =
  /** `row` is what OSF holds after the change, read back — the UI shows this, never the input. */
  | { guid: string; ok: true; row: LicenceRow }
  | { guid: string; ok: false; reason: string };

/**
 * Did the read-back match what we asked for? Only this decides "confirmed" — a 200 from
 * the PATCH is not enough, because a body OSF silently ignored would also return 200.
 */
export function confirmApplied(readBack: LicenceRow, input: ApplyInput): ApplyResult {
  if (readBack.licenceId !== input.licenceId) {
    return {
      guid: readBack.guid,
      ok: false,
      reason: `OSF accepted the change but still shows ${readBack.licenceName ? `"${readBack.licenceName}"` : "no licence"}. Check the project on OSF.`,
    };
  }
  // Same id is not enough when the node already had this licence: the holders and year
  // are the only part that changed, so they must match too.
  const wantHolders = input.copyrightHolders.map((h) => h.trim()).filter((h) => h.length > 0);
  const wantYear = input.year.trim() || null;
  if (readBack.year !== wantYear || JSON.stringify(readBack.copyrightHolders) !== JSON.stringify(wantHolders)) {
    return {
      guid: readBack.guid,
      ok: false,
      reason: "OSF shows the licence, but its copyright holder or year differs from what you entered. Check the project on OSF.",
    };
  }
  return { guid: readBack.guid, ok: true, row: readBack };
}

/**
 * May this row be ticked for a bulk apply? Only "No licence" and "Other". "Couldn't check"
 * means we do not know what OSF holds (overwriting could replace a real licence) and
 * "Licensed" already has one.
 */
export function isTickable(r: Pick<LicenceRow, "canEdit" | "status">): boolean {
  return r.canEdit && (r.status === "none" || r.status === "other");
}

export function summariseRows(rows: LicenceRow[]): Record<LicenceStatus, number> {
  const out: Record<LicenceStatus, number> = { licensed: 0, none: 0, other: 0, unknown: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}
