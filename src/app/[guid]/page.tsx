import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { resolveGuidType } from "@/lib/osf/resolve";
import { getNode, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations, getRegistration } from "@/lib/osf/registrations";
import { getPreprint } from "@/lib/osf/preprints";
import { getUser } from "@/lib/osf/users";
import { RegistrationOverview } from "@/components/RegistrationOverview";
import { PreprintOverview } from "@/components/PreprintOverview";
import { UserProfile } from "@/components/UserProfile";
import { UnsupportedGuid } from "@/components/UnsupportedGuid";
import { collectFullTree } from "@/lib/osf/full-tree";
import { OsfError } from "@/lib/osf/types";
import { osfBackpressureKind } from "@/lib/osf/backpressure";
import { OsfBackpressureNotice } from "@/components/OsfBackpressureNotice";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { CitationExport } from "@/components/CitationExport";
import { getCitation, getStyledCitation, toBibTeX, toRIS } from "@/lib/osf/citation";
import { SplitPane } from "@/components/SplitPane";
import { UnifiedTree } from "@/components/UnifiedTree";
import { UploadFilesButton } from "@/components/UploadFilesButton";
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

function tabUrl(basePath: string, searchParams: Record<string, string | string[] | undefined>, view: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined || k === "view") continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, v);
    }
  }
  if (view !== "overview") qs.set("view", view);
  const q = qs.toString();
  return q ? `${basePath}?${q}` : basePath;
}

function countFolders(nodes: { children: unknown[] }[]): number {
  let count = 0;
  function walk(items: { children: unknown[] }[]) {
    for (const item of items) {
      count += 1;
      walk(item.children as { children: unknown[] }[]);
    }
  }
  walk(nodes);
  return count;
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
    // Not a node — resolve the real type for a correct title (best-effort).
    try {
      const r = await resolveGuidType(guid);
      if (r.kind === "registration") return { title: `${(await getRegistration(guid)).title} — BetterOSF` };
      if (r.kind === "preprint") return { title: `${(await getPreprint(guid)).title} — BetterOSF` };
      if (r.kind === "user") return { title: `${(await getUser(guid)).fullName} — BetterOSF` };
    } catch {
      /* fall through */
    }
    return { title: "BetterOSF" };
  }
}

/**
 * `/<guid>` mirrors OSF's flat guid namespace: a guid can be a node, a
 * registration, a preprint, a user, or a file. The node path stays the fast
 * one-request common case; only when the node lookup 404s do we resolve the
 * real type and render the right view (or redirect a file to the viewer).
 */
