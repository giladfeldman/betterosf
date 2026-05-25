import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRoots, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { collectFullTree } from "@/lib/osf/full-tree";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";
import { ViewerDispatcher } from "@/components/viewers/Dispatcher";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";

export default async function FileViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ guid: string; path: string[] }>;
  searchParams: Promise<{ force?: string }>;
}) {
  const { guid, path } = await params;
  const { force } = await searchParams;
  if (!isValidGuid(guid)) notFound();
  if (path.length < 2) notFound();

  const [provider, ...rest] = path;
  if (!provider) notFound();
  const filename = rest[rest.length - 1] ?? "";
  const folderSegments = rest.slice(0, -1);

  let node, providers, fullTree, linked, registrations;
  try {
    [node, providers, fullTree, linked, registrations] = await Promise.all([
      getNode(guid),
      getProviderRoots(guid),
      collectFullTree(guid),
      getAllLinkedNodes(guid),
      getNodeRegistrations(guid),
    ]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

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

  const providerMatch = providers.find((p) => p.provider === provider);
  if (!providerMatch) notFound();

  let listingUrl = providerMatch.listingUrl;
  let entries: FileEntry[] = await getFolderContents(listingUrl, guid);
  for (const seg of folderSegments) {
    const next = entries.find((e) => e.kind === "folder" && e.name === seg);
    if (!next || next.kind !== "folder") notFound();
    listingUrl = next.listingUrl;
    entries = await getFolderContents(listingUrl, guid);
  }
  const file = entries.find((e) => e.kind === "file" && e.name === filename);
  if (!file || file.kind !== "file") notFound();

  return (
    <div>
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: node.title || guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
          { label: provider, href: `/${guid}/files/${provider}` },
          ...folderSegments.map((seg, i) => ({
            label: seg,
            href: `/${guid}/files/${provider}/${folderSegments.slice(0, i + 1).join("/")}`,
          })),
          { label: filename, href: `/${guid}/files/view/${provider}/${rest.join("/")}` },
        ]}
      />
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-lg font-semibold truncate">{filename}</h1>
        <PinButton refEntry={{ id: `${guid}/${provider}/${rest.join("/")}`, title: filename, kind: "file" }} />
      </div>
      <RecordView refEntry={{ id: `${guid}/${provider}/${rest.join("/")}`, title: filename, kind: "file" }} />
      <SplitPane
        prefKey="files"
        defaultLeftWidth={360}
        left={
          <UnifiedTree
            guid={guid}
            rootTitle={node.title || guid}
            skeleton={fullTree.rootSkeleton}
            components={components}
            componentTrees={fullTree.components}
            linkedNodes={linked}
            registrations={registrations}
          />
        }
        right={
          <ViewerDispatcher
            filename={filename}
            url={file.downloadUrl}
            sizeBytes={file.size}
            forceOpen={force === "1"}
          />
        }
      />
    </div>
  );
}
