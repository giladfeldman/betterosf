import { GuidEntryForm } from "@/components/GuidEntryForm";
import { PinnedRecentPanels } from "@/components/PinnedRecentPanels";
import { BetterOsfLogo } from "@/components/BetterOsfLogo";

export default function Landing() {
  return (
    <div className="max-w-4xl">
      <section className="mb-10 border-b border-neutral-200 pb-8 dark:border-neutral-800">
        <BetterOsfLogo variant="full" className="mb-5" />
        <h1 className="text-3xl font-semibold mb-3">Browse OSF without the friction.</h1>
        <p className="mb-6 max-w-2xl text-neutral-700 dark:text-neutral-300">
          Paste an OSF project URL or GUID to open a faster, researcher-friendly view with unified files,
          previews, search, and downloads.
        </p>
        <GuidEntryForm />
      </section>
      <div className="mt-10">
        <PinnedRecentPanels showPinned={false} />
      </div>
      <h2 className="text-xl font-semibold mt-12 mb-2">Examples</h2>
      <ul className="space-y-1 text-blue-600">
        <li><a className="hover:underline" href="/8cd4r">Many Labs 2 (8cd4r)</a></li>
        <li><a className="hover:underline" href="/ezcuj">Reproducibility Project: Psychology (ezcuj)</a></li>
        <li><a className="hover:underline" href="/3kmr9">Revisiting celebrity contagion (3kmr9)</a></li>
      </ul>
    </div>
  );
}
