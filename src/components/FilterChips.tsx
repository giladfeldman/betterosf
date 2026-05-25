"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";

type Chip = { value: string; label: string };

export function FilterChips({ paramName, chips, defaultValue = "" }: { paramName: string; chips: Chip[]; defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(paramName) ?? defaultValue;

  const setValue = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v && v !== "all") next.set(paramName, v); else next.delete(paramName);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}` as Route);
  };

  const active = current || "all";

  return (
    <div role="group" aria-label={`Filter by ${paramName}`} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => setValue(c.value)}
          className={`text-sm px-3 py-1 rounded border ${active === c.value ? "bg-blue-600 text-white border-blue-600" : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900"}`}
          aria-pressed={active === c.value}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
