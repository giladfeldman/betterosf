"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";

// A structurally valid .docx renders into the container as real content —
// paragraphs/headings/tables/images carrying text or media. An EMPTY render —
// no text and no media anywhere — means docx-preview parsed the file but
// produced nothing. The usual culprit is a malformed .docx with multiple
// <w:body> elements (survey-tool exports like Qualtrics concatenate many
// document bodies; the spec allows exactly one). docx-preview reads only the
// first <w:body>, which is often empty, and resolves WITHOUT throwing — so we
// must detect the blank result ourselves rather than trust renderAsync.
// See KNOWN_ISSUES.md and the research note: no docx-preview option repairs
// this; only Microsoft Word silently merges the bodies on open.
//
// IMPORTANT: do NOT key this on a specific wrapper element (e.g. <article>).
// docx-preview's output structure varies by version and document, and an
// element-name assumption silently false-positives — blanking valid files
// (regression caught by visual-qa 2026-06-07, fixed here). Detect content by
// the presence of media OR non-whitespace text, ignoring the <style> block
// docx-preview injects (its CSS text is not document content).
export function renderProducedContent(container: HTMLElement): boolean {
  if (container.querySelector("img, table, svg")) return true;
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style, script").forEach((n) => n.remove());
  return (clone.textContent ?? "").trim().length > 0;
}

export function DocxViewer({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ renderAsync }, res] = await Promise.all([
          import("docx-preview"),
          fetch(url),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        await renderAsync(blob, ref.current, undefined, {
          className: "docx-render",
          renderChanges: true,
        });
        if (cancelled || !ref.current) return;
        // docx-preview writes HTML straight into the live DOM from an UNTRUSTED
        // OSF file. Every other untrusted-content viewer routes through DOMPurify;
        // this one didn't. Scrub in place after render — the CSP blocks inline
        // handlers, but `javascript:` hrefs aren't covered by script-src, so this
        // is the layer that removes them. Keep svg/tables/images (real document
        // content); DOMPurify strips scripts, event handlers, and javascript: URIs.
        ref.current.innerHTML = DOMPurify.sanitize(ref.current.innerHTML, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
        });
        // renderAsync resolves even when it silently rendered nothing (e.g. a
        // malformed multi-body .docx). Treat a blank result as a failure so we
        // show a clear message instead of an empty gray page.
        if (!renderProducedContent(ref.current)) {
          ref.current.innerHTML = "";
          setEmpty(true);
        }
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (empty) {
    return (
      <div className="p-6 max-w-xl">
        <h2 className="text-lg font-semibold mb-2">Couldn’t preview this document</h2>
        <p className="text-neutral-700 dark:text-neutral-300 mb-2">
          This <code>.docx</code> file is malformed — its internal structure
          contains multiple document bodies, which violates the Word file
          format (exactly one is allowed). This is common in files exported by
          survey tools such as Qualtrics.
        </p>
        <p className="text-neutral-700 dark:text-neutral-300 mb-4">
          Browser-based previewers can’t render it, but Microsoft Word repairs
          the file automatically when you open it. Download it to view the full
          document.
        </p>
        <a
          href={`${url}&dl=1`}
          download
          className="inline-flex items-center border rounded px-3 py-2 bg-blue-600 text-white hover:bg-blue-700"
        >
          <span aria-hidden="true">⬇</span> <span className="ml-1">Download to view in Word</span>
        </a>
      </div>
    );
  }

  return (
    <div className="p-4">
      {loading && !error && <div className="text-neutral-500">Loading DOCX…</div>}
      {error && <div className="text-red-600">Failed to load DOCX: {error}</div>}
      <div ref={ref} className="max-w-4xl bg-white text-black [&_.docx-render]:p-6 [&_.docx-render]:shadow [&_.docx-render]:rounded" />
      {!loading && !error && (
        <p className="mt-2 text-xs text-neutral-500">
          Track changes rendering is experimental.{" "}
          <a href={`${url}&dl=1`} download className="underline">Download</a>{" "}
          for full document fidelity in Word.
        </p>
      )}
    </div>
  );
}
