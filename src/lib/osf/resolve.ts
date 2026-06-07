import "server-only";
import { osfGet } from "./client";

/**
 * OSF uses a single FLAT guid namespace: `osf.io/<guid>` resolves to *any*
 * object type — a project (node), a registration, a preprint, a user, or an
 * individual file. BetterOSF historically assumed every guid was a node, so a
 * registration link like `osf.io/p9qb4` (the canonical URL for a
 * pre-registration) 404'd with "Project not found".
 *
 * `resolveGuidType` uses OSF's generic guid resolver (`/v2/guids/<id>/`), which
 * returns the full referent object including its `data.type`, so the bare
 * `/<guid>` route can dispatch to the correct view.
 */
export type OsfKind = "node" | "registration" | "preprint" | "user" | "file" | "unknown";

export type ResolvedFile = {
  /** The node/registration guid that contains the file (the file-viewer route key). */
  resourceId: string;
  provider: string;
  /** Materialized path WITHOUT leading slash, e.g. "data/raw.csv". */
  path: string;
  name: string;
};

export type ResolvedGuid =
  | { kind: Exclude<OsfKind, "file">; id: string }
  | { kind: "file"; id: string; file: ResolvedFile | null };

type RawReferent = {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      provider?: string;
      materialized_path?: string;
      path?: string;
      name?: string;
    };
    relationships?: {
      target?: { data?: { id?: string; type?: string } };
      node?: { data?: { id?: string } };
    };
    links?: { html?: string };
  };
};

function mapType(type: string | undefined): OsfKind {
  switch (type) {
    case "nodes":
      return "node";
    case "registrations":
      return "registration";
    case "preprints":
      return "preprint";
    case "users":
      return "user";
    case "files":
      return "file";
    default:
      return "unknown";
  }
}

/** Build the file-viewer redirect target from a resolved file referent, or null
 *  if the referent is missing the pieces the viewer route needs. */
function parseFile(raw: RawReferent["data"]): ResolvedFile | null {
  if (!raw) return null;
  const a = raw.attributes ?? {};
  const provider = a.provider;
  const rawPath = a.materialized_path ?? a.path ?? "";
  const path = rawPath.replace(/^\/+/, "");
  const name = a.name ?? path.split("/").filter(Boolean).pop() ?? "";
  // The containing node/registration guid: prefer the explicit target/node
  // relationship, fall back to the html link (osf.io/<resource>/files/...).
  let resourceId =
    raw.relationships?.target?.data?.id ?? raw.relationships?.node?.data?.id ?? "";
  if (!resourceId && raw.links?.html) {
    const m = raw.links.html.match(/osf\.io\/([a-zA-Z0-9]{2,8})\//);
    if (m && m[1]) resourceId = m[1];
  }
  if (!resourceId || !provider || !path) return null;
  return { resourceId, provider, path, name };
}

export async function resolveGuidType(guid: string): Promise<ResolvedGuid> {
  const raw = await osfGet<RawReferent>(`/guids/${guid}/`, {
    tags: [`guid:${guid}`],
    revalidate: 300,
  });
  const kind = mapType(raw.data?.type);
  const id = raw.data?.id ?? guid;
  if (kind === "file") {
    return { kind, id, file: parseFile(raw.data) };
  }
  return { kind, id };
}
