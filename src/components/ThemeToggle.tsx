"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS: { value: "light" | "dark" | "system"; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "system", label: "System", icon: "🖥️" },
  { value: "dark", label: "Dark", icon: "🌙" },
];

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Stable placeholder until hydration so the layout doesn't shift
    return (
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex items-center border rounded overflow-hidden text-xs"
      >
        {OPTIONS.map((o) => (
          <span key={o.value} className="px-2 py-1 opacity-50" aria-hidden="true">
            {o.icon}
          </span>
        ))}
      </div>
    );
  }

  const current = (theme ?? "system") as "light" | "dark" | "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center border border-neutral-300 dark:border-neutral-700 rounded overflow-hidden text-xs"
    >
      {OPTIONS.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${o.label} theme`}
            title={`${o.label} theme`}
            onClick={() => setTheme(o.value)}
            className={
              "px-2 py-1 inline-flex items-center gap-1 transition-colors " +
              (active
                ? "bg-blue-600 text-white"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300")
            }
          >
            <span aria-hidden="true">{o.icon}</span>
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
