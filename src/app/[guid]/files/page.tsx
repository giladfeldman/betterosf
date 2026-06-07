import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { collectResourceTree } from "@/lib/osf/resource-tree";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { UnifiedTree } from "@/components/UnifiedTree";
import { SplitPane } from "@/components/SplitPane";
import { UploadFilesButton } from "@/components/UploadFilesButton";

export default async function FilesPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  // The guid may be a node OR a registration — collectResourceTree resolves
  // either and returns the same shape, so registration files browse exactly
  // like project files. notFound() only when the guid is neither.
  let resource;
  try {
    resource = await collectResourceTree(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }
  const { kind, title, fullTree, linked, registrations, components } = resource;
  const node = { title };
  const isRegistration = kind === "registration";

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
            linkedTrees={fullTree.linkedTrees}
            readOnly={isRegistration}
          />
        }
        right={
          <div className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Files</h1>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {isRegistration
                    ? "Select a file to preview it, or open a folder listing. Registrations are immutable, so files are read-only."
                    : "Select a file to preview it, open a folder listing, or upload into OSF Storage."}
                </p>
              </div>
              {!isRegistration && <UploadFilesButton guid={guid} />}
            </div>
            <p className="text-sm text-neutral-500">Use the tree on the left to choose a folder. BetterOSF will keep loading deeper folders in the background.</p>
          </div>
        }
      />
    </div>
  );
}
