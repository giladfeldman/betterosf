import { searchNodes, searchFiles, searchRegistrations, searchUsers } from "@/lib/osf/search";
import { SearchTypeChips, type SearchType } from "@/components/SearchTypeChips";
import { ProjectResult, FileResult, RegistrationResult, UserResult } from "@/components/SearchResultRow";
import { SearchSyntaxHelp } from "@/components/SearchSyntaxHelp";

export const metadata = { title: "Search — BetterOSF" };

type Params = { q?: string | string[]; type?: string | string[]; page?: string | string[] };

function first(v: string | string[] | undefined, fallback = ""): string {
  return Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;
}

function Pagination({ q, type, page, hasMore }: { q: string; type: SearchType; page: number; hasMore: boolean }) {
  return (
    <div className="flex justify-between text-sm mt-4">
      {page > 1 ? (
        <a className="text-blue-600 hover:underline" href={`/search?q=${encodeURIComponent(q)}&type=${type}&page=${page - 1}`}>
          ← Previous
        </a>
      ) : <span />}
      {hasMore ? (
        <a className="text-blue-600 hover:underline" href={`/search?q=${encodeURIComponent(q)}&type=${type}&page=${page + 1}`}>
          Next →
        </a>
      ) : <span />}
    </div>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();
  const typeRaw = first(sp.type, "projects");
  const type = (["projects", "files", "registrations", "users"].includes(typeRaw) ? typeRaw : "projects") as SearchType;
  const page = Math.max(1, parseInt(first(sp.page, "1"), 10) || 1);

  let body: React.ReactNode = null;
  if (!q) {
    body = <p className="text-neutral-600">Type a query above to search OSF.</p>;
  } else if (type === "projects") {
    const out = await searchNodes(q, { page });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((n) => <ProjectResult key={n.id} node={n} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No projects match.</p>}
        <Pagination q={q} type="projects" page={page} hasMore={out.hasMore} />
      </>
    );
  } else if (type === "files") {
    const out = await searchFiles(q, { page });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((f) => <FileResult key={f.id} file={f} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No files match.</p>}
        <Pagination q={q} type="files" page={page} hasMore={out.hasMore} />
      </>
    );
  } else if (type === "registrations") {
    const out = await searchRegistrations(q, { page });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((r) => <RegistrationResult key={r.id} reg={r} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No registrations match.</p>}
        <Pagination q={q} type="registrations" page={page} hasMore={out.hasMore} />
      </>
    );
  } else {
    const out = await searchUsers(q, { page });
    body = (
      <>
        <p className="text-sm text-neutral-600 mb-3">Showing {out.results.length} of {out.total} result{out.total === 1 ? "" : "s"}.</p>
        <ul>{out.results.map((u) => <UserResult key={u.id} user={u} />)}</ul>
        {out.results.length === 0 && <p className="text-neutral-500">No users match.</p>}
        <Pagination q={q} type="users" page={page} hasMore={out.hasMore} />
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
        <button type="submit" className="border rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700">Search</button>
        <SearchSyntaxHelp />
      </form>

      {q ? <SearchTypeChips q={q} active={type} /> : null}

      {body}
    </div>
  );
}
