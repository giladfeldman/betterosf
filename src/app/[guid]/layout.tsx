import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guid: string }>;
}) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  return <div>{children}</div>;
}
