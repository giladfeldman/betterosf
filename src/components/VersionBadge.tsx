import Link from "next/link";
import { APP_VERSION_LABEL, commitSha } from "@/lib/version";

/**
 * Floating version badge, pinned BOTTOM-right on every page — matching the
 * convention on docpluck.app / escimate.app / scimeto.app.
 *
 * Two jobs: users can see exactly what build they are running, and a bug report
 * can be tied to a specific version — the single most useful field in any bug
 * report.
 *
 * It links to /feedback so the badge doubles as the always-available route to
 * "something is wrong here".
 */
export function VersionBadge() {
  const sha = commitSha();
  return (
    <Link
      href="/feedback"
      title={sha ? `BetterOSF ${APP_VERSION_LABEL} (${sha}) — report a bug` : `BetterOSF ${APP_VERSION_LABEL} — report a bug`}
      className="fixed bottom-3 right-3 z-40 rounded-full border border-neutral-300 bg-white/90 px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm backdrop-blur transition hover:border-blue-400 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-400 dark:hover:border-blue-500 dark:hover:text-blue-300"
    >
      <span className="tabular-nums">{APP_VERSION_LABEL}</span>
      <span className="ml-1.5 hidden sm:inline text-neutral-400 dark:text-neutral-500">·</span>
      <span className="ml-1.5 hidden sm:inline">Report a bug</span>
    </Link>
  );
}
