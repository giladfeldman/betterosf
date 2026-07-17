"use client";

import { useEffect, useState } from "react";
import { addPin, removePin, isPinned, type FavoriteRef } from "@/lib/favorites";
import { deleteServerBookmark, putServerBookmark } from "@/lib/sync/client";

export function PinButton({ refEntry }: { refEntry: FavoriteRef }) {
  const [pinned, setPinned] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPinned(isPinned(refEntry.id));
    const onSync = () => setPinned(isPinned(refEntry.id));
    window.addEventListener("betterosf:sync", onSync);
    return () => window.removeEventListener("betterosf:sync", onSync);
  }, [refEntry.id]);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Loading pin state"
        className="text-sm border rounded px-2 py-1"
      >
        <span aria-hidden="true">⭐</span>
      </button>
    );
  }

  const toggle = () => {
    if (pinned) {
      removePin(refEntry.id);
      setPinned(false);
      void deleteServerBookmark(refEntry.id);
    } else {
      addPin(refEntry);
      setPinned(true);
      void putServerBookmark(refEntry);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={pinned ? "Unpin" : "Pin"}
      aria-pressed={pinned}
      title={pinned ? "Unpin" : "Pin"}
      className={`text-sm border rounded px-2 py-1 ${pinned ? "bg-amber-100 dark:bg-amber-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
    >
      <span aria-hidden="true">{pinned ? "⭐" : "☆"}</span>
      <span className="ml-1 sr-only md:not-sr-only">{pinned ? "Pinned" : "Pin"}</span>
    </button>
  );
}
