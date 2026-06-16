"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import DOMPurify from "dompurify";

type NotebookOutput = {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  text?: string | string[];
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
};

type Cell = {
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
};

type Notebook = { cells: Cell[]; metadata?: { kernelspec?: { display_name?: string } } };

function joinSource(s: string | string[]): string {
  return Array.isArray(s) ? s.join("") : s;
}

function sanitizeNotebookHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
  });
}

function CellOutputs({ outputs }: { outputs: NotebookOutput[] }) {
  return (
    <div className="space-y-1">
      {outputs.map((out, i) => {
        if (out.output_type === "stream") {
          return <pre key={i} className="bg-neutral-100 dark:bg-neutral-900 p-2 rounded text-xs whitespace-pre-wrap">{joinSource(out.text ?? "")}</pre>;
        }
        if (out.output_type === "error") {
          return <pre key={i} className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 p-2 rounded text-xs">{out.ename}: {out.evalue}{"\n"}{(out.traceback ?? []).join("\n")}</pre>;
        }
        if (out.data) {
          const png = out.data["image/png"];
          if (png) {
            const b64 = Array.isArray(png) ? png.join("") : png;
            // eslint-disable-next-line @next/next/no-img-element
            return <img key={i} src={`data:image/png;base64,${b64}`} alt="output" className="max-w-full" />;
          }
          const svgXml = out.data["image/svg+xml"];
          if (svgXml) {
            return <div key={i} dangerouslySetInnerHTML={{ __html: sanitizeNotebookHtml(joinSource(svgXml)) }} />;
          }
          const htmlOut = out.data["text/html"];
          if (htmlOut) {
            return <div key={i} className="overflow-auto" dangerouslySetInnerHTML={{ __html: sanitizeNotebookHtml(joinSource(htmlOut)) }} />;
          }
          const txt = out.data["text/plain"];
          if (txt) {
            return <pre key={i} className="bg-neutral-100 dark:bg-neutral-900 p-2 rounded text-xs whitespace-pre-wrap">{joinSource(txt)}</pre>;
          }
        }
        return null;
      })}
    </div>
  );
}

export function NotebookViewer({ url }: { url: string }) {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: Notebook = await res.json();
        if (!cancelled) setNotebook(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed: {error}</div>;
  if (!notebook) return <div className="p-4 text-neutral-500">Loading notebook…</div>;

  return (
    <div className="p-4 max-w-4xl space-y-4">
      <p className="text-xs text-neutral-500">Kernel: {notebook.metadata?.kernelspec?.display_name ?? "unknown"}</p>
      {notebook.cells.map((cell, i) => {
        const src = joinSource(cell.source);
        if (cell.cell_type === "markdown") {
          return (
            <div key={i} className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{src}</ReactMarkdown>
            </div>
          );
        }
        if (cell.cell_type === "code") {
          return (
            <div key={i} className="border-l-2 border-blue-300 dark:border-blue-700 pl-3 space-y-1">
              <pre className="bg-neutral-50 dark:bg-neutral-900 p-2 rounded text-xs overflow-auto"><code>{src}</code></pre>
              {cell.outputs && cell.outputs.length > 0 && <CellOutputs outputs={cell.outputs} />}
            </div>
          );
        }
        // raw cell
        return <pre key={i} className="text-xs whitespace-pre-wrap">{src}</pre>;
      })}
    </div>
  );
}
