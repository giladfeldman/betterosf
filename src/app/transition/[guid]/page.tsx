import type { Metadata } from "next";
import Link from "next/link";
import { TransitionGate } from "@/components/transition/TransitionGate";
import { ExportRunner } from "@/components/transition/ExportRunner";
import { DestinationGuide } from "@/components/transition/DestinationGuide";
import { APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: "Export a project · BetterOSF",
  description:
    "Take a complete, checksum-verified copy of an OSF project — files, wikis, metadata and contributors.",
};

export default async function TransitionProjectPage({
  params,
}: {
  params: Promise<{ guid: string }>;
}) {
  const { guid } = await params;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/transition" className="underline">
          ← All your projects
        </Link>
      </p>

      <div className="mt-6">
        <TransitionGate>
          <div className="mb-6">
            <DestinationGuide />
          </div>
          <ExportRunner guid={guid} appVersion={APP_VERSION} />
        </TransitionGate>
      </div>
    </main>
  );
}
