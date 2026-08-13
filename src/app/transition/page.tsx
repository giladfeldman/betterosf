import type { Metadata } from "next";
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
    </main>
  );
}
