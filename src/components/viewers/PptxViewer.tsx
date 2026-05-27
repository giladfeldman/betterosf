"use client";

import { useEffect, useMemo, useState } from "react";

type SlidePreview = {
  index: number;
  title: string;
  text: string[];
  images: { name: string; dataUrl: string }[];
};

function textFromXml(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const nodes = Array.from(doc.getElementsByTagName("a:t"));
  const text = nodes
    .map((n) => n.textContent?.trim() ?? "")
    .filter(Boolean);
  const lines: string[] = [];
  for (const t of text) {
    const last = lines[lines.length - 1];
    if (last && last.length + t.length < 120) lines[lines.length - 1] = `${last} ${t}`;
    else lines.push(t);
  }
  return lines;
}

function contentTypeForMedia(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function relTargets(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("Relationship"))
    .map((r) => r.getAttribute("Target") ?? "")
    .filter((target) => target.includes("../media/"))
    .map((target) => target.replace("../", "ppt/"));
}

async function fileToDataUrl(file: import("jszip").JSZipObject, name: string): Promise<string> {
  const blob = await file.async("blob");
  const typed = blob.type ? blob : new Blob([blob], { type: contentTypeForMedia(name) });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(typed);
  });
}

export function PptxViewer({ url, filename }: { url: string; filename: string }) {
  const [slides, setSlides] = useState<SlidePreview[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: JSZip }, res] = await Promise.all([import("jszip"), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const slideFiles = Object.values(zip.files)
          .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name))
          .sort((a, b) => {
            const an = Number(a.name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
            const bn = Number(b.name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
            return an - bn;
          });

        const parsed = await Promise.all(slideFiles.map(async (slideFile, idx) => {
          const xml = await slideFile.async("text");
          const text = textFromXml(xml);
          const relName = slideFile.name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
          const relXml = zip.file(relName) ? await zip.file(relName)!.async("text") : "";
          const imageTargets = relXml ? relTargets(relXml) : [];
          const images = await Promise.all(
            imageTargets.slice(0, 6).map(async (target) => {
              const imageFile = zip.file(target);
              if (!imageFile) return null;
              return {
                name: target.split("/").pop() ?? target,
                dataUrl: await fileToDataUrl(imageFile, target),
              };
            })
          );
          return {
            index: idx + 1,
            title: text[0] || `Slide ${idx + 1}`,
            text,
            images: images.filter((img): img is { name: string; dataUrl: string } => img != null),
          };
        }));
        if (!cancelled) setSlides(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const active = slides?.[activeIdx] ?? null;
  const slideCount = slides?.length ?? 0;
  const downloadName = useMemo(() => `Download ${filename}`, [filename]);

  if (error) return <div className="p-4 text-red-600">Failed to load PPTX preview: {error}</div>;
  if (!slides) return <div className="p-4 text-neutral-500">Loading PPTX preview...</div>;
  if (!active) {
    return (
      <div className="p-4">
        <p className="text-neutral-500">This PPTX has no readable slides.</p>
        <a href={url} download className="mt-3 inline-block text-blue-600 hover:underline">{downloadName}</a>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[32rem] flex-col bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
        <div>
          <p className="font-medium">PPTX preview</p>
          <p className="text-xs text-neutral-500">Text and embedded images extracted from {slideCount} slide{slideCount === 1 ? "" : "s"}; download for exact PowerPoint layout.</p>
        </div>
        <a href={url} download className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-900">
          Download
        </a>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Slides" className="max-h-64 overflow-auto border-b border-neutral-200 p-2 dark:border-neutral-800 md:max-h-none md:border-b-0 md:border-r">
          {slides.map((slide, idx) => (
            <button
              key={slide.index}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`mb-2 block w-full rounded border px-2 py-2 text-left text-xs ${idx === activeIdx ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-neutral-200 hover:bg-white dark:border-neutral-800 dark:hover:bg-neutral-900"}`}
            >
              <span className="block font-medium">Slide {slide.index}</span>
              <span className="line-clamp-2 text-neutral-600 dark:text-neutral-400">{slide.title}</span>
            </button>
          ))}
        </nav>
        <article className="overflow-auto p-4 md:p-6">
          <div className="mx-auto max-w-5xl rounded border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-4 text-sm text-neutral-500">Slide {active.index} of {slideCount}</p>
            {active.images.length > 0 && (
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                {active.images.map((image) => (
                  <img
                    key={image.name}
                    src={image.dataUrl}
                    alt=""
                    className="max-h-80 w-full rounded border border-neutral-200 object-contain dark:border-neutral-800"
                  />
                ))}
              </div>
            )}
            {active.text.length > 0 ? (
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold">{active.text[0]}</h2>
                {active.text.slice(1).map((line, i) => (
                  <p key={`${line}-${i}`} className="text-base leading-relaxed">{line}</p>
                ))}
              </div>
            ) : (
              <p className="text-neutral-500">No extractable text found on this slide.</p>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
