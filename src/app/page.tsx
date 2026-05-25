import { GuidEntryForm } from "@/components/GuidEntryForm";
import { PinnedRecentPanels } from "@/components/PinnedRecentPanels";

export default function Landing() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold mb-4">BetterOSF</h1>
      <p className="mb-6">Paste an OSF project URL or GUID and browse it without the friction.</p>
      <GuidEntryForm />
      <div className="mt-10">
        <PinnedRecentPanels showPinned={false} />
      </div>
      <h2 className="text-xl font-semibold mt-12 mb-2">Examples</h2>
      <ul className="space-y-1 text-blue-600">
        <li><a className="hover:underline" href="/ezcuj">Many Labs 2 (ezcuj)</a></li>
        <li><a className="hover:underline" href="/4znzp">4znzp</a></li>
      </ul>
    </div>
  );
}
