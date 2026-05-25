"use client";

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

function extToLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
    mjs: "javascript", cjs: "javascript",
    py: "python", r: "r", rmd: "r", do: "stata",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift",
    rb: "ruby", php: "php", sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml",
    json: "json", md: "markdown", html: "html", css: "css",
    txt: "text", log: "text",
  };
  return map[ext] ?? "text";
}

export function CodeViewer({ url, filename }: { url: string; filename: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const lang = extToLang(filename);
        const rendered = await codeToHtml(text, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false, // emit both themes; we override via CSS
        });
        if (!cancelled) setHtml(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url, filename]);

  if (error) return <div className="p-4 text-red-600">Failed: {error}</div>;
  if (html === null) return <div className="p-4 text-neutral-500">Loading…</div>;

  return (
    <div
      className="p-4 text-sm overflow-auto
                 [&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:rounded
                 [&_pre.shiki]:bg-neutral-50 [&_pre.shiki]:dark:bg-neutral-900"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
