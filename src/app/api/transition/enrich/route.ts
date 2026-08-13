import { z } from "zod";
import { requireTransitionActor, guardResponse } from "@/lib/transition/guard";
import { isValidGuid } from "@/lib/osf/guid";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { getNodeAddons, getNodeIdentifiers, findDoi } from "@/lib/osf/project-extras";
import { getNodeWikis } from "@/lib/osf/wikis";
import { getNodeStorage, type StorageUsage } from "@/lib/osf/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tier 2 of the inventory: the costly per-project facts, in BATCHES.
 *
 * `api.osf.io` sends no CORS headers, so every one of these calls has to travel through
 * our own function. Done naively — one request per project per field — an inventory of
 * 300 projects would be ~1200 invocations. Batched at 10 projects × 4 upstream calls, it
 * is ~30 invocations. That difference is the entire reason this endpoint exists, and why
 * the batch size is a cap rather than a suggestion.
 *
 * File counts are deliberately NOT computed here: they require walking the whole file
 * tree, which is far more expensive than everything else combined and is only needed once
 * a researcher actually opens a project. The inventory shows "—" until then rather than a
 * number it had to buy.
 */
const MAX_BATCH = 10;
const UPSTREAM_CONCURRENCY = 4;

const bodySchema = z.object({
  guids: z.array(z.string()).min(1).max(MAX_BATCH),
});

export type EnrichedProject = {
  guid: string;
  hasDoi: boolean | null;
  doi: string | null;
  /** Null when the lookup failed — NOT the same as an empty list. */
  addonProviders: string[] | null;
  wikiCount: number | null;
  storage: StorageUsage;
  /** Populated when a section failed, so the UI can say so instead of showing a zero. */
  errors: Record<string, string>;
};

export async function POST(req: Request): Promise<Response> {
  const guard = await requireTransitionActor();
  if (!guard.ok) return guardResponse(guard);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: `Send between 1 and ${MAX_BATCH} project ids.` },
      { status: 400, headers: noStore },
    );
  }

  const guids = parsed.data.guids.filter(isValidGuid);
  if (guids.length === 0) {
    return Response.json({ error: "No valid project ids." }, { status: 400, headers: noStore });
  }

  const results = await mapWithConcurrency(guids, UPSTREAM_CONCURRENCY, enrichOne);

  return Response.json({ projects: results }, { headers: noStore });
}

/**
 * Enrich one project.
 *
 * Every section is settled independently and a failure is RECORDED, never swallowed into
 * a zero. A project whose add-on lookup failed must not render as "no add-ons" — that is
 * the difference between "this project has no third-party storage" and "we do not know
 * whether it does", and only one of those is safe to act on.
 */
async function enrichOne(guid: string): Promise<EnrichedProject> {
  const errors: Record<string, string> = {};

  const [identifiers, addons, wikis, storage] = await Promise.all([
    getNodeIdentifiers(guid).catch((e) => {
      errors.identifiers = message(e);
      return null;
    }),
    getNodeAddons(guid).catch((e) => {
      errors.addons = message(e);
      return null;
    }),
    getNodeWikis(guid).catch((e) => {
      errors.wikis = message(e);
      return null;
    }),
    // getNodeStorage never throws — it returns an explicit "not known" with a reason.
    getNodeStorage(guid),
  ]);

  const doi = identifiers ? findDoi(identifiers) : null;

  return {
    guid,
    // null, not false, when we could not check. "No DOI" and "unknown" drive different
    // recommendations, and conflating them would tell someone their cited work has no
    // persistent identifier.
    hasDoi: identifiers ? doi !== null : null,
    doi,
    // null, not [], on failure. An empty array asserts "this project uses no third-party
    // storage" — a claim that, if wrong, hides the one part of a project whose files
    // cannot be verified and whose connection may break irreparably.
    addonProviders: addons ? addons.map((a) => a.id) : null,
    wikiCount: wikis ? wikis.length : null,
    storage,
    errors,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

const noStore = { "Cache-Control": "private, no-store" } as const;
