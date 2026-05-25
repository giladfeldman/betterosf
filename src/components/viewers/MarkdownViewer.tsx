"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function MarkdownViewer({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const t = await res.text();
        if (!cancelled) setText(t);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed to load: {error}</div>;
  if (text === null) return <div className="p-4 text-neutral-500">Loading…</div>;

  return (
    <article
      className="p-6 max-w-4xl prose-md text-neutral-800 dark:text-neutral-200 leading-relaxed
                 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3
                 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2
                 [&_h3]:text-xl  [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2
                 [&_p]:my-3
                 [&_a]:text-blue-600 [&_a]:hover:underline
                 [&_code]:bg-neutral-100 [&_code]:dark:bg-neutral-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                 [&_pre]:bg-neutral-100 [&_pre]:dark:bg-neutral-900 [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto
                 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6
                 [&_blockquote]:border-l-4 [&_blockquote]:border-neutral-300 [&_blockquote]:dark:border-neutral-700 [&_blockquote]:pl-3 [&_blockquote]:my-3
                 [&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:p-2 [&_td]:p-2"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown>
    </article>
  );
}
