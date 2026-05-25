"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

export function SvgViewer({ url, alt }: { url: string; alt: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) {
          // Sanitize before injection
          const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } });
          setSvg(clean);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed to load SVG: {error}</div>;
  if (svg === null) return <div className="p-4 text-neutral-500">Loading…</div>;
  return (
    <div className="p-4 flex justify-center" aria-label={alt} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
