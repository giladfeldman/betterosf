"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";

type SortOption = { value: string; label: string };

export function SortControl({ options, defaultSort = "", paramName = "sort" }: { options: SortOption[]; defaultSort?: string; paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(paramName) ?? defaultSort;

  const onChange = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(paramName, v); else next.delete(paramName);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}` as Route);
  };

  return (
    <label className="text-sm inline-flex items-center gap-2">
      Sort:
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="border rounded px-2 py-1 text-sm bg-white dark:bg-neutral-900"
      >
        <option value="">Relevance</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