async function renderNonNode(
  guid: string,
  sp: Record<string, string | string[] | undefined>,
) {
  let resolved;
  try {
    resolved = await resolveGuidType(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    const bp = osfBackpressureKind(e);
    if (bp) return <OsfBackpressureNotice kind={bp} resourceLabel="this project" />;
    throw e;
  }
  switch (resolved.kind) {
    case "registration":
      return <RegistrationOverview guid={guid} />;
    case "preprint":
      return <PreprintOverview guid={guid} />;
    case "user":
      return <UserProfile guid={guid} basePath={`/${guid}`} searchParams={sp} />;
    case "file":
      if (resolved.file) {
        const segs = resolved.file.path.split("/").map(encodeURIComponent).join("/");
        redirect(`/${resolved.file.resourceId}/files/view/${encodeURIComponent(resolved.file.provider)}/${segs}`);
      }
      return <UnsupportedGuid guid={guid} kind="file" />;
    default:
      return <UnsupportedGuid guid={guid} kind={resolved.kind === "unknown" ? undefined : resolved.kind} />;
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

  // Critical: project must exist. Side data (tree, linked, regs) may fail
  // gracefully so a restricted side endpoint doesn't 404 the whole overview.
  let node;
  try {
    node = await getNode(guid);
  } catch (e) {
    // Not a project. OSF guids are a flat namespace — dispatch to the real type
    // (registration/preprint/user/file) instead of a dead-end "not found".
    if (e instanceof OsfError && e.code === "not_found") return await renderNonNode(guid, sp);
    const bp = osfBackpressureKind(e);
    if (bp) return <OsfBackpressureNotice kind={bp} resourceLabel="this project" />;
    throw e;
  }
  const [fullTree, linked, regs]: [
    Awaited<ReturnType<typeof collectFullTree>>,
    NodeView[],
    RegistrationView[]
  ] = await Promise.all([
    collectFullTree(guid, {
      maxComponentsToRecurse: 3,
      maxRegistrationsToRecurse: 1,
      maxLinkedToRecurse: 1,
      componentTimeoutMs: 5_000,
      rootTimeoutMs: 10_000,
    }).catch(() => ({
      rootSkeleton: [],
      components: [],
      totalComponents: 0,
      registrationTrees: [],
      totalRegistrations: 0,
      linkedTrees: [],
      totalLinked: 0,
    })),
    getAllLinkedNodes(guid).catch((): NodeView[] => []),
    getNodeRegistrations(guid).catch((): RegistrationView[] => []),
  ]);

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
  const activeView = first(sp.view, "overview");
  const rootProviders = fullTree.rootSkeleton.map((p) => p.provider);
  const rootFolderCount = countFolders(fullTree.rootSkeleton.flatMap((p) => p.children));
  const rootFileCount = fullTree.rootSkeleton.reduce((sum, p) => sum + p.fileCount, 0);
  const viewTabs = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "components", label: "Components" },
    { id: "linked", label: "Linked" },
    { id: "registrations", label: "Registrations" },
  ];

  const overviewRight = (
    <article className="max-w-4xl px-4 py-4 sm:px-6">
      <header className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">{node.title}</h1>
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
          <nav aria-label="Project sections" className="mb-5 flex flex-wrap gap-2">
            {viewTabs.map((tab) => (
              <a
                key={tab.id}
                href={tabUrl(basePath, sp, tab.id)}
                className={`rounded border px-3 py-1.5 ${activeView === tab.id ? "border-blue-500 bg-blue-600 text-white" : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"}`}
              >
                {tab.label}
              </a>
            ))}
          </nav>

          {cappedNote && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 mb-4">
              {cappedNote}
            </p>
          )}

          {activeView === "overview" && (
            <div className="space-y-6">
              <section>
                <h2 className="mb-3 text-lg font-semibold">At a glance</h2>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="border-b border-neutral-200 pb-2 dark:border-neutral-800">
                    <dt className="text-xs text-neutral-500">Files at provider roots</dt>
                    <dd className="text-xl font-semibold">{rootFileCount}</dd>
                  </div>
                  <div className="border-b border-neutral-200 pb-2 dark:border-neutral-800">
                    <dt className="text-xs text-neutral-500">Folders indexed</dt>
                    <dd className="text-xl font-semibold">{rootFolderCount}</dd>
                  </div>
                  <div className="border-b border-neutral-200 pb-2 dark:border-neutral-800">
                    <dt className="text-xs text-neutral-500">Components</dt>
                    <dd className="text-xl font-semibold">{components.length}</dd>
                  </div>
                  <div className="border-b border-neutral-200 pb-2 dark:border-neutral-800">
                    <dt className="text-xs text-neutral-500">Registrations</dt>
                    <dd className="text-xl font-semibold">{regs.length}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Find files quickly</h2>
                  <UploadFilesButton guid={guid} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["PDF", "pdf", "pdf"],
                    ["DOCX", "docx", "docx"],
                    ["PPTX", "pptx", "pptx"],
                    ["CSV", "csv", "csv"],
                    ["Code", "r OR py OR js", "code"],
                    ["Media", "mp4 OR mp3", "media"],
                  ] as Array<[string, string, string]>).map(([label, q, ext]) => (
                    <a key={label} href={`/search?q=${encodeURIComponent(q)}&scope=project:${guid}&type=files&ext=${encodeURIComponent(ext)}`} className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                      {label}
                    </a>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="mb-2 text-lg font-semibold">Storage</h2>
                <p className="text-neutral-600 dark:text-neutral-400">
                  {rootProviders.length > 0 ? rootProviders.join(", ") : "No public storage providers found."}
                </p>
              </section>
            </div>
          )}

          {activeView === "files" && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Files</h2>
              <p className="mb-3 text-neutral-600 dark:text-neutral-400">Browse the tree on the left, use Select mode for batch downloads, or jump into the full file browser.</p>
              <a href={`/${guid}/files`} className="text-blue-600 hover:underline">Open file browser</a>
            </section>
          )}

          {activeView === "components" && components.length > 0 && (
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

          {activeView === "linked" && linked.length > 0 && (
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

          {activeView === "registrations" && regs.length > 0 && (
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
            registrationTrees={fullTree.registrationTrees}
            linkedTrees={fullTree.linkedTrees}
          />
        }
        right={overviewRight}
      />
    </div>
  );
}
