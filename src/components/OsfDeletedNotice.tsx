import Link from "next/link";

/**
 * Shown when OSF answers 410 Gone for the resource a page needs (see
 * `@/lib/osf/deleted`). A deleted OSF resource is a fact about OSF, not a bad link,
 * so it gets its own copy instead of the generic "not found / malformed GUID" page
 * (d-0f12b5). Server component: nothing here needs the browser.
 */
export function OsfDeletedNotice({
  what = "project",
  guid,
}: {
  /** Noun for the resource, e.g. "project", "registration", "profile". */
  what?: string;
  guid?: string;
}) {
  return (
    <div className="max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">This {what} was deleted on OSF</h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-4">
        OSF says this {what}{guid ? ` (${guid})` : ""} is no longer available (HTTP 410 Gone), so there is
        nothing left to show, download or export. OSF has no restore path from BetterOSF; if you expected it to
        be here, ask its owner or OSF support.
      </p>
      <Link href="/" className="border px-3 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900">
        Home
      </Link>
    </div>
  );
}
