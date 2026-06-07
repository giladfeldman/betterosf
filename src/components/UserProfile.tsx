import { notFound } from "next/navigation";
import { getUser, getUserNodes } from "@/lib/osf/users";
import { getUserRegistrations } from "@/lib/osf/registrations";
import { getUserPreprints } from "@/lib/osf/preprints";
import { OsfError } from "@/lib/osf/types";
import type { NodeView } from "@/lib/osf/parse";
import type { RegistrationView } from "@/lib/osf/registrations";
import type { PreprintListItem } from "@/lib/osf/preprints";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { PaginatedSection, parsePagination } from "@/components/PaginatedSection";

/**
 * Renders an OSF user profile: name, affiliation, and their PUBLIC projects,
 * registrations, and preprints. Used by both the flat `/<guid>` dispatcher and
 * the canonical `/users/<guid>` route.
 */
export async function UserProfile({
  guid,
  basePath,
  searchParams,
}: {
  guid: string;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let user;
  try {
    user = await getUser(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const [nodes, regs, preprints] = await Promise.all([
    getUserNodes(guid).catch(() => ({ results: [] as NodeView[], total: 0 })),
    getUserRegistrations(guid).catch(() => ({ results: [] as RegistrationView[], total: 0 })),
    getUserPreprints(guid).catch(() => ({ results: [] as PreprintListItem[], total: 0 })),
  ]);

  const projPag = parsePagination(searchParams, "projSize", "projPage");
  const regPag = parsePagination(searchParams, "regSize", "regPage");
  const ppPag = parsePagination(searchParams, "ppSize", "ppPage");

  return (
    <article className="max-w-4xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: user.fullName || guid, href: `/${guid}` },
        ]}
      />
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{user.fullName}</h1>
          {user.employment && <p className="text-neutral-600 dark:text-neutral-400 mt-1">{user.employment}</p>}
          <p className="text-sm mt-1">
            <a href={user.osfUrl} className="text-blue-600 hover:underline">View on OSF</a> ·{" "}
            <a href={`/search?scope=user:${guid}`} className="text-blue-600 hover:underline">Search this user&rsquo;s work</a>
          </p>
        </div>
        <PinButton refEntry={{ id: guid, title: user.fullName || guid, kind: "user" }} />
      </header>
      <RecordView refEntry={{ id: guid, title: user.fullName || guid, kind: "user" }} />

      <PaginatedSection<NodeView>
        title="Public projects"
        prefKey="user.projects"
        sortParamName="projSort"
        pageParamName="projPage"
        sizeParamName="projSize"
        sortOptions={[
          { value: "title", label: "Title (A–Z)" },
          { value: "-title", label: "Title (Z–A)" },
        ]}
        items={nodes.results}
        totalUnfiltered={nodes.results.length}
        page={projPag.page}
        pageSize={projPag.pageSize}
        renderItem={(n) => (
          <li key={n.id}>
            <a href={`/${n.id}`} className="text-blue-600 hover:underline">{n.title || n.id}</a>
          </li>
        )}
        emptyText="No public projects."
        basePath={basePath}
        searchParams={searchParams}
      />

      <PaginatedSection<RegistrationView>
        title="Registrations"
        prefKey="user.registrations"
        sortParamName="regSort"
        pageParamName="regPage"
        sizeParamName="regSize"
        sortOptions={[
          { value: "-date_registered", label: "Registered (newest)" },
          { value: "date_registered", label: "Registered (oldest)" },
        ]}
        items={regs.results}
        totalUnfiltered={regs.results.length}
        page={regPag.page}
        pageSize={regPag.pageSize}
        renderItem={(r) => (
          <li key={r.id}>
            <a href={`/${r.id}`} className="text-blue-600 hover:underline">{r.title || r.id}</a>
            <span className="ml-2 text-xs text-neutral-500">{r.dateRegistered.slice(0, 10)}</span>
          </li>
        )}
        emptyText="No registrations."
        basePath={basePath}
        searchParams={searchParams}
      />

      <PaginatedSection<PreprintListItem>
        title="Preprints"
        prefKey="user.preprints"
        sortParamName="ppSort"
        pageParamName="ppPage"
        sizeParamName="ppSize"
        sortOptions={[
          { value: "title", label: "Title (A–Z)" },
          { value: "-title", label: "Title (Z–A)" },
        ]}
        items={preprints.results}
        totalUnfiltered={preprints.results.length}
        page={ppPag.page}
        pageSize={ppPag.pageSize}
        renderItem={(p) => (
          <li key={p.id}>
            <a href={`/${p.id}`} className="text-blue-600 hover:underline">{p.title || p.id}</a>
            {p.datePublished && <span className="ml-2 text-xs text-neutral-500">{p.datePublished.slice(0, 10)}</span>}
          </li>
        )}
        emptyText="No preprints."
        basePath={basePath}
        searchParams={searchParams}
      />
    </article>
  );
}
