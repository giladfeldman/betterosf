"use client";

import type { PlanResponse } from "./plan-types";

/**
 * Which components, linked projects and registrations travel with the export.
 *
 * An export used to cover ONE node, silently. "A complete copy" of a project with six
 * components was a copy of a seventh of it, and `reconcile()` called it complete because it
 * reconciles against a plan that never mentioned them.
 *
 * The defaults encode what is actually at stake on 2027-02-19:
 *   - **Components: on.** They are part of the project and share its fate exactly.
 *   - **Registrations: off.** They are frozen, unaffected by the transition, and stay on OSF
 *     at the same DOI. Copying one is completeness, not rescue — and it duplicates a record
 *     COS is keeping online.
 *   - **Linked projects: off.** They belong to other people, who get their own decision.
 */
export function RelatedNodesPicker({
  plan,
  selected,
  onChange,
  disabled,
}: {
  plan: PlanResponse;
  /** Guids currently included. The root is always in and never listed here. */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
}) {
  const groups: {
    key: "components" | "linkedProjects" | "registrations";
    label: string;
    rows: { guid: string; title: string; hint?: string }[] | null;
    blurb: string;
  }[] = [
    {
      key: "components",
      label: "Components",
      rows: plan.components?.map((c) => ({ guid: c.guid, title: c.title })) ?? null,
      blurb:
        "Part of this project and affected by the same deadlines. Included by default — leaving them out makes the copy a copy of the root only.",
    },
    {
      key: "registrations",
      label: "Registrations",
      rows:
        plan.registrations?.map((r) => ({
          guid: r.guid,
          title: r.title,
          hint: `${r.public ? "public" : "private"}${r.dateRegistered ? `, registered ${r.dateRegistered.slice(0, 10)}` : ""}`,
        })) ?? null,
      blurb:
        "Frozen, and NOT affected by the OSF Projects wind-down — they stay on OSF at the same DOI. Off by default: including one gives you a second copy of something that is not going anywhere. Tick it if you want your preregistration to travel with the data anyway.",
    },
    {
      key: "linkedProjects",
      label: "Linked projects",
      rows: plan.linkedProjects?.map((l) => ({ guid: l.guid, title: l.title })) ?? null,
      blurb:
        "Other people's projects that this one links to. Off by default — they are not yours to migrate, and their owners get their own decision.",
    },
  ];

  const anything = groups.some((g) => (g.rows?.length ?? 0) > 0 || g.rows === null);
  if (!anything) return null;

  function toggle(guid: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(guid);
    else next.delete(guid);
    onChange(next);
  }

  return (
    <div className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-sm font-semibold">What else should travel with it?</h3>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        Anything ticked is copied and verified file by file, alongside the root project, and counts
        towards whether this run reconciles as complete.
      </p>

      {groups.map((group) => (
        <div key={group.key} className="mt-4">
          <h4 className="text-sm font-medium">
            {group.label}{" "}
            {group.rows === null ? null : (
              <span className="font-normal text-neutral-600 dark:text-neutral-400">
                ({group.rows.length})
              </span>
            )}
          </h4>
          {group.rows === null ? (
            // Not "there are none" — we could not find out, and the two must never look
            // the same. An export that quietly omitted a component nobody was told about
            // would reconcile as complete while being the failure this toolkit exists for.
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              BetterOSF could not read this project&apos;s {group.label.toLowerCase()} from OSF, so it
              cannot say whether there are any. Reload the page; if it keeps failing, treat this export
              as covering the root project only.
            </p>
          ) : group.rows.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">None.</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{group.blurb}</p>
              <ul className="mt-2 space-y-1">
                {group.rows.map((row) => (
                  <li key={row.guid}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(row.guid)}
                        disabled={disabled}
                        onChange={(e) => toggle(row.guid, e.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span>
                        {row.title}{" "}
                        <a
                          href={`https://osf.io/${row.guid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs underline"
                        >
                          {row.guid}
                        </a>
                        {row.hint ? (
                          <span className="text-xs text-neutral-600 dark:text-neutral-400"> — {row.hint}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}

      {plan.included.some((i) => i.error) ? (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>Some of what you selected could not be read from OSF:</p>
          <ul className="mt-1 list-disc pl-5">
            {plan.included
              .filter((i) => i.error)
              .map((i) => (
                <li key={i.guid}>
                  <code>{i.guid}</code> {i.title} — {i.error}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {plan.skippedNodes.length > 0 ? (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {plan.skippedNodes.length} selected node(s) were not read, because one plan covers at most{" "}
          {plan.limits.maxRelatedNodes} extra nodes (or the {plan.limits.maxFiles}-file cap was reached
          first): <code>{plan.skippedNodes.join(", ")}</code>. Export them separately from their own
          pages — this run does not include them and must not be read as if it did.
        </p>
      ) : null}

      {plan.included.length > 0 ? (
        <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
          {plan.rootFileCount} file(s) from the root project, plus{" "}
          {plan.files.length - plan.rootFileCount} from{" "}
          {plan.included.filter((i) => !i.error).length} other node(s), stored under{" "}
          <code>{plan.included[0]!.prefix}…</code> so nothing collides with the root&apos;s own paths.
        </p>
      ) : null}
    </div>
  );
}

/** Guids ticked by default: components in, everything else out. */
export function defaultSelection(plan: PlanResponse): Set<string> {
  return new Set((plan.components ?? []).map((c) => c.guid));
}
