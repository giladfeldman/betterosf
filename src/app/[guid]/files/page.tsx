import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { collectFullTree, type FullProjectTree } from "@/lib/osf/full-tree";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations, type RegistrationView } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import type { NodeView } from "@/lib/osf/parse";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";

const EMPTY_TREE: FullProjectTree = { rootSkeleton: [], components: [], totalComponents: 0, registrationTrees: [], totalRegistrations: 0 };

export default async function FilesPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  // Critical: project must exist. Side data (tree, linked, regs) may fail
  // gracefully so a restricted-side-endpoint doesn't make the whole page 404.
  let node;
  try {
    node = await getNode(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const [fullTree, linked, registrations]: [FullProjectTree, NodeView[], RegistrationView[]] = await Promise.all([
    collectFullTree(guid).catch((): FullProjectTree => EMPTY_TREE),
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

  return (
    <div>
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: node.title || guid, href: `/${guid}` },
          { label: "Files", href: `/${guid}/files` },
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
          />
        }
        right={
          <div className="p-6 text-neutral-500">
            <p>Select a file in the tree to preview it here.</p>
            <p className="mt-2 text-sm">Or click a folder name to open its listing.</p>
          </div>
        }
      />
    </div>
  );
}
