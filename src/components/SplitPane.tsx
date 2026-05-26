"use client";

import { useEffect, useRef, useState } from "react";
import { getPref, setPref } from "@/lib/prefs";

export function SplitPane({
  prefKey,
  defaultLeftWidth = 320,
  minLeft = 200,
  maxLeft = 600,
  left,
  right,
}: {
  prefKey: string;
  defaultLeftWidth?: number;
  minLeft?: number;
  maxLeft?: number;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const [width, setWidth] = useState<number>(defaultLeftWidth);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    setWidth(getPref(`splitPane.${prefKey}`, defaultLeftWidth));
  }, [prefKey, defaultLeftWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(maxLeft, Math.max(minLeft, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      setPref(`splitPane.${prefKey}`, width);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width, prefKey, minLeft, maxLeft]);

  const onDown = () => {
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
  };

  const vars = {
    "--left-width": `${width}px`,
  } as React.CSSProperties;

  return (
    <div className="flex w-full flex-col md:h-[calc(100vh-8rem)] md:flex-row" style={vars}>
      <button
        type="button"
        aria-expanded={mobileNavOpen}
        onClick={() => setMobileNavOpen((open) => !open)}
        className="mb-3 inline-flex w-fit items-center gap-2 rounded border border-neutral-300 px-3 py-2 text-sm font-medium dark:border-neutral-700 md:hidden"
      >
        <span aria-hidden="true">{mobileNavOpen ? "▼" : "▶"}</span>
        {mobileNavOpen ? "Hide navigator" : "Show navigator"}
      </button>
      <aside className={`${mobileNavOpen ? "block" : "hidden"} max-h-[45vh] w-full overflow-y-auto border-b border-neutral-200 dark:border-neutral-800 md:block md:max-h-none md:w-[var(--left-width)] md:flex-shrink-0 md:border-b-0 md:border-r`}>
        {left}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tree pane"
        tabIndex={0}
        onMouseDown={onDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth((w) => Math.max(minLeft, w - 20));
          if (e.key === "ArrowRight") setWidth((w) => Math.min(maxLeft, w + 20));
        }}
        className="hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500 focus-visible:bg-blue-500 md:block"
      />
      <main className="min-w-0 flex-1 overflow-visible md:overflow-y-auto">{right}</main>
    </div>
  );
}
