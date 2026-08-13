import type { PlanResponse } from "./plan-types";

/**
 * The non-file content OSF offers no export for: wiki pages, and a metadata side-car.
 *
 * Shared by the local export and the Zenodo transfer so both deposit exactly the same
 * thing. It lives here rather than in `ExportRunner` because the transfer panel needs it
 * too, and importing it from there would make the two components import each other — a
 * cycle that ESM resolves by handing one of them `undefined` at module-evaluation time,
 * depending on which the bundler reaches first.
 */
export async function fetchExtras(plan: PlanResponse): Promise<{ path: string; text: string }[]> {
  const extras: { path: string; text: string }[] = [];

  for (const wiki of plan.wikis ?? []) {
    try {
      const res = await fetch(`/api/transition/wiki/${wiki.id}`, { cache: "no-store" });
      if (res.ok) {
        extras.push({ path: `wikis/${safeName(wiki.name)}.md`, text: await res.text() });
      }
    } catch {
      /* a missing wiki is recorded by its absence from the manifest, not faked */
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

  return extras;
}

export function safeName(name: string): string {
  return name.replace(/[^\w. -]+/g, "_").slice(0, 80) || "untitled";
}
