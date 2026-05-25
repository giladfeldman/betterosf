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

  return (
    <div className="flex w-full" style={{ height: "calc(100vh - 8rem)" }}>
      <aside className="overflow-y-auto border-r border-neutral-200 dark:border-neutral-800" style={{ width, flexShrink: 0 }}>
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
        className="w-1 cursor-col-resize bg-transparent hover:bg-blue-500 focus-visible:bg-blue-500 transition-colors"
      />
      <main className="flex-1 overflow-y-auto">{right}</main>
    </div>
  );
}
