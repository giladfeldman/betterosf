import "server-only";
import { osfGet, osfGetUrl } from "./client";
import { collectAll } from "./paginate";

/**
 * Node contributors, with the embedded user record so ORCIDs come along.
 *
 * `?embed=users` is what makes this ONE request per page instead of one per contributor —
 * the difference between ~4 calls and ~40 for a large collaboration, which matters when
 * the inventory crawls hundreds of projects through our own proxy.
 *
 * Order, bibliographic status, and permission are all carried because they are part of the
 * authorship record and have NO home in DataCite. The crosswalk drops them; the side-car
 * keeps them. Losing them silently would quietly rewrite who is credited and how.
 */

export type ContributorView = {
  /** Contributor row id, e.g. "8cd4r-tmwry". Not the user id. */
  id: string;
  userId: string | null;
  fullName: string;
  givenName: string | null;
  familyName: string | null;
  /** Bare 16-character ORCID, ONLY when OSF reports it as VERIFIED. */
  orcid: string | null;
  /**
   * OSF's verification status for the ORCID, verbatim ("VERIFIED", "CREATE", "LINK", …),
   * or null if the contributor has none. Kept so the export can say "this person has an
   * unverified ORCID on OSF" instead of silently dropping it.
   */
  orcidStatus: string | null;
  /** Author order as shown on OSF. */
  index: number;
  /** False for people credited internally but not listed as authors. */
  bibliographic: boolean;
  /** "admin" | "write" | "read" — no DataCite equivalent. */
  permission: string;
  /** OSF allows unregistered contributors, who have a name but no user record. */
  unregistered: boolean;
};

type RawUser = {
  id?: string;
  attributes?: {
    full_name?: string;
    given_name?: string;
    family_name?: string;
    /**
     * Where ORCID ACTUALLY lives — verified live 2026-08-13:
     *   external_identity: { ORCID: { id: "0000-0002-8713-1972", status: "VERIFIED" } }
     *
     * NOT in `social`. A 50-user sample found 24 with a verified ORCID here and ZERO
     * with `social.orcid` set — that key appears to be vestigial. Reading `social.orcid`
     * would have produced a null ORCID for every contributor while the crosswalk claimed
     * to map them.
     */
    external_identity?: Record<string, { id?: string; status?: string } | undefined>;
    social?: Record<string, unknown>;
  };
};

type RawContributor = {
  id: string;
  attributes?: {
    index?: number;
    bibliographic?: boolean;
    permission?: string;
    unregistered_contributor?: string | null;
  };
  embeds?: { users?: { data?: RawUser } };
  relationships?: { users?: { data?: { id?: string } } };
};

type ContributorCollection = { data: RawContributor[]; links: { next: string | null } };

function parseContributor(raw: RawContributor): ContributorView {
  const user = raw.embeds?.users?.data;
  const attrs = user?.attributes;
  const unregisteredName = raw.attributes?.unregistered_contributor ?? null;
  const orcid = extractOrcid(attrs?.external_identity);

  return {
    id: raw.id,
    userId: user?.id ?? raw.relationships?.users?.data?.id ?? null,
    fullName: String(attrs?.full_name ?? unregisteredName ?? ""),
    givenName: attrs?.given_name ? String(attrs.given_name) : null,
    familyName: attrs?.family_name ? String(attrs.family_name) : null,
    orcid: orcid.id,
    orcidStatus: orcid.status,
    index: Number(raw.attributes?.index ?? 0),
    bibliographic: Boolean(raw.attributes?.bibliographic),
    permission: String(raw.attributes?.permission ?? ""),
    unregistered: Boolean(unregisteredName),
  };
}

/**
 * Pull the ORCID out of OSF's `external_identity` map.
 *
 * Only a **VERIFIED** identity yields an id. Asserting an unverified ORCID into a
 * DataCite record would be publishing a claim about a real person that neither we nor
 * OSF can stand behind — so the status travels separately and the id stays null.
 *
 * The key is looked up case-insensitively: OSF writes "ORCID" today, and this should not
 * break if that ever becomes "orcid".
 */
export function extractOrcid(
  external: Record<string, { id?: string; status?: string } | undefined> | undefined,
): { id: string | null; status: string | null } {
  if (!external) return { id: null, status: null };

  const entry = Object.entries(external).find(([key]) => key.toLowerCase() === "orcid")?.[1];
  if (!entry?.id) return { id: null, status: null };

  const status = entry.status ?? null;
  const normalised = normaliseOrcid(entry.id);
  return {
    id: status?.toUpperCase() === "VERIFIED" ? normalised : null,
    status,
  };
}

/** "https://orcid.org/0000-0002-1825-0097" and "0000-0002-1825-0097" both → the bare form. */
export function normaliseOrcid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return match ? match[1]!.toUpperCase() : null;
}

export async function getNodeContributors(guid: string): Promise<ContributorView[]> {
  const contributors = await collectAll<ContributorView>(async (nextUrl) => {
    const raw = nextUrl
      ? await osfGetUrl<ContributorCollection>(nextUrl, { tags: [`node:${guid}`] })
      : await osfGet<ContributorCollection>(
          `/nodes/${guid}/contributors/?page[size]=100&embed=users`,
          { tags: [`node:${guid}`] },
        );
    return { data: raw.data.map(parseContributor), links: raw.links };
  });

  // OSF returns them in order, but the crosswalk depends on it, so make it explicit
  // rather than inherited from an undocumented server behaviour.
  return contributors.sort((a, b) => a.index - b.index);
}
