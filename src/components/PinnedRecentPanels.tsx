"use client";

import { useEffect, useState } from "react";
import { listPins, listRecent, type FavoriteRef } from "@/lib/favorites";

function panel(title: string, items: FavoriteRef[], emptyMsg: string) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      {items.length === 0 ? (
        <p className="text-neutral-500 text-sm">{emptyMsg}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((p) => (
            <li key={`${p.kind}:${p.id}`}>
              <a
                href={p.kind === "registration" ? `/registrations/${p.id}` : `/${p.id}`}
                className="text-blue-600 hover:underline"
              >
                {p.title}
              </a>
              <span className="ml-2 text-xs text-neutral-500">{p.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PinnedRecentPanels({
  showPinned = true,
  showRecent = true,
}: {
  showPinned?: boolean;
  showRecent?: boolean;
}) {
  const [pins, setPins] = useState<FavoriteRef[]>([]);
  const [recent, setRecent] = useState<FavoriteRef[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setPins(listPins());
    setRecent(listRecent());
  }, []);
  if (!mounted) return null;
  return (
    <>
      {showPinned &&
        panel(
          "Pinned",
          pins,
          "No pins yet — click ☆ on a project, registration, or file to pin it.",
        )}
      {showRecent &&
        panel(
          "Recently viewed",
          recent.slice(0, 10),
          "Browse a few projects and they'll appear here.",
        )}
    </>
  );
}
