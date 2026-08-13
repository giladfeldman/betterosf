/** One labelled number in a preflight or result summary. Shared, so the two agree. */
export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <dt className="text-xs text-neutral-600 dark:text-neutral-400">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
