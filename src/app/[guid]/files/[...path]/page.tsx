import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNode } from "@/lib/osf/nodes";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default async function DeepFilesPage({
  params,
}: {
  params: Promise<{ guid: string; path: string[] }>;
}) {
  const { guid, path: rawPath } = await params;
  if (!isValidGuid(guid)) notFound();
  // Drop empty segments — they show up when href ends with `/` (trailing slash
  // from materializedPath) or when there are accidental `//` in the URL. Without
  // this filter, the walk below would look for an empty-name folder and 404.
  const path = rawPath.filter((seg) => seg.length > 0);
  if (path.length === 0) notFound();

  const [provider, ...folderSegments] = path;

  let providers, node;
  try {
    [providers, node] = await Promise.all([
      getProviderRoots(guid),
      getNode(guid).catch(() => null),
    ]);
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
          { label: node?.title || guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
          { label: provider!, href: `/${guid}/files/${provider}` },
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
              <span className="text-xs text-neutral-500">{formatSize(entry.size)}</span>
            )}
          </li>
        ))}
        {entries.length === 0 && <li className="py-2 text-neutral-500">(empty folder)</li>}
      </ul>
    </div>
  );
}
