"use client";

export function WithinProjectSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search files in this project…"
      className="border rounded px-3 py-1.5 text-sm w-full max-w-md"
      aria-label="Search within project"
    />
  );
}
