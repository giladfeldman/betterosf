import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getNode, getAllChildren, getAllLinkedNodes } from "@/lib/osf/nodes";
import { getNodeRegistrations } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";

export default async function ProjectPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

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

  return (
    <article className="max-w-5xl">
      <Breadcrumb crumbs={[{ label: "Home", href: "/" }, { label: node.title || guid, href: `/${guid}` }]} />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">{node.title}</h1>
        <p className="mt-2 text-neutral-600 whitespace-pre-wrap">{node.description}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-8">
        <section>
          <h2 className="text-xl font-semibold mb-2">
            Files <a href={`/${guid}/files`} className="text-sm text-blue-600 hover:underline">(browse all →)</a>
          </h2>

          <h2 className="text-xl font-semibold mt-8 mb-2">
            Components ({children.length})
          </h2>
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id}>
                <a href={`/${c.id}`} className="text-blue-600 hover:underline">{c.title || c.id}</a>
              </li>
            ))}
            {children.length === 0 && <li className="text-neutral-500">No components.</li>}
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
              ⬇ Download all files as ZIP
            </a>
            <p className="text-xs text-neutral-500 mt-1">Whole-tree download arrives in Plan 2. For now, ZIP per folder is on the Files page.</p>
          </div>
        </aside>
      </div>
    </article>
  );
}
