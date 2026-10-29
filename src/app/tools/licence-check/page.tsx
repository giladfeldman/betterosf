import type { Metadata } from "next";
import { LicenceCheck } from "@/components/licence/LicenceCheck";

export const metadata: Metadata = {
  title: "OSF licence check · BetterOSF",
  description:
    "Check which of your OSF projects have no reuse licence, and set one before OSF projects become read-only on 19 February 2027.",
};

/**
 * Not behind the transition gate: checking only reads, and setting a licence is an edit
 * to OSF the transition terms do not cover (they promise export/transfer change nothing).
 * Write access is asked for at the point of use, as upload and delete do.
 */
export default function LicenceCheckPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold">Check your OSF licences</h1>
      <p className="mt-2 max-w-3xl text-sm text-neutral-700 dark:text-neutral-300">
        Without a licence, nobody can tell what reuse of your materials is allowed, and many will
        not reuse them at all. When OSF projects become read-only on 19 February 2027 the licence
        freezes too: after that, the only way to get permission is to email you. Only 27% of
        papers with OSF materials are licensed (
        <a href="https://osf.io/preprints/psyarxiv/4rjg3_v1" className="underline" target="_blank" rel="noreferrer">
          Siepe, Heck &amp; Quintana
        </a>
        ). This lists every project and component you can reach — a component without its own
        licence shows the one it takes from its parent — and lets you set one on several at once.
      </p>
      <div className="mt-6">
        <LicenceCheck />
      </div>
    </main>
  );
}
