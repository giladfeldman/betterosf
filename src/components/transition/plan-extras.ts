import type { PlanResponse } from "./plan-types";
import { safeNameSegment } from "@/lib/paths/entry-path";

/**
 * The non-file content OSF offers no export for: wiki pages, and a metadata side-car.
 *
 * Shared by the local export and the Zenodo transfer so both deposit exactly the same
 * thing. It lives here rather than in `ExportRunner` because the transfer panel needs it
 * too, and importing it from there would make the two components import each other — a
 * cycle that ESM resolves by handing one of them `undefined` at module-evaluation time,
 * depending on which the bundler reaches first.
 */
export type PlanExtra = {
  path: string;
  text: string;
  /** Set on wiki pages only: the wiki's real OSF name, which the file name may not keep. */
  wikiName?: string;
};

/**
 * `missing` names every wiki page that could not be fetched (d-927519). It used to be
 * dropped in silence ("recorded by its absence"), so an export or deposit that lacked a
 * wiki page still reconciled as COMPLETE. The runners pass each line to `reconcile()` as
 * a blocker, so the run reports what it lacks.
 */
export async function fetchExtras(plan: PlanResponse): Promise<{ extras: PlanExtra[]; missing: string[] }> {
  const extras: PlanExtra[] = [];
  const missing: string[] = [];
  const wikiFile = wikiFileNamer();

  // `null` means the lookup failed, not "there are none" (review 2026-11-18): reading it as an
  // empty list let a run reconcile complete with every wiki page silently absent.
  if (plan.wikis === null) {
    missing.push("OSF's list of wiki pages could not be read, so no wiki page is in this copy. Run it again, or copy the wiki from OSF by hand.");
  }
  if (plan.contributors === null) {
    missing.push("OSF's contributor list could not be read, so the metadata in this copy names no contributors. Run it again before relying on it.");
  }
  for (const file of plan.unsizedFiles ?? []) {
    missing.push(`OSF did not report a size for "${file.path}", so BetterOSF cannot check that a copy of it is complete and did not copy it. Download that file from OSF directly.`);
  }
  // `?? []` is safe here only because `null` was handled above as missing.
  for (const wiki of plan.wikis ?? []) {
    try {
      const res = await fetch(`/api/transition/wiki/${wiki.id}`, { cache: "no-store" });
      if (res.ok) {
        extras.push({ path: `wikis/${wikiFile(wiki.name, wiki.id)}.md`, text: await res.text(), wikiName: wiki.name });
      } else if (res.status === 410) {
        // Deleted on OSF (d-ad230b): a different fact from "could not be fetched" — retrying
        // cannot bring it back, so do not tell the user to run it again.
        missing.push(`The wiki page "${wiki.name}" was deleted on OSF, so it is not in this copy. OSF keeps no copy of a deleted page, so retrying cannot bring it back.`);
      } else {
        missing.push(`The wiki page "${wiki.name}" could not be fetched from OSF (HTTP ${res.status}), so it is not in this copy. Run it again, or copy that page from OSF by hand.`);
      }
    } catch (e) {
      missing.push(`The wiki page "${wiki.name}" could not be fetched from OSF (${e instanceof Error ? e.message : String(e)}), so it is not in this copy. Run it again, or copy that page from OSF by hand.`);
    }
  }

  extras.push({
    path: "metadata/osf-project.json",
    text: JSON.stringify(
      {
        guid: plan.guid,
        title: plan.title,
        description: plan.description,
        url: plan.osfUrl,
        doi: plan.doi,
        dateCreated: plan.dateCreated,
        dateModified: plan.dateModified,
        tags: plan.tags,
        category: plan.category,
        license: plan.license ?? null,
        addonProviders: plan.addonProviders,
        contributors: plan.contributors,
      },
      null,
      2,
    ),
  });

  return { extras, missing };
}

/**
 * Wiki page -> file name, through the shared sanitiser (d-d7a103, review R-0156).
 *
 * A local `[^\w. -]` -> `_` rule used to live here. JavaScript's `\w` is ASCII-only, so three
 * wikis named "研究", "数据", "方法" all became `_.md`: one ZIP entry, three "verified" rows.
 * `safeNameSegment` keeps every Unicode letter and rewrites only what a filesystem forbids.
 *
 * Two different wikis can still sanitise to the same name ("a<b" / "a>b"), or differ only by
 * case ("Home" / "home", which Windows and macOS treat as one file). The second one then
 * gets its OSF wiki id appended — unique by construction — rather than overwriting the first.
 * The RO-Crate keeps the wiki's real name (`wikiName`), so the rename is never silent.
 */
export function wikiFileNamer(): (name: string, id: string) => string {
  const used = new Set<string>();
  return (name, id) => {
    const base = safeNameSegment(name).slice(0, 80);
    let candidate = base;
    if (used.has(candidate.toLowerCase())) candidate = `${base} (${safeNameSegment(id)})`;
    let n = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base} (${safeNameSegment(id)}-${n++})`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}
