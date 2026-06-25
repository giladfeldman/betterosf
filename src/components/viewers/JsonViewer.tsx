"use client";

import { useEffect, useState } from "react";
import { JSONTree } from "react-json-tree";

export function JsonViewer({ url }: { url: string }) {
  // Discriminated state so a file whose JSON content is literally `null` renders
  // as `null` instead of being stuck on "Loading…" forever (the old code used a
  // `null` data value as the not-yet-loaded sentinel, which collided with it).
  const [state, setState] = useState<{ loaded: false } | { loaded: true; data: unknown }>({ loaded: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ loaded: false });
    setError(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setState({ loaded: true, data: json });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="p-4 text-red-600">Failed: {error}</div>;
  if (!state.loaded) return <div className="p-4 text-neutral-500">Loading…</div>;

  // react-json-tree supports light/dark via theme — pass a minimal one
  const theme = {
    base00: "transparent", base01: "#444", base02: "#777",
    base03: "#aaa", base04: "#bbb", base05: "#ccc",
    base06: "#ddd", base07: "#eee", base08: "#e06c75",
    base09: "#d19a66", base0A: "#e5c07b", base0B: "#98c379",
    base0C: "#56b6c2", base0D: "#61afef", base0E: "#c678dd", base0F: "#be5046",
  };
  return (
    <div className="p-4 text-sm font-mono-files">
      <JSONTree data={state.data} theme={theme} invertTheme={false} shouldExpandNodeInitially={(_k, _v, level) => level < 2} />
    </div>
  );
}
