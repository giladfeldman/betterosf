import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRoots, getFolderContents } from "@/lib/osf/files";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { FilesTreeShell } from "@/components/FilesTreeShell";

export default async function FilesPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  let providers;
  try {
    providers = await getProviderRoots(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const withInitial = await Promise.all(
    providers.map(async (p) => ({
      ...p,
      initialEntries: p.listingUrl ? await getFolderContents(p.listingUrl, guid) : [],
    }))
  );

  return (
    <div className="max-w-5xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
        ]}
      />
      <h1 className="text-2xl font-semibold mb-4">Files</h1>
      <FilesTreeShell guid={guid} providers={withInitial} />
    </div>
  );
}
