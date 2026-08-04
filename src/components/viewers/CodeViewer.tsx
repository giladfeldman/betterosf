"use client";

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { TextMeta } from "./TextMeta";

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

export function CodeViewer({
  url,
  filename,
  sizeBytes = null,
}: {
  url: string;
  filename: string;
  sizeBytes?: number | null;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        if (cancelled) return;
        setText(body);

        // Shiki emits an empty <pre> for empty input, which renders as a blank
        // pane. Skip highlighting entirely — TextMeta reports the empty state.
        if (body.length === 0) {
          setHtml("");
          return;
        }

        const lang = extToLang(filename);
        const rendered = await codeToHtml(body, {
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
  if (html === null || text === null) return <div className="p-4 text-neutral-500">Loading…</div>;

  return (
    <div className="p-4 text-sm overflow-auto">
      <TextMeta filename={filename} text={text} sizeBytes={sizeBytes} />
      {html && (
        <div
          className="[&_pre]:!bg-transparent [&_pre]:p-4 [&_pre]:rounded
                     [&_pre.shiki]:bg-neutral-50 [&_pre.shiki]:dark:bg-neutral-900"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
