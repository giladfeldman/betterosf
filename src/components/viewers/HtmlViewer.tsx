"use client";
import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

export function HtmlViewer({ url }: { url: string }) {
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setBlobUrl("");
    setError("");
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const clean = DOMPurify.sanitize(text, { WHOLE_DOCUMENT: true });
        // Serve the sanitized HTML from a blob: URL rather than `srcDoc`. A
        // srcdoc iframe inherits the PARENT page's base URL, so the file's own
        // in-page anchor links (e.g. a table-of-contents "#section") resolve to
        // the BetterOSF page URL and navigate the iframe to BetterOSF — i.e.
        // BetterOSF rendered inside BetterOSF. A blob: document has its own URL,
        // so "#section" links stay in-document and scroll the preview.
        const blob = new Blob([clean], { type: "text/html" });
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError("This HTML file could not be previewed.");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (error) {
    return (
      <div className="p-4 text-sm">
        <p className="mb-3">{error}</p>
        <a href={url} className="text-blue-600 hover:underline">Download HTML</a>
      </div>
    );
  }

  return (
    <div className="p-2 h-full">
      <iframe
        src={blobUrl || undefined}
        // `allow-same-origin` is required for a sandboxed iframe to load a blob:
        // URL created by this page. Scripts stay disabled (no `allow-scripts`)
        // and DOMPurify has already stripped scripts/event handlers, so the
        // same-origin grant cannot be abused — the document is inert HTML/CSS.
        sandbox="allow-same-origin"
        className="w-full h-full border rounded"
        title="HTML preview"
      />
    </div>
  );
}
