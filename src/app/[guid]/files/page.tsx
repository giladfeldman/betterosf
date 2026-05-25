import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { collectFolderSkeleton } from "@/lib/osf/folder-skeleton";
import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";

export default async function FilesPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  let node, skeleton, components, linked, registrations;
  try {
    [node, skeleton, components, linked, registrations] = await Promise.all([
      getNode(guid),
      collectFolderSkeleton(guid),
      getAllChildren(guid),
      getAllLinkedNodes(guid),
      getNodeRegistrations(guid),
    ]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

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
        defaultLeftWidth={360}
        left={
          <UnifiedTree
            guid={guid}
            rootTitle={node.title || guid}
            skeleton={skeleton}
            components={components}
            linkedNodes={linked}
            registrations={registrations}
            pinned={[]}
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
