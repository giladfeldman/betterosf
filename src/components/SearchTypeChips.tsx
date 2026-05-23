const TYPES = ["projects", "files", "registrations", "users"] as const;
export type SearchType = (typeof TYPES)[number];

export function SearchTypeChips({ q, active }: { q: string; active: SearchType }) {
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {TYPES.map((t) => {
        const isActive = t === active;
        const href = `/search?q=${encodeURIComponent(q)}&type=${t}`;
        return (
          <a
            key={t}
            href={href}
            className={`text-sm px-3 py-1 rounded border ${isActive ? "bg-blue-600 text-white border-blue-600" : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900"}`}
            aria-current={isActive ? "page" : undefined}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </a>
        );
      })}
    </div>
  );
}
