import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

/**
 * Shown when a guid resolves to an OSF object type BetterOSF can't render inline
 * yet (e.g. collections, wiki pages, view-only links). Instead of the old dead-end
 * "Project not found", we tell the user what happened and link straight to OSF so
 * the link is never a hard stop.
 */
export function UnsupportedGuid({ guid, kind }: { guid: string; kind?: string }) {
  return (
    <div className="max-w-xl">
      <Breadcrumb crumbs={[{ label: "Home", href: "/" }, { label: guid, href: `/${guid}` }]} />
      <h1 className="text-2xl font-semibold mb-2">Can&rsquo;t open this in BetterOSF yet</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        {kind
          ? `This OSF link points to a ${kind}, which BetterOSF doesn't display inline yet.`
          : "BetterOSF couldn't determine how to display this OSF link."}{" "}
        You can open it directly on OSF:
      </p>
      <p className="mt-3">
        <a href={`https://osf.io/${guid}/`} className="text-blue-600 hover:underline break-all">
          https://osf.io/{guid}/
        </a>
      </p>
      <p className="mt-4 text-sm text-neutral-500">
        <Link href="/" className="underline">Go home</Link>
      </p>
    </div>
  );
}
