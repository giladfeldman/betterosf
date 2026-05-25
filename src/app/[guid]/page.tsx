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
import { PaginatedSection, parsePagination } from "@/components/PaginatedSection";
import type { NodeView } from "@/lib/osf/parse";
import type { RegistrationView } from "@/lib/osf/registrations";

const COMPONENT_CATEGORIES = [
  "project",
  "hypothesis",
  "data",
  "analysis",
  "methods and measures",
  "software",
  "instrumentation",
  "other",
] as const;

function first(v: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;
}

function sortNodes(items: NodeView[], sort: string): NodeView[] {
  if (!sort) return items;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const sorted = [...items].sort((a, b) => {
    let av = "", bv = "";
    if (key === "title") { av = a.title ?? ""; bv = b.title ?? ""; }
    else if (key === "date_modified") { av = a.dateModified ?? ""; bv = b.dateModified ?? ""; }
    else if (key === "date_created") { av = a.dateCreated ?? ""; bv = b.dateCreated ?? ""; }
    const cmp = av.localeCompare(bv);
    return desc ? -cmp : cmp;
  });
  return sorted;
}

function sortRegistrations(items: RegistrationView[], sort: string): RegistrationView[] {
  if (!sort) return items;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const sorted = [...items].sort((a, b) => {
    let av = "", bv = "";
    if (key === "title") { av = a.title ?? ""; bv = b.title ?? ""; }
    else if (key === "date_registered") { av = a.dateRegistered ?? ""; bv = b.dateRegistered ?? ""; }
    const cmp = av.localeCompare(bv);
    return desc ? -cmp : cmp;
  });
  return sorted;
}

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

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ guid: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  const sp = (await searchParams) ?? {};

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

  // Build NodeView-shaped components for the tree + the components list section
  const components: NodeView[] = fullTree.components.map((c) => ({
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

  // Components filter + sort + pagination
  const compCategory = first(sp.compCategory);
  const compSort = first(sp.compSort);
  let filteredComponents = components;
  if (compCategory && compCategory !== "all") {
    filteredComponents = filteredComponents.filter(
      (c) => (c.category ?? "").toLowerCase() === compCategory.toLowerCase()
    );
  }
  filteredComponents = sortNodes(filteredComponents, compSort);
  const compPag = parsePagination(sp, "compSize", "compPage");

  // Linked sort + pagination
  const linkedSort = first(sp.linkedSort);
  const sortedLinked = sortNodes(linked, linkedSort);
  const linkedPag = parsePagination(sp, "linkedSize", "linkedPage");

  // Registrations sort + pagination
  const regSort = first(sp.regSort);
  const sortedRegs = sortRegistrations(regs, regSort);
  const regPag = parsePagination(sp, "regSize", "regPage");

  // Citation
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
      ? `Showing ${fullTree.components.filter((c) => !c.skipped).length} of ${fullTree.totalComponents} components with full sub-trees; the rest appear as collapsed links — click to drill in.`
      : null;

  const basePath = `/${guid}`;

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
        <section className="text-sm">
          {cappedNote && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 mb-4">
              {cappedNote}
            </p>
          )}

          {components.length > 0 && (
            <PaginatedSection<NodeView>
              title="Components"
              prefKey="overview.components"
              sortParamName="compSort"
              pageParamName="compPage"
              sizeParamName="compSize"
              sortOptions={[
                { value: "title", label: "Title (A–Z)" },
                { value: "-title", label: "Title (Z–A)" },
              ]}
              filter={{
                paramName: "compCategory",
                chips: [
                  { value: "all", label: "All" },
                  ...COMPONENT_CATEGORIES.map((c) => ({
                    value: c,
                    label: c.replace(/\b\w/g, (m) => m.toUpperCase()),
                  })),
                ],
              }}
              items={filteredComponents}
              totalUnfiltered={components.length}
              page={compPag.page}
              pageSize={compPag.pageSize}
              renderItem={(c) => (
                <li key={c.id}>
                  <a href={`/${c.id}`} className="text-blue-600 hover:underline">{c.title || c.id}</a>
                  {c.category && <span className="ml-2 text-xs text-neutral-500">[{c.category}]</span>}
                </li>
              )}
              emptyText="No components match the current filter."
              basePath={basePath}
              searchParams={sp}
            />
          )}

          {linked.length > 0 && (
            <PaginatedSection<NodeView>
              title="Linked projects"
              prefKey="overview.linked"
              sortParamName="linkedSort"
              pageParamName="linkedPage"
              sizeParamName="linkedSize"
              sortOptions={[
                { value: "title", label: "Title (A–Z)" },
                { value: "-title", label: "Title (Z–A)" },
              ]}
              items={sortedLinked}
              totalUnfiltered={linked.length}
              page={linkedPag.page}
              pageSize={linkedPag.pageSize}
              renderItem={(l) => (
                <li key={l.id}>
                  <a href={`/${l.id}`} className="text-blue-600 hover:underline">{l.title || l.id}</a>
                </li>
              )}
              emptyText="No linked projects."
              basePath={basePath}
              searchParams={sp}
            />
          )}

          {regs.length > 0 && (
            <PaginatedSection<RegistrationView>
              title="Registrations"
              prefKey="overview.registrations"
              sortParamName="regSort"
              pageParamName="regPage"
              sizeParamName="regSize"
              sortOptions={[
                { value: "-date_registered", label: "Registered (newest)" },
                { value: "date_registered", label: "Registered (oldest)" },
                { value: "title", label: "Title (A–Z)" },
              ]}
              items={sortedRegs}
              totalUnfiltered={regs.length}
              page={regPag.page}
              pageSize={regPag.pageSize}
              renderItem={(r) => (
                <li key={r.id}>
                  <a href={`/registrations/${r.id}`} className="text-blue-600 hover:underline">{r.title || r.id}</a>
                  <span className="ml-2 text-xs text-neutral-500">{r.dateRegistered.slice(0, 10)}</span>
                </li>
              )}
              emptyText="No registrations."
              basePath={basePath}
              searchParams={sp}
            />
          )}

          <p className="text-xs text-neutral-500 mt-6">
            Tip: every file lives in the tree on the left. Click a folder to expand it (left-click toggles; right-click → &ldquo;Open in new tab&rdquo; still navigates to the deep folder URL). Click a file leaf to open it inline.
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
