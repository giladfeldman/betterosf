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
  // Lazy initializer: derive the initial size from the URL param synchronously so
  // the <select> renders the correct value on the first paint instead of flashing
  // 50 and then correcting in an effect. The URL is the authoritative source for a
  // paginated view; the localStorage pref only fills in when the URL omits size.
  const [size, setSize] = useState<SizeOption>(() => {
    if (fromUrl !== null) {
      const parsed: number | string = isNaN(Number(fromUrl)) ? fromUrl : Number(fromUrl);
      if (isValidOption(parsed)) return parsed;
    }
    return 50;
  });

  useEffect(() => {
    // localStorage isn't available during SSR/first paint, so fold the stored
    // pref in here — but only when the URL didn't already pin a size.
    if (fromUrl !== null) {
      const parsed: number | string = isNaN(Number(fromUrl)) ? fromUrl : Number(fromUrl);
      if (isValidOption(parsed)) { setSize(parsed); return; }
    }
    const stored = getPref<SizeOption>(`pageSize.${prefKey}`, 50);
    setSize(stored);
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
