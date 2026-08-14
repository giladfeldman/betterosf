/**
 * Saving the finished archive, and being straight about where it goes.
 *
 * The question a researcher asks — "where is it downloading to on my computer?" — had no
 * good answer, because the honest one is in two parts and the UI was only telling the
 * scary half of it:
 *
 *   1. **During the run, nothing lands in your Downloads folder.** Each file is streamed
 *      into the browser's private storage (OPFS), verified, added to the archive, and then
 *      released — so peak disk use is one file, not the whole project. That storage is not
 *      browsable; it is not a folder you can open.
 *   2. **At the end you save the archive**, and only then does a file appear somewhere you
 *      chose.
 *
 * Where "somewhere you chose" actually is depends on the browser, and this module makes
 * that explicit rather than leaving it to be discovered:
 *
 *   - **Chrome and Edge** support `showSaveFilePicker`, so the researcher picks the folder
 *     and filename, and the bytes stream straight into that file.
 *   - **Firefox and Safari** do not. They get the ordinary download, which lands wherever
 *     the browser is configured to put downloads — usually `~/Downloads`, without asking,
 *     unless "always ask where to save files" is enabled.
 *
 * The UI reads `canChooseSaveLocation()` to say which of those will happen BEFORE the
 * button is pressed, because "it downloaded, but I do not know where" is a bad end to an
 * hour-long export.
 */

import { downloadBlob } from "@/lib/backup/download";

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
};

type PickerWindow = Window & {
  showSaveFilePicker?: (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

/** True when the browser can let the user choose a folder and filename. */
export function canChooseSaveLocation(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showSaveFilePicker === "function";
}

export type SaveOutcome =
  | { saved: true; picked: true; name: string }
  | { saved: true; picked: false; name: string }
  | { saved: false; cancelled: true }
  | { saved: false; cancelled: false; error: string };

/**
 * Save an archive, letting the user choose where when the browser allows it.
 *
 * Returns what actually happened. A cancelled picker is NOT an error — the researcher
 * changed their mind, and the archive is still in memory to try again — but it must not be
 * reported as a successful save either, which is why the two are distinct outcomes.
 */
export async function saveArchive(blob: Blob, filename: string): Promise<SaveOutcome> {
  const picker = (window as PickerWindow).showSaveFilePicker;

  if (typeof picker === "function") {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: filename,
        types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
      });
    } catch (e) {
      // AbortError is the user dismissing the dialog. Anything else is a real problem,
      // and falling back silently would hide it.
      if (e instanceof DOMException && e.name === "AbortError") {
        return { saved: false, cancelled: true };
      }
      return {
        saved: false,
        cancelled: false,
        error: e instanceof Error ? e.message : "The save dialog could not be opened.",
      };
    }

    try {
      // Streamed rather than written whole: a multi-gigabyte archive must not have to be
      // materialised twice.
      const writable = await handle.createWritable();
      await blob.stream().pipeTo(writable);
      return { saved: true, picked: true, name: handle.name };
    } catch (e) {
      return {
        saved: false,
        cancelled: false,
        error: e instanceof Error ? e.message : "The archive could not be written to that location.",
      };
    }
  }

  // No picker in this browser. The ordinary download goes wherever the browser puts
  // downloads — we cannot observe where, and must not claim to.
  downloadBlob(blob, filename);
  return { saved: true, picked: false, name: filename };
}
