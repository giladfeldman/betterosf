"use client";
import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

export function HtmlViewer({ url }: { url: string }) {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setHtml("");
    setError("");
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setHtml(DOMPurify.sanitize(text, { WHOLE_DOCUMENT: true }));
      })
      .catch(() => {
        if (!cancelled) setError("This HTML file could not be previewed.");
      });
    return () => {
      cancelled = true;
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
        srcDoc={html || "<!doctype html><html><body></body></html>"}
        sandbox=""
        className="w-full h-full border rounded"
        title="HTML preview"
      />
    </div>
  );
}
