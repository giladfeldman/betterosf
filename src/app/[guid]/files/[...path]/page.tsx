import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getFolderContents, type FileEntry } from "@/lib/osf/files";
import { collectResourceTree } from "@/lib/osf/resource-tree";
import { OsfError } from "@/lib/osf/types";
import { osfBackpressureKind } from "@/lib/osf/backpressure";
import { OsfBackpressureNotice } from "@/components/OsfBackpressureNotice";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";
import { FileMissing } from "@/components/FileMissing";
import { RecordView } from "@/components/RecordView";
import { UploadFilesButton } from "@/components/UploadFilesButton";
import { FolderViewNewFolder } from "@/components/FolderViewNewFolder";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

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
  // Drop empty segments (trailing slash from materializedPath) AND
  // URL-decode each segment — Next.js 15 catch-all segments arrive encoded
  // (e.g. "PCIRR%20Stage%201"), but the OSF API returns names decoded, so
  // we must decode before comparing against `e.name` in getFolderContents
  // results. Same root cause as the file-view route's "Folder not found".
  const path = rawPath.map((seg) => safeDecode(seg)).filter((seg) => seg.length > 0);
  if (path.length === 0) notFound();

  const [provider, ...folderSegments] = path;

  // The guid may be a node OR a registration. collectResourceTree resolves
  // either and returns the same shape; provider roots come from the resolved
  // tree's rootSkeleton, so no second kind-detection round-trip is needed.
  let resource;
  try {
    resource = await collectResourceTree(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    const bp = osfBackpressureKind(e);
    if (bp) return <OsfBackpressureNotice kind={bp} resourceLabel="these files" />;
    throw e;
  }
  const { kind, title, fullTree, linked, registrations, components } = resource;
  const node = { title };
  const providers = fullTree.rootSkeleton.map((p) => ({
    provider: p.provider,
    name: p.name,
    listingUrl: p.listingUrl,
    uploadUrl: p.uploadUrl,
    newFolderUrl: p.newFolderUrl,
  }));

  const attemptedPath = `/${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;
  const matchingProvider = providers.find((p) => p.provider === provider);

  type WalkResult =
    | { kind: "ok"; entries: FileEntry[]; listingUrl: string; uploadUrl?: string; newFolderUrl?: string }
    | { kind: "fail"; reason: "wrong-provider" | "missing-folder" | "upstream-error" };

  async function walk(): Promise<WalkResult> {
    if (!matchingProvider) return { kind: "fail", reason: "wrong-provider" };
    try {
      let listingUrl = matchingProvider.listingUrl;
      let uploadUrl = matchingProvider.uploadUrl;
      let newFolderUrl = matchingProvider.newFolderUrl;
      let entries: FileEntry[] = await getFolderContents(listingUrl, guid);
      for (const segment of folderSegments) {
        const next = entries.find((e) => e.kind === "folder" && e.name === segment);
        if (!next || next.kind !== "folder") return { kind: "fail", reason: "missing-folder" };
        listingUrl = next.listingUrl;
        uploadUrl = next.uploadUrl;
        newFolderUrl = next.newFolderUrl;
        entries = await getFolderContents(listingUrl, guid);
      }
      return { kind: "ok", entries, listingUrl, uploadUrl, newFolderUrl };
    } catch (e) {
      if (
        e instanceof OsfError &&
        (e.code === "not_found" || e.code === "forbidden" || e.code === "rate_limited" || e.code === "upstream")
      ) {
        return { kind: "fail", reason: "upstream-error" };
      }
      throw e;
    }
  }

  const w = await walk();
  const zipHref = `/api/zip/${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;
  const folderTitle = folderSegments[folderSegments.length - 1] ?? provider ?? guid;
  const folderId = `${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;
  const uploadTarget = w.kind === "ok" && provider === "osfstorage" && kind === "node"
    ? {
        guid,
        provider,
        path: folderSegments.length ? `/${folderSegments.join("/")}/` : "/",
        name: folderTitle,
        listingUrl: w.listingUrl,
        uploadUrl: w.uploadUrl,
        newFolderUrl: w.newFolderUrl,
        nodeTitle: node.title || guid,
        sourceKind: "project" as const,
      }
    : undefined;

  return (
    <div>
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: node.title || guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
          { label: provider!, href: `/${guid}/files/${provider}` },
          ...folderSegments.map((seg, i) => ({
            label: seg,
            href: `/${guid}/files/${provider}/${folderSegments.slice(0, i + 1).join("/")}`,
          })),
        ]}
      />
      <SplitPane
        prefKey="files"
        defaultLeftWidth={420}
        left={
          <UnifiedTree
            guid={guid}
            rootTitle={node.title || guid}
            skeleton={fullTree.rootSkeleton}
            components={components}
            componentTrees={fullTree.components}
            linkedNodes={linked}
            registrations={registrations}
            registrationTrees={fullTree.registrationTrees}
            linkedTrees={fullTree.linkedTrees}
            readOnly={kind === "registration"}
          />
        }
        right={
          <div className="p-6 max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h1 className="text-2xl font-semibold font-mono-files">
                {provider}{folderSegments.length ? "/" + folderSegments.join("/") : ""}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                {uploadTarget && <FolderViewNewFolder target={uploadTarget} />}
                {uploadTarget && <UploadFilesButton guid={guid} target={uploadTarget}>Upload here</UploadFilesButton>}
                <a href={zipHref} className="border rounded px-3 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                ⬇ Download folder as ZIP
                </a>
              </div>
            </div>
            <RecordView refEntry={{ id: folderId, title: folderTitle, kind: "folder" }} />

            {w.kind === "fail" ? (
              <FileMissing reason={w.reason} guid={guid} attemptedPath={attemptedPath} />
            ) : (
              <ul className="font-mono-files text-sm divide-y divide-neutral-200 dark:divide-neutral-800">
                {w.entries.map((entry) => (
                  <li key={entry.id} className="py-1.5 flex items-center justify-between">
                    {entry.kind === "folder" ? (
                      <a
                        href={`/${guid}/files/${provider}/${[...folderSegments, entry.name].join("/")}`}
                        className="text-blue-600 hover:underline"
                      >
                        <span aria-hidden="true">📁</span> <span title={entry.name}>{entry.name}/</span>
                      </a>
                    ) : (
                      <a
                        href={`/${guid}/files/view/${provider}/${[...folderSegments, entry.name].join("/")}`}
                        className="hover:underline"
                      >
                        <span aria-hidden="true">📄</span> <span title={entry.name}>{entry.name}</span>
                      </a>
                    )}
                    {entry.kind === "file" && entry.size !== null && (
                      <span className="text-xs text-neutral-500 shrink-0">{formatSize(entry.size)}</span>
                    )}
                  </li>
                ))}
                {w.entries.length === 0 && <li className="py-2 text-neutral-500">(empty folder)</li>}
              </ul>
            )}
          </div>
        }
      />
    </div>
  );
}
