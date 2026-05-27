import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations, type RegistrationView } from "@/lib/osf/registrations";
import { collectFullTree, type FullProjectTree } from "@/lib/osf/full-tree";
import { OsfError } from "@/lib/osf/types";
import type { NodeView } from "@/lib/osf/parse";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";
import { FileMissing } from "@/components/FileMissing";
import { RecordView } from "@/components/RecordView";

const EMPTY_TREE: FullProjectTree = { rootSkeleton: [], components: [], totalComponents: 0, registrationTrees: [], totalRegistrations: 0, linkedTrees: [], totalLinked: 0 };

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

  // Critical-path: project + providers. Side data (tree/linked/regs) for the
  // navigation pane is best-effort.
  let providers, node;
  try {
    [providers, node] = await Promise.all([
      getProviderRoots(guid),
      getNode(guid),
    ]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const [fullTree, linked, registrations]: [FullProjectTree, NodeView[], RegistrationView[]] = await Promise.all([
    collectFullTree(guid, {
      maxComponentsToRecurse: 3,
      maxRegistrationsToRecurse: 1,
      maxLinkedToRecurse: 1,
      componentTimeoutMs: 5_000,
      rootTimeoutMs: 10_000,
    }).catch((): FullProjectTree => EMPTY_TREE),
    getAllLinkedNodes(guid).catch((): NodeView[] => []),
    getNodeRegistrations(guid).catch((): RegistrationView[] => []),
  ]);

  const components = fullTree.components.map((c) => ({
    id: c.guid,
    title: c.title,
    description: "",
    category: c.category,
    public: c.isPublic,
    tags: [] as string[],
    dateCreated: "",
    dateModified: "",
    osfUrl: `https://osf.io/${c.guid}/`,
    related: { children: "", linkedNodes: "", registrations: "", files: "", contributors: "" },
  }));

  const attemptedPath = `/${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;
  const matchingProvider = providers.find((p) => p.provider === provider);

  type WalkResult =
    | { kind: "ok"; entries: FileEntry[] }
    | { kind: "fail"; reason: "wrong-provider" | "missing-folder" | "upstream-error" };

  async function walk(): Promise<WalkResult> {
    if (!matchingProvider) return { kind: "fail", reason: "wrong-provider" };
    try {
      let listingUrl = matchingProvider.listingUrl;
      let entries: FileEntry[] = await getFolderContents(listingUrl, guid);
      for (const segment of folderSegments) {
        const next = entries.find((e) => e.kind === "folder" && e.name === segment);
        if (!next || next.kind !== "folder") return { kind: "fail", reason: "missing-folder" };
        listingUrl = next.listingUrl;
        entries = await getFolderContents(listingUrl, guid);
      }
      return { kind: "ok", entries };
    } catch (e) {
      if (e instanceof OsfError && (e.code === "not_found" || e.code === "forbidden")) {
        return { kind: "fail", reason: "upstream-error" };
      }
      throw e;
    }
  }

  const w = await walk();
  const zipHref = `/api/zip/${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;
  const folderTitle = folderSegments[folderSegments.length - 1] ?? provider ?? guid;
  const folderId = `${guid}/${provider}${folderSegments.length ? "/" + folderSegments.join("/") : ""}`;

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
          />
        }
        right={
          <div className="p-6 max-w-5xl">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-semibold font-mono-files">
                {provider}{folderSegments.length ? "/" + folderSegments.join("/") : ""}
              </h1>
              <a href={zipHref} className="border rounded px-3 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                ⬇ Download folder as ZIP
              </a>
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
