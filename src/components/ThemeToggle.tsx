"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);
  if (!mounted) {
    // Placeholder to keep layout stable until hydration
    return <button type="button" aria-label="Theme toggle" className="w-8 h-8 border rounded" />;
  }

  const cycle = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  };

  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";
  const icon = theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥️";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to cycle.`}
      title={`Theme: ${label}. Click to cycle.`}
      className="text-sm border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <span aria-hidden="true">{icon}</span> <span className="sr-only md:not-sr-only">{label}</span>
    </button>
  );
}
