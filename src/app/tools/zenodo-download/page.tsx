import type { Metadata } from "next";
import { ZenodoFolderDownloader } from "@/components/zenodo/ZenodoFolderDownloader";

export const metadata: Metadata = {
  title: "Zenodo folder-tree downloader",
  description:
    "Download any public Zenodo record as the folder tree its file names describe, checked against Zenodo's published checksums.",
};

/**
 * A standalone, public tool.
 *
 * Deliberately not behind the transition gate and not tied to OSF: it is useful to anybody
 * with a Zenodo record, and it makes the deposits BetterOSF creates obviously recoverable —
 * which matters more than usual, because "you can get your data back out" is a claim, and a
 * claim about somebody's archive should come with the thing that does it.
 */
export default function ZenodoDownloadPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Download a Zenodo record as folders</h1>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        Zenodo has no folders. It stores each file&apos;s name exactly as uploaded — including any
        slashes — and its record page renders those as long flat filenames like{" "}
        <code className="rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-900">
          osfstorage/analysis/data/raw.csv
        </code>
        . The structure was never lost; only the display flattens it.
      </p>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        Paste any public record and this rebuilds the tree, verifies each file against the checksum
        Zenodo publishes for it, and hands you one ZIP. It works for any deposit whose names contain
        paths, not only ones made with BetterOSF. Nothing is uploaded anywhere and no account is
        needed — the files go from Zenodo straight to your computer.
      </p>

      <div className="mt-6">
        <ZenodoFolderDownloader />
      </div>

      <p className="mt-8 text-xs text-neutral-600 dark:text-neutral-400">
        Restricted or embargoed records cannot be read here: Zenodo will not list their files without
        the depositor&apos;s permission, and this tool never asks you for a Zenodo login.
      </p>
    </main>
  );
}
