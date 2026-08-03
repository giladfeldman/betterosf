import type { Metadata } from "next";
import Link from "next/link";
import { TERMS_CLAUSES, TERMS_VERSION } from "@/lib/terms";

export const metadata: Metadata = {
  title: "Deletion terms · BetterOSF",
  description: "Terms that apply when you delete files from OSF using BetterOSF.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Deletion terms</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Version {TERMS_VERSION}. These terms apply whenever you use BetterOSF to delete files or
        folders from OSF.
      </p>

      <div className="mt-6 rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
        <p className="font-semibold text-red-800 dark:text-red-200">
          OSF has no trash. Deleted files cannot be recovered.
        </p>
        <p className="mt-1 text-red-800 dark:text-red-200">
          Once a deletion is confirmed, neither BetterOSF nor OSF can undo it. Any backup BetterOSF
          makes is stored in your own browser and is a convenience only — not a guarantee.
        </p>
      </div>

      <ol className="mt-8 space-y-6">
        {TERMS_CLAUSES.map((clause, i) => (
          <li key={clause.heading}>
            <h2 className="text-base font-semibold">
              {i + 1}. {clause.heading}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{clause.body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-10 text-sm text-neutral-600 dark:text-neutral-400">
        See also the{" "}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        , which explains what BetterOSF stores locally in your browser.
      </p>
    </main>
  );
}
