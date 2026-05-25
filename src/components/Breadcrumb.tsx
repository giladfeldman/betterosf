export function Breadcrumb({ crumbs }: { crumbs: Array<{ label: string; href: string }> }) {
  const display = crumbs.length <= 7 ? crumbs : [
    crumbs[0]!,
    { label: "…", href: crumbs[crumbs.length - 4]?.href ?? "#" },
    ...crumbs.slice(-3),
  ];

  return (
    <nav aria-label="Breadcrumb" className="sticky top-0 z-10 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 overflow-x-auto whitespace-nowrap">
      {display.map((c, i) => (
        <span key={`${c.href}:${i}`}>
          {i > 0 && <span aria-hidden> › </span>}
          {c.label === "…" ? (
            <span className="text-neutral-400" title="More segments hidden">…</span>
          ) : (
            <a href={c.href} className="hover:underline">{c.label}</a>
          )}
        </span>
      ))}
    </nav>
  );
}
