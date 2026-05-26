import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getProviderRootsAuto, getFolderContents, type FileEntry } from "@/lib/osf/files";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations, getRegistration, type RegistrationView } from "@/lib/osf/registrations";
import { collectFullTree, type FullProjectTree } from "@/lib/osf/full-tree";
import { OsfError } from "@/lib/osf/types";
import type { NodeView } from "@/lib/osf/parse";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";
import { ViewerDispatcher } from "@/components/viewers/Dispatcher";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { FileMissing } from "@/components/FileMissing";

const EMPTY_TREE: FullProjectTree = { rootSkeleton: [], components: [], totalComponents: 0, registrationTrees: [], totalRegistrations: 0 };

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

  // Critical-path data: resolve the guid's kind (node or registration) and
  // its provider list. A 404 here on both kinds means the resource doesn't
  // exist — bail to the route-level not-found.
  let providers;
  let resourceKind: "node" | "registration";
  try {
    const r = await getProviderRootsAuto(guid);
    providers = r.roots;
    resourceKind = r.kind;
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  // Project title (kind-appropriate fetch).
  const titlePromise = resourceKind === "registration"
    ? getRegistration(guid).then((r) => r.title).catch((): string => "")
    : getNode(guid).then((n) => n.title).catch((): string => "");

  // Side-pane data: tree, linked projects, registrations. These power the
  // navigation pane but the page is still useful without them. For a
  // registration resource these endpoints don't apply — we skip them.
  const [titleStr, fullTree, linked, registrations]: [string, FullProjectTree, NodeView[], RegistrationView[]] = await Promise.all([
    titlePromise,
    resourceKind === "registration"
      ? Promise.resolve<FullProjectTree>(EMPTY_TREE)
      : collectFullTree(guid).catch((): FullProjectTree => EMPTY_TREE),
    resourceKind === "registration"
      ? Promise.resolve<NodeView[]>([])
      : getAllLinkedNodes(guid).catch((): NodeView[] => []),
    resourceKind === "registration"
      ? Promise.resolve<RegistrationView[]>([])
      : getNodeRegistrations(guid).catch((): RegistrationView[] => []),
  ]);
  const node = { title: titleStr };

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

  const attemptedPath = `/${guid}/${provider}/${rest.join("/")}`;
  const providerMatch = providers.find((p) => p.provider === provider);

  // Walk the path, capturing the first failure rather than blanket-404ing.
  // Errors here are scoped to the file lookup, not the project — we want to
  // render the surrounding chrome (tree, breadcrumb, RecordView) even when
  // the specific file can't be resolved, so users can recover via the tree.
  type WalkResult =
    | { kind: "ok"; file: Extract<FileEntry, { kind: "file" }> }
    | { kind: "fail"; reason: "wrong-provider" | "missing-folder" | "missing-file" | "upstream-error" };

  async function walkToFile(): Promise<WalkResult> {
    if (!providerMatch) return { kind: "fail", reason: "wrong-provider" };
    try {
      let listingUrl = providerMatch.listingUrl;
      let entries: FileEntry[] = await getFolderContents(listingUrl, guid);
      for (const seg of folderSegments) {
        const next = entries.find((e) => e.kind === "folder" && e.name === seg);
        if (!next || next.kind !== "folder") return { kind: "fail", reason: "missing-folder" };
        listingUrl = next.listingUrl;
        entries = await getFolderContents(listingUrl, guid);
      }
      const f = entries.find((e) => e.kind === "file" && e.name === filename);
      if (!f || f.kind !== "file") return { kind: "fail", reason: "missing-file" };
      return { kind: "ok", file: f };
    } catch (e) {
      if (e instanceof OsfError && (e.code === "not_found" || e.code === "forbidden")) {
        return { kind: "fail", reason: "upstream-error" };
      }
      throw e;
    }
  }

  const walk = await walkToFile();

  return (
    <div>
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: node.title || guid, href: resourceKind === "registration" ? `/registrations/${guid}` : `/${guid}` },
          ...(resourceKind === "registration"
            ? []
            : [{ label: "Files", href: `/${guid}/files` }]),
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
          />
        }
        right={
          walk.kind === "ok" ? (
            <ViewerDispatcher
              filename={filename}
              url={walk.file.downloadUrl}
              sizeBytes={walk.file.size}
              forceOpen={force === "1"}
            />
          ) : (
            <div className="p-6">
              <FileMissing reason={walk.reason} guid={guid} attemptedPath={attemptedPath} />
            </div>
          )
        }
      />
    </div>
  );
}
