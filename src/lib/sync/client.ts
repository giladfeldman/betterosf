"use client";

import type { FavoriteRef } from "@/lib/favorites";
import { listPins } from "@/lib/favorites";
import { getPref, setPref } from "@/lib/prefs";

const PINS_KEY = "favorites.pins";
const SYNCED_FLAG = "sync.bookmarksImported";

export async function fetchServerBookmarks(): Promise<FavoriteRef[] | null> {
  try {
    const res = await fetch("/api/me/bookmarks", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 503) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: FavoriteRef[] };
    return data.items ?? [];
  } catch {
    return null;
  }
}

export async function putServerBookmark(ref: FavoriteRef): Promise<FavoriteRef[] | null> {
  try {
    const res = await fetch("/api/me/bookmarks", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ref),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: FavoriteRef[] };
    return data.items ?? null;
  } catch {
    return null;
  }
}

export async function deleteServerBookmark(id: string): Promise<FavoriteRef[] | null> {
  try {
    const res = await fetch(`/api/me/bookmarks?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: FavoriteRef[] };
    return data.items ?? null;
  } catch {
    return null;
  }
}

/** On first signed-in load: push local pins to server, then mirror server → local. */
export async function syncBookmarksOnSignIn(): Promise<FavoriteRef[]> {
  const local = listPins();
  const already = getPref<boolean>(SYNCED_FLAG, false);
  try {
    if (!already && local.length > 0) {
      const res = await fetch("/api/me/bookmarks", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: local }),
      });
      if (res.ok) {
        const data = (await res.json()) as { items?: FavoriteRef[] };
        const items = data.items ?? local;
        setPref(PINS_KEY, items);
        setPref(SYNCED_FLAG, true);
        return items;
      }
    }
    const server = await fetchServerBookmarks();
    if (server) {
      setPref(PINS_KEY, server);
      setPref(SYNCED_FLAG, true);
      return server;
    }
  } catch {
    /* keep local */
  }
  return local;
}

export async function syncPrefsOnSignIn(): Promise<void> {
  try {
    const res = await fetch("/api/me/prefs", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as { prefs?: Record<string, unknown> };
    const server = data.prefs ?? {};
    const localPatch: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith("betterosf:")) continue;
        const short = key.slice("betterosf:".length);
        if (short.startsWith("favorites.") || short.startsWith("sync.")) continue;
        try {
          localPatch[short] = JSON.parse(localStorage.getItem(key) ?? "null");
        } catch {
          /* skip */
        }
      }
    } catch {
      /* no localStorage */
    }
    const merged = { ...server, ...localPatch };
    for (const [k, v] of Object.entries(merged)) {
      setPref(k, v);
    }
    if (Object.keys(localPatch).length > 0) {
      await fetch("/api/me/prefs", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: merged, merge: false }),
      });
    }
  } catch {
    /* ignore */
  }
}

export async function pushPrefToServer(key: string, value: unknown): Promise<void> {
  try {
    await fetch("/api/me/prefs", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: { [key]: value }, merge: true }),
    });
  } catch {
    /* ignore */
  }
}
