import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getRegistration } from "@/lib/osf/registrations";
import { RegistrationOverview } from "@/components/RegistrationOverview";

export async function generateMetadata({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) return { title: "BetterOSF" };
  try {
    const reg = await getRegistration(guid);
    return {
      title: `${reg.title} — BetterOSF`,
      description: reg.description.slice(0, 200),
    };
  } catch {
    return { title: "BetterOSF" };
  }
}

export default async function RegistrationPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  return <RegistrationOverview guid={guid} />;
}
