"use client";

export function WithinProjectSearch({
  value,
  onChange,
  deep,
  onDeepChange,
  loadingDeep,
}: {
  value: string;
  onChange: (v: string) => void;
  deep: boolean;
  onDeepChange: (v: boolean) => void;
  loadingDeep: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search files in this project…"
        className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[16rem] max-w-md"
        aria-label="Search within project"
      />
      <label className="text-sm flex items-center gap-1 select-none">
        <input
          type="checkbox"
          checked={deep}
          onChange={(e) => onDeepChange(e.target.checked)}
          aria-label="Include collapsed folders"
        />
        Include collapsed folders
      </label>
      {loadingDeep && <span className="text-xs text-neutral-500">Loading deep entries…</span>}
    </div>
  );
}
