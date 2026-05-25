import { searchNodes, searchFiles, searchRegistrations, searchUsers, searchInProjectScope } from "@/lib/osf/search";
import { searchUserNodes } from "@/lib/osf/users";
import { SearchTypeChips, type SearchType } from "@/components/SearchTypeChips";
import { ProjectResult, FileResult, RegistrationResult, UserResult } from "@/components/SearchResultRow";
import { SearchSyntaxHelp } from "@/components/SearchSyntaxHelp";
import { PageSizeSelector } from "@/components/PageSizeSelector";
import { SortControl } from "@/components/SortControl";
import { FilterChips } from "@/components/FilterChips";

const EXT_GROUPS: Record<string, string[]> = {
  pdf: ["pdf"],
  csv: ["csv", "tsv"],
  docx: ["docx", "doc"],
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"],
  code: ["js", "ts", "tsx", "jsx", "py", "r", "rmd", "ipynb", "json", "yaml", "yml", "sh", "html", "css"],
};

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

function matchesExt(name: string, ext: string): boolean {
  if (!ext || ext === "all") return true;
  const exts = EXT_GROUPS[ext];
  if (!exts) return false;
  return exts.includes(fileExt(name));
}

export const metadata = { title: "Search — BetterOSF" };

type Params = {
  q?: string | string[];
  type?: string | string[];
  page?: string | string[];
  scope?: string | string[];
  size?: string | string[];
  sort?: string | string[];
  ext?: string | string[];
};

function first(v: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;
}

function buildHref(base: string, params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    sp.set(k, String(v));
  }
  return `${base}?${sp.toString()}`;
}

function Pagination({
  q, type, page, scope, size, sort, ext, hasMore,
}: {
  q: string; type: SearchType; page: number; scope: string; size: string; sort: string | undefined; ext: string; hasMore: boolean;
}) {
  const extra = { size: size || undefined, sort, ext: ext || undefined };
  return (
    <div className="flex justify-between text-sm mt-4">
      {page > 1 ? (
        <a className="text-blue-600 hover:underline" href={buildHref("/search", { q, type, scope, page: page - 1, ...extra })}>
          ← Previous
        </a>
      ) : <span />}
      {hasMore ? (
        <a className="text-blue-600 hover:underline" href={buildHref("/search", { q, type, scope, page: page + 1, ...extra })}>
          Next →
        </a>
      ) : <span />}
    </div>
  );
}

