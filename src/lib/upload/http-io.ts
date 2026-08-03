// Live HTTP implementation of UploadIO, shared by the upload dialog and backup restore.
//
// Extracted from UploadDialog so restore uses the exact same code path uploads do —
// one implementation means a fix to conflict handling or error surfacing benefits both.

import type { FileEntry } from "@/lib/osf/files";
import { throwFromResponse } from "@/lib/http/read-error";
import { uploadFileDirect } from "./direct";
import type { UploadIO } from "./orchestrate";

export function makeHttpUploadIO(guid: string): UploadIO {
  return {
    list: async (t) => {
      const res = await fetch(
        `/api/files/${guid}/folder?` + new URLSearchParams({ listingUrl: t.listingUrl, fresh: "1" }),
        { cache: "no-store" }
      );
      if (!res.ok) await throwFromResponse(res, "Could not read folder");
      const data: { entries: FileEntry[] } = await res.json();
      return data.entries;
    },
    createFolder: async (t, name) => {
      const res = await fetch(`/api/files/${guid}/folder-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: t.provider,
          path: t.path,
          listingUrl: t.listingUrl,
          uploadUrl: t.uploadUrl,
          newFolderUrl: t.newFolderUrl,
          name,
        }),
      });
      // 409 = the folder already exists → merge into it, not an error.
      if (!res.ok && res.status !== 409) await throwFromResponse(res, "Folder creation failed");
    },
    // File bytes go straight from the browser to OSF Waterbutler (bypassing Vercel's
    // 4.5 MB function-body limit so any size up to OSF's 5 GB/file works and never
    // silently fails). Listing + folder-create above stay on the server routes, so the
    // OSF token is only needed in the browser for this PUT. Forward opts verbatim so the
    // orchestrator's skipDuplicateCheck reaches direct.ts (halves the per-file API calls).
    uploadFile: (t, file, opts) => uploadFileDirect(t, file, opts),
  };
}
