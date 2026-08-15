import type { PlanResponse } from "./plan-types";

/**
 * The nodes an export covers, root first, in the shape the report renders.
 *
 * Built in one place so the local-export and Zenodo-transfer paths cannot describe the same
 * plan differently — a scope statement that disagreed with itself across two artefacts
 * would be worse than none.
 *
 * A node whose walk FAILED is included with the file count it actually contributed, so a
 * component that yielded nothing is visible rather than absent. The error itself is already
 * on screen in the preflight and, because those files are missing from the plan,
 * `reconcile()` never sees them as expected — which is why the report has to name the node.
 */
export function coveredNodesFrom(plan: PlanResponse): {
  guid: string;
  title: string;
  kind: string;
  fileCount: number;
}[] {
  return [
    { guid: plan.guid, title: plan.title, kind: "project", fileCount: plan.rootFileCount },
    ...plan.included.map((i) => ({
      guid: i.guid,
      title: i.title,
      kind: i.error ? `${i.kind} — COULD NOT BE READ` : i.kind,
      fileCount: i.fileCount,
    })),
  ];
}