function ScopeChip({ scope, q, type }: { scope: string; q: string; type: SearchType }) {
  if (!scope) return null;
  const label = scope.startsWith("user:")
    ? (scope === "user:me" ? "My projects" : `User ${scope.slice("user:".length)}`)
    : scope.startsWith("project:")
      ? `Project ${scope.slice("project:".length)}`
      : scope;
  return (
    <div className="mb-3 inline-flex items-center gap-2 text-sm">
      <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200">
        Scope: {label}
      </span>
      <a href={buildHref("/search", { q, type })} className="text-blue-600 hover:underline" aria-label="Clear scope">× clear</a>
    </div>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();
  const typeRaw = first(sp.type, "projects");
  const type = (["projects", "files", "registrations", "users"].includes(typeRaw) ? typeRaw : "projects") as SearchType;
  const page = Math.max(1, parseInt(first(sp.page, "1"), 10) || 1);
  const scope = first(sp.scope);
  const isUserScope = scope.startsWith("user:");
  const isProjectScope = scope.startsWith("project:");
  const sizeRaw = first(sp.size, "50");
  const perPage = sizeRaw === "all" ? 500 : Math.max(1, Math.min(500, parseInt(sizeRaw, 10) || 50));
  const sort = first(sp.sort) || undefined;
  const ext = first(sp.ext);

  let body: React.ReactNode = null;
  if (!q) {
    body = <p className="text-neutral-600">Type a query above to search OSF.</p>;
  } else if (type === "projects" && isUserScope) {
    const userId = scope.slice("user:".length);
    const out = await searchUserNodes(userId, q, { page, perPage, sort });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((n) => <ProjectResult key={n.id} node={n} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No projects match.</p>}
        <Pagination q={q} type="projects" page={page} scope={scope} size={sizeRaw} sort={sort} ext={ext} hasMore={out.hasMore} />
      </>
    );
  } else if (isProjectScope && (type === "projects" || type === "registrations")) {
    const guid = scope.slice("project:".length);
    const out = await searchInProjectScope(guid, q);
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">
          {out.components.length + out.linked.length} project{out.components.length + out.linked.length === 1 ? "" : "s"} · {out.registrations.length} registration{out.registrations.length === 1 ? "" : "s"} in this scope.
        </p>
        {type === "projects" && (
          <>
            <h2 className="text-lg font-semibold mt-4 mb-2">Components</h2>
            <ul>{out.components.map((n) => <ProjectResult key={n.id} node={n} />)}</ul>
            {out.components.length === 0 && <p className="text-neutral-500">No components match.</p>}
            <h2 className="text-lg font-semibold mt-4 mb-2">Linked projects</h2>
            <ul>{out.linked.map((n) => <ProjectResult key={n.id} node={n} />)}</ul>
            {out.linked.length === 0 && <p className="text-neutral-500">No linked projects match.</p>}
          </>
        )}
        {type === "registrations" && (
          <>
            <ul>{out.registrations.map((r) => <RegistrationResult key={r.id} reg={r} />)}</ul>
            {out.registrations.length === 0 && <p className="text-neutral-500">No registrations match.</p>}
          </>
        )}
      </>
    );
  } else if (type === "projects") {
    const out = await searchNodes(q, { page, perPage, sort });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((n) => <ProjectResult key={n.id} node={n} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No projects match.</p>}
        <Pagination q={q} type="projects" page={page} scope={scope} size={sizeRaw} sort={sort} ext={ext} hasMore={out.hasMore} />
      </>
    );
  } else if (type === "files") {
    const out = await searchFiles(q, { page, perPage, sort });
    const filtered = ext ? out.results.filter((f) => matchesExt(f.name, ext)) : out.results;
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">
          Showing {filtered.length}{ext ? ` filtered of ${out.results.length}` : ""} of {out.total} result{out.total === 1 ? "" : "s"}.
        </p>
        <ul>{filtered.map((f) => <FileResult key={f.id} file={f} />)}</ul>
        {filtered.length === 0 && <p className="text-neutral-500">No files match.</p>}
        <Pagination q={q} type="files" page={page} scope={scope} size={sizeRaw} sort={sort} ext={ext} hasMore={out.hasMore} />
      </>
    );
  } else if (type === "registrations") {
    const out = await searchRegistrations(q, { page, perPage, sort });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((r) => <RegistrationResult key={r.id} reg={r} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No registrations match.</p>}
        <Pagination q={q} type="registrations" page={page} scope={scope} size={sizeRaw} sort={sort} ext={ext} hasMore={out.hasMore} />
      </>
    );
  } else {
    const out = await searchUsers(q, { page, perPage, sort });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((u) => <UserResult key={u.id} user={u} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No users match.</p>}
        <Pagination q={q} type="users" page={page} scope={scope} size={sizeRaw} sort={sort} ext={ext} hasMore={out.hasMore} />
      </>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold mb-4">Search OSF</h1>
      <form action="/search" method="get" className="flex gap-2 mb-6 max-w-2xl relative items-center">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Title, filename, author…"
          className="flex-1 border rounded px-3 py-2"
          aria-label="Search query"
        />
        <input type="hidden" name="type" value={type} />
        {scope && <input type="hidden" name="scope" value={scope} />}
        <button type="submit" className="border rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700">Search</button>
        <SearchSyntaxHelp />
      </form>

      {q ? <SearchTypeChips q={q} active={type} /> : null}
      <ScopeChip scope={scope} q={q} type={type} />

      {q ? (
        <div className="flex flex-wrap items-center gap-4 my-3">
          <PageSizeSelector prefKey="search" />
          <SortControl
            options={
              type === "files"
                ? [
                    { value: "-date_modified", label: "Modified (newest)" },
                    { value: "date_modified", label: "Modified (oldest)" },
                    { value: "name", label: "Name (A–Z)" },
                    { value: "-size", label: "Size (largest)" },
                  ]
                : [
                    { value: "-date_modified", label: "Modified (newest)" },
                    { value: "date_modified", label: "Modified (oldest)" },
                    { value: "-date_created", label: "Created (newest)" },
                    { value: "date_created", label: "Created (oldest)" },
                    { value: "title", label: "Title (A–Z)" },
                  ]
            }
          />
        </div>
      ) : null}

      {q && type === "files" ? (
        <div className="mb-3">
          <FilterChips
            paramName="ext"
            chips={[
              { value: "all", label: "All files" },
              { value: "pdf", label: "PDF" },
              { value: "csv", label: "CSV/TSV" },
              { value: "docx", label: "DOCX" },
              { value: "image", label: "Images" },
              { value: "code", label: "Code" },
            ]}
          />
        </div>
      ) : null}

      {body}
    </div>
  );
}

