export function Breadcrumb({ crumbs }: { crumbs: Array<{ label: string; href: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
      {crumbs.map((c, i) => (
        <span key={c.href}>
          {i > 0 && <span aria-hidden> › </span>}
          <a href={c.href} className="hover:underline">{c.label}</a>
        </span>
      ))}
    </nav>
  );
}
