import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";

export default async function DeepFilesPage({
  params,
}: {
  params: Promise<{ guid: string; path: string[] }>;
}) {
  const { guid, path } = await params;
  if (!isValidGuid(guid)) notFound();
  if (path.length === 0) notFound();

  const [provider, ...folderSegments] = path;

  let providers;
  try {
    providers = await getProviderRoots(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const matchingProvider = providers.find((p) => p.provider === provider);
  if (!matchingProvider) notFound();

  let listingUrl = matchingProvider.listingUrl;
  let entries: FileEntry[] = await getFolderContents(listingUrl, guid);
  for (const segment of folderSegments) {
    const next = entries.find((e) => e.kind === "folder" && e.name === segment);
    if (!next || next.kind !== "folder") notFound();
    listingUrl = next.listingUrl;
    entries = await getFolderContents(listingUrl, guid);
  }

  const zipHref = `/api/zip/${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;

  return (
    <div className="max-w-5xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
          ...folderSegments.map((seg, i) => ({
            label: seg,
            href: `/${guid}/files/${provider}/${folderSegments.slice(0, i + 1).join("/")}`,
          })),
        ]}
      />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold font-mono-files">
          {provider}{folderSegments.length ? "/" + folderSegments.join("/") : ""}
        </h1>
        <a href={zipHref} className="border rounded px-3 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
          ⬇ Download folder as ZIP
        </a>
      </div>

      <ul className="font-mono-files text-sm divide-y divide-neutral-200 dark:divide-neutral-800">
        {entries.map((entry) => (
          <li key={entry.id} className="py-1.5 flex items-center justify-between">
            {entry.kind === "folder" ? (
              <a
                href={`/${guid}/files/${provider}/${[...folderSegments, entry.name].join("/")}`}
                className="text-blue-600 hover:underline"
              >
                <span aria-hidden="true">📁</span> <span>{entry.name}/</span>
              </a>
            ) : (
              <a href={entry.downloadUrl} className="hover:underline">
                <span aria-hidden="true">📄</span> <span>{entry.name}</span>
              </a>
            )}
            {entry.kind === "file" && entry.size !== null && (
              <span className="text-xs text-neutral-500">{entry.size} B</span>
            )}
          </li>
        ))}
        {entries.length === 0 && <li className="py-2 text-neutral-500">(empty folder)</li>}
      </ul>
    </div>
  );
}
