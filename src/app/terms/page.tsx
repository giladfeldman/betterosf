import type { Metadata } from "next";
import Link from "next/link";
import {
  GENERAL_CLAUSES,
  DELETE_CLAUSES,
  TRANSITION_CLAUSES,
  TERMS_VERSION,
  type TermsClause,
} from "@/lib/terms";

export const metadata: Metadata = {
  title: "Terms · BetterOSF",
  description:
    "Terms that apply when you use BetterOSF to delete files from OSF, or to export and transfer a project to another repository.",
};

/**
 * Grouped rather than one flat list, and numbered continuously across groups so a
 * clause can be cited as "clause 7" without ambiguity. The groups exist because the
 * two risky features carry genuinely different risks: deletion destroys data in one
 * irreversible step, migration can fail silently.
 */
const GROUPS: { title: string; blurb: string; clauses: TermsClause[] }[] = [
  {
    title: "General",
    blurb: "These apply whenever you use BetterOSF.",
    clauses: GENERAL_CLAUSES,
  },
  {
    title: "Deleting files from OSF",
    blurb: "These apply in addition whenever you use BetterOSF to delete files or folders.",
    clauses: DELETE_CLAUSES,
  },
  {
    title: "Exporting and transferring projects",
    blurb:
      "These apply in addition whenever you use BetterOSF to export a project, or to transfer one to another repository such as Zenodo.",
    clauses: TRANSITION_CLAUSES,
  },
];

export default function TermsPage() {
  let n = 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Terms</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Version {TERMS_VERSION}. BetterOSF is a free, independent client for the public OSF API. It
        is not affiliated with the Center for Open Science or OSF.
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

      <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="font-semibold text-amber-900 dark:text-amber-200">
          An export or transfer report tells you what BetterOSF observed — it is not a warranty.
        </p>
        <p className="mt-1 text-amber-900 dark:text-amber-200">
          BetterOSF never deletes anything from OSF when you export or transfer. Verify your data at
          its destination yourself before you remove it from anywhere. Publishing a deposit mints a
          permanent DOI and cannot be undone.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className="mt-10">
          <h2 className="text-lg font-semibold">{group.title}</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{group.blurb}</p>
          <ol className="mt-4 space-y-6">
            {group.clauses.map((clause) => {
              n += 1;
              return (
                <li key={clause.id} id={clause.id}>
                  <h3 className="text-base font-semibold">
                    {n}. {clause.heading}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                    {clause.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

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
