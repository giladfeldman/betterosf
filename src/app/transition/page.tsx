import type { Metadata } from "next";
import Link from "next/link";
import { TransitionGate } from "@/components/transition/TransitionGate";
import { TransitionDeadlines } from "@/components/transition/TransitionDeadlines";
import { InventoryTable } from "@/components/transition/InventoryTable";

export const metadata: Metadata = {
  title: "OSF transition · BetterOSF",
  description:
    "Take stock of your OSF projects before they become read-only, export them completely, and move the ones that need moving.",
};

export default function TransitionPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <TransitionDeadlines />

      {/* Outside the gate: checking licences only reads, and is worth doing before anything else. */}
      <section className="mt-6 rounded border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-base font-semibold">First: do your projects have a licence?</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          A project&apos;s licence freezes when OSF becomes read-only, and an unlicensed project
          can then only be reused by emailing you. The{" "}
          <Link href="/tools/licence-check" className="underline">
            licence check
          </Link>{" "}
          lists every project without one and lets you set a licence on several at once.
        </p>
      </section>

      <div className="mt-8">
        <TransitionGate>
          <section>
            <h1 className="text-2xl font-semibold">Your projects</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
              An inventory of everything you can reach, so you can decide project by project what
              actually needs doing. Most finished public projects need nothing at all — they stay on
              OSF, at the same link, for good.
            </p>
            <div className="mt-6">
              <InventoryTable />
            </div>
          </section>
        </TransitionGate>
      </div>

      {/*
        Outside the gate on purpose: it needs no OSF account, no consent and no sign-in, and
        it is most useful to someone who deposited months ago and has come back to get their
        data out again.
      */}
      <section className="mt-10 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <h2 className="text-base font-semibold">Already moved something to Zenodo?</h2>
        <p className="mt-2 max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          Zenodo has no folders, so a deposit&apos;s file list reads as long flat names like{" "}
          <code className="rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-900">
            osfstorage/analysis/raw.csv
          </code>
          . The{" "}
          <Link href="/tools/zenodo-download" className="underline">
            folder-tree downloader
          </Link>{" "}
          rebuilds the structure from any public record, checks every file against the checksum
          Zenodo publishes, and gives you one ZIP. No account needed, and it works for deposits made
          without BetterOSF.
        </p>
      </section>
    </main>
  );
}
