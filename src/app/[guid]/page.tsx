import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { FilterChips } from "@/components/FilterChips";
import { SortControl } from "@/components/SortControl";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";

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
  searchParams?: Promise<{ compSort?: string | string[]; compCategory?: string | string[] }>;
}) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();
  const sp = (await searchParams) ?? {};
  const compSort = first(sp.compSort);
  const compCategory = first(sp.compCategory);

  let node, children, linked, regs;
  try {
    [node, children, linked, regs] = await Promise.all([
      getNode(guid),
      getAllChildren(guid),
      getAllLinkedNodes(guid),
      getNodeRegistrations(guid),
    ]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  // Filter
  let filteredChildren = children;
  if (compCategory && compCategory !== "all") {
    filteredChildren = filteredChildren.filter((c) => (c.category ?? "").toLowerCase() === compCategory.toLowerCase());
  }

  // Sort
  if (compSort) {
    const desc = compSort.startsWith("-");
    const key = desc ? compSort.slice(1) : compSort;
    filteredChildren = [...filteredChildren].sort((a, b) => {
      let av = "", bv = "";
      if (key === "title") { av = a.title ?? ""; bv = b.title ?? ""; }
      else if (key === "date_modified") { av = a.dateModified ?? ""; bv = b.dateModified ?? ""; }
      else if (key === "date_created") { av = a.dateCreated ?? ""; bv = b.dateCreated ?? ""; }
      const cmp = av.localeCompare(bv);
      return desc ? -cmp : cmp;
    });
  }

  return (
    <article className="max-w-5xl">
      <Breadcrumb crumbs={[{ label: "Home", href: "/" }, { label: node.title || guid, href: `/${guid}` }]} />
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{node.title}</h1>
          <p className="mt-2 text-neutral-600 whitespace-pre-wrap">{node.description}</p>
          <p className="mt-3 text-sm">
            <a href={`/search?scope=project:${guid}`} className="text-blue-600 hover:underline">Search this project</a>
          </p>
        </div>
        <PinButton refEntry={{ id: guid, title: node.title || guid, kind: "project" }} />
      </header>
      <RecordView refEntry={{ id: guid, title: node.title || guid, kind: "project" }} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-8">
        <section>
          <h2 className="text-xl font-semibold mb-2">
            Files <a href={`/${guid}/files`} className="text-sm text-blue-600 hover:underline">(browse all →)</a>
          </h2>

          <h2 className="text-xl font-semibold mt-8 mb-2">
            Components ({filteredChildren.length}{filteredChildren.length !== children.length ? ` of ${children.length}` : ""})
          </h2>
          {children.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <SortControl
                paramName="compSort"
                options={[
                  { value: "-date_modified", label: "Modified (newest)" },
                  { value: "date_modified", label: "Modified (oldest)" },
                  { value: "-date_created", label: "Created (newest)" },
                  { value: "title", label: "Title (A–Z)" },
                ]}
              />
              <FilterChips
                paramName="compCategory"
                chips={[
                  { value: "all", label: "All" },
                  ...COMPONENT_CATEGORIES.map((c) => ({ value: c, label: c.replace(/\b\w/g, (m) => m.toUpperCase()) })),
                ]}
              />
            </div>
          )}
          <ul className="space-y-1">
            {filteredChildren.map((c) => (
              <li key={c.id}>
                <a href={`/${c.id}`} className="text-blue-600 hover:underline">{c.title || c.id}</a>
                {c.category && <span className="ml-2 text-xs text-neutral-500">[{c.category}]</span>}
              </li>
            ))}
            {filteredChildren.length === 0 && <li className="text-neutral-500">No components.</li>}
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-2">
            Linked projects ({linked.length})
          </h2>
          <ul className="space-y-1">
            {linked.map((c) => (
              <li key={c.id}>
                <a href={`/${c.id}`} className="text-blue-600 hover:underline">{c.title || c.id}</a>
              </li>
            ))}
            {linked.length === 0 && <li className="text-neutral-500">No linked projects.</li>}
          </ul>

          <h2 className="text-xl font-semibold mt-8 mb-2">
            Registrations ({regs.length})
          </h2>
          <ul className="space-y-1">
            {regs.map((r) => (
              <li key={r.id}>
                <a href={r.osfUrl} className="text-blue-600 hover:underline">{r.title || r.id}</a>
                <span className="ml-2 text-sm text-neutral-500">{r.dateRegistered.slice(0, 10)}</span>
              </li>
            ))}
            {regs.length === 0 && <li className="text-neutral-500">No registrations.</li>}
          </ul>
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
        </aside>
      </div>
    </article>
  );
}
