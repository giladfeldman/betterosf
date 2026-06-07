import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getPreprint } from "@/lib/osf/preprints";
import { PreprintOverview } from "@/components/PreprintOverview";

export async function generateMetadata({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) return { title: "BetterOSF" };
  try {
    const pp = await getPreprint(guid);
    return {
      title: `${pp.title} — BetterOSF`,
      description: pp.description.slice(0, 200),
    };
  } catch {
    return { title: "BetterOSF" };
  }
}

export default async function PreprintPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  return <PreprintOverview guid={guid} />;
}
