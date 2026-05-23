"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { parseOsfUrl } from "@/lib/osf/guid";

export function GuidEntryForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const guid = parseOsfUrl(value);
    if (!guid) {
      setError("Not a valid OSF URL or GUID");
      return;
    }
    router.push(`/${guid}` as Route);
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2 max-w-lg">
      <input
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        placeholder="https://osf.io/ezcuj or ezcuj"
        className="flex-1 border rounded px-3 py-2 bg-white dark:bg-neutral-900"
        aria-label="OSF project URL or GUID"
      />
      <button type="submit" className="border rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700">
        Browse
      </button>
      {error && <p className="text-red-600 text-sm w-full">{error}</p>}
    </form>
  );
}
