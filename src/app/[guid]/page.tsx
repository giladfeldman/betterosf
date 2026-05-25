import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { collectFullTree } from "@/lib/osf/full-tree";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { CitationExport } from "@/components/CitationExport";
import { getCitation, getStyledCitation, toBibTeX, toRIS } from "@/lib/osf/citation";
import { SplitPane } from "@/components/SplitPane";
import { UnifiedTree } from "@/components/UnifiedTree";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guid: string }>;
}): Promise<Metadata> {
  const { guid } = await params;
  if (!isValidGuid(guid)) return { title: "BetterOSF" };
  try {
    const node = await getNode(guid);
    return {
      title: `${node.title} — BetterOSF`,
      description: node.description.slice(0, 200),
      openGraph: {
        title: node.title,
        description: node.description.slice(0, 200),
        url: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/${guid}`,
      },
    };
  } catch {
    return { title: "BetterOSF" };
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  let node, fullTree, linked, regs;
  try {
    [node, fullTree, linked, regs] = await Promise.all([
      getNode(guid),
      collectFullTree(guid),
      getAllLinkedNodes(guid),
      getNodeRegistrations(guid),
    ]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  // Build NodeView-shaped list from componentTrees so the tree's `components` prop
  // (used for the leaf-fallback rendering AND the count) matches the recursed set.
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

  const citation = await getCitation(guid).catch(() => null);
  const [apa, mla, chicago] = await Promise.all([
    getStyledCitation(guid, "apa").catch(() => ""),
    getStyledCitation(guid, "mla").catch(() => ""),
    getStyledCitation(guid, "chicago-author-date").catch(() => ""),
  ]);
  const bibtex = citation ? toBibTeX(citation, guid) : "";
  const ris = citation ? toRIS(citation, guid) : "";

  const cappedNote =
    fullTree.totalComponents > fullTree.components.filter((c) => !c.skipped).length
      ? `Showing ${fullTree.components.filter((c) => !c.skipped).length} of ${fullTree.totalComponents} components with full sub-trees (cap = ${fullTree.components.filter((c) => !c.skipped).length}); the rest appear as collapsed links — click to drill in.`
      : null;

  const overviewRight = (
    <article className="px-6 py-4 max-w-4xl">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{node.title}</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{node.description}</p>
          <p className="mt-3 text-sm">
            <a href={`/search?scope=project:${guid}`} className="text-blue-600 hover:underline">Search this project</a>
          </p>
        </div>
        <PinButton refEntry={{ id: guid, title: node.title || guid, kind: "project" }} />
      </header>
      <RecordView refEntry={{ id: guid, title: node.title || guid, kind: "project" }} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-8">
        <section className="space-y-4 text-sm">
          {cappedNote && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-3 py-2">
              {cappedNote}
            </p>
          )}
          {linked.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Linked projects ({linked.length})</h2>
              <ul className="space-y-1">
                {linked.map((l) => (
                  <li key={l.id}>
                    <a href={`/${l.id}`} className="text-blue-600 hover:underline">{l.title || l.id}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {regs.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Registrations ({regs.length})</h2>
              <ul className="space-y-1">
                {regs.map((r) => (
                  <li key={r.id}>
                    <a href={`/registrations/${r.id}`} className="text-blue-600 hover:underline">{r.title || r.id}</a>
                    <span className="ml-2 text-xs text-neutral-500">{r.dateRegistered.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-neutral-500">
            Everything in this project lives in the tree on the left — providers, every component&apos;s sub-tree, linked projects, registrations. Click a file leaf to open it inline.
          </p>
        </section>

        <aside className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold mb-1">Status</h3>
            <p>{node.public ? "Public" : "Private"} · {node.category || "node"}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Tags</h3>
            <p>{node.tags.join(", ") || "—"}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-1">Dates</h3>
            <p>Created: {node.dateCreated.slice(0, 10)}</p>
            <p>Modified: {node.dateModified.slice(0, 10)}</p>
          </div>
          <div>
            <a href={node.osfUrl} className="text-blue-600 hover:underline">View on OSF</a>
          </div>
          <div>
            <a
              href={`/api/zip/${guid}`}
              className="block border rounded px-3 py-2 text-center hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <span aria-hidden="true">⬇</span> <span>Download whole project as ZIP</span>
            </a>
            <p className="text-xs text-neutral-500 mt-1">Bundles every storage provider, every component, every linked project. Per-provider archives are nested inside the outer ZIP.</p>
          </div>
          <CitationExport apa={apa} mla={mla} chicago={chicago} bibtex={bibtex} ris={ris} />
        </aside>
      </div>
    </article>
  );

  return (
    <div>
      <Breadcrumb crumbs={[{ label: "Home", href: "/" }, { label: node.title || guid, href: `/${guid}` }]} />
      <SplitPane
        prefKey="overview"
        defaultLeftWidth={360}
        left={
          <UnifiedTree
            guid={guid}
            rootTitle={node.title || guid}
            skeleton={fullTree.rootSkeleton}
            components={components}
            componentTrees={fullTree.components}
            linkedNodes={linked}
            registrations={regs}
          />
        }
        right={overviewRight}
      />
    </div>
  );
}
