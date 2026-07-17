"use client";

import { useEffect } from "react";
import { syncBookmarksOnSignIn, syncPrefsOnSignIn } from "@/lib/sync/client";

/** Mount once in the signed-in shell to pull/push Neon-backed prefs + bookmarks. */
export function SyncOnSignIn() {
  useEffect(() => {
    void (async () => {
      await syncBookmarksOnSignIn();
      await syncPrefsOnSignIn();
      window.dispatchEvent(new Event("betterosf:sync"));
    })();
  }, []);
  return null;
}
