import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentUser, getMyProjects } from "@/lib/osf/users";
import { OsfError } from "@/lib/osf/types";
import { PinnedRecentPanels } from "@/components/PinnedRecentPanels";
import { PaginatedSection, parsePagination } from "@/components/PaginatedSection";
import type { NodeView } from "@/lib/osf/parse";

export const metadata = { title: "My Dashboard — BetterOSF" };

function first(v: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;
}

function sortNodes(items: NodeView[], sort: string): NodeView[] {
  if (!sort) return items;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return [...items].sort((a, b) => {
    let av = "", bv = "";
    if (key === "title") { av = a.title ?? ""; bv = b.title ?? ""; }
    else if (key === "date_modified") { av = a.dateModified ?? ""; bv = b.dateModified ?? ""; }
    else if (key === "date_created") { av = a.dateCreated ?? ""; bv = b.dateCreated ?? ""; }
    const cmp = av.localeCompare(bv);
    return desc ? -cmp : cmp;
  });
}

export default async function MyDashboard({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const sp = (await searchParams) ?? {};

  let user, projects;
  try {
    [user, projects] = await Promise.all([getCurrentUser(), getMyProjects()]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "forbidden") {
      return (
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold mb-2">Session expired</h1>
          <p className="mb-4">Your OSF session has expired. Please sign in again.</p>
          <a href="/login" className="underline text-blue-600">Sign in</a>
        </div>
      );
    }
    throw e;
  }

  const projSort = first(sp.projSort, "-date_modified");
  const projVisibility = first(sp.projVisibility, "all");
  let filtered = projects;
  if (projVisibility === "public") filtered = filtered.filter((p) => p.public);
  else if (projVisibility === "private") filtered = filtered.filter((p) => !p.public);
  filtered = sortNodes(filtered, projSort);
  const pag = parsePagination(sp, "projSize", "projPage");

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold mb-4">Hi, {user.fullName}</h1>
      <p className="mb-6 text-neutral-600">
        Signed in as <a href={user.osfUrl} className="underline text-blue-600">OSF user {user.id}</a>.
      </p>

      <p className="mb-4 text-sm">
        <a href="/search?scope=user:me" className="text-blue-600 hover:underline">Search my projects</a>
      </p>

      <PinnedRecentPanels />

      <PaginatedSection<NodeView>
        title="Your projects"
        prefKey="me.projects"
        sortParamName="projSort"
        pageParamName="projPage"
        sizeParamName="projSize"
        sortOptions={[
          { value: "-date_modified", label: "Modified (newest)" },
          { value: "date_modified", label: "Modified (oldest)" },
          { value: "-date_created", label: "Created (newest)" },
          { value: "title", label: "Title (A–Z)" },
        ]}
        filter={{
          paramName: "projVisibility",
          chips: [
            { value: "all", label: "All" },
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ],
        }}
        items={filtered}
        totalUnfiltered={projects.length}
        page={pag.page}
        pageSize={pag.pageSize}
        renderItem={(p) => (
          <li key={p.id}>
            <a href={`/${p.id}`} className="text-blue-600 hover:underline">{p.title || p.id}</a>
            {!p.public && <span className="ml-2 text-xs text-neutral-500">[private]</span>}
          </li>
        )}
        emptyText="No projects yet."
        basePath="/me"
        searchParams={sp}
      />
    </div>
  );
}
