import type { PlanResponse } from "./plan-types";

/**
 * Files OSF listed without a size are not planned for transfer (d-e058e3): without a declared
 * size neither the download nor the completeness check can be finished. Cross-model review
 * 2026-11-19 found the screens before Start never said so — a project whose files were ALL
 * unsized read "This project has no files". Unknown is not zero: say what is there.
 */
export function UnsizedFilesNotice({ plan }: { plan: Pick<PlanResponse, "unsizedFiles"> }) {
  const unsized = plan.unsizedFiles ?? [];
  if (unsized.length === 0) return null;
  const shown = unsized.slice(0, 5);
  return (
    <div role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p>
        OSF did not report a size for {unsized.length === 1 ? "1 file" : `${unsized.length} files`}, so
        BetterOSF cannot check that a copy is complete and will not copy {unsized.length === 1 ? "it" : "them"}.
        The report will list {unsized.length === 1 ? "it" : "each one"} as missing. Download{" "}
        {unsized.length === 1 ? "that file" : "those files"} from OSF directly.
      </p>
      <ul className="mt-1 list-disc pl-5">
        {shown.map((f) => (
          <li key={f.osfFileId}>{f.path}</li>
        ))}
        {unsized.length > shown.length ? <li>and {unsized.length - shown.length} more</li> : null}
      </ul>
    </div>
  );
}

/** True only when OSF listed no files at all — not when it listed files without sizes. */
export function planHasNoFiles(plan: Pick<PlanResponse, "files" | "unsizedFiles">): boolean {
  return plan.files.length === 0 && (plan.unsizedFiles?.length ?? 0) === 0;
}
