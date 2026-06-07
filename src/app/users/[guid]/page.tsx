import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getUser } from "@/lib/osf/users";
import { UserProfile } from "@/components/UserProfile";

export async function generateMetadata({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) return { title: "BetterOSF" };
  try {
    const user = await getUser(guid);
    return { title: `${user.fullName} — BetterOSF` };
  } catch {
    return { title: "BetterOSF" };
  }
}

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ guid: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  const sp = (await searchParams) ?? {};
  return <UserProfile guid={guid} basePath={`/users/${guid}`} searchParams={sp} />;
}
