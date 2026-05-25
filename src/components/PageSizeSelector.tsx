"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { getPref, setPref } from "@/lib/prefs";

const OPTIONS = [10, 20, 50, 100, 200, "all"] as const;
type SizeOption = (typeof OPTIONS)[number];

function isValidOption(v: number | string): v is SizeOption {
  return (OPTIONS as readonly (number | string)[]).includes(v);
}

export function PageSizeSelector({
  prefKey,
  paramName = "size",
  pageParamName = "page",
}: {
  prefKey: string;
  paramName?: string;
  pageParamName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const fromUrl = params.get(paramName);
  const [size, setSize] = useState<SizeOption>(50);

  useEffect(() => {
    const stored = getPref<SizeOption>(`pageSize.${prefKey}`, 50);
    let initial: SizeOption = stored;
    if (fromUrl !== null) {
      const parsed: number | string = isNaN(Number(fromUrl)) ? fromUrl : Number(fromUrl);
      if (isValidOption(parsed)) initial = parsed;
    }
    setSize(initial);
  }, [fromUrl, prefKey]);

  const onChange = (v: SizeOption) => {
    setSize(v);
    setPref(`pageSize.${prefKey}`, v);
    const next = new URLSearchParams(params.toString());
    next.set(paramName, String(v));
    next.delete(pageParamName);
    router.push(`${pathname}?${next.toString()}` as Route);
  };

  return (
    <label className="text-sm inline-flex items-center gap-2">
      Per page:
      <select
        value={String(size)}
        onChange={(e) => {
          const v: number | string = isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value);
          if (isValidOption(v)) onChange(v);
        }}
        className="border rounded px-2 py-1 text-sm bg-white dark:bg-neutral-900"
      >
        {OPTIONS.map((o) => (
          <option key={String(o)} value={String(o)}>{o === "all" ? "All" : o}</option>
        ))}
      </select>
    </label>
  );
}
