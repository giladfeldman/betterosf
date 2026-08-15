/**
 * One definition of "a path safe to write to a filesystem or send as a Zenodo key".
 *
 * Used on both sides of the toolkit, deliberately from one module rather than two copies —
 * the copies drift, and that is defect class 10:
 *
 *   - **Outbound** (`run-export`, `run-transfer`): OSF names → ZIP entry names and Zenodo
 *     file keys.
 *   - **Inbound** (`zenodo-download`): Zenodo keys → ZIP entry names.
 *
 * ## What OSF actually allows, measured 2026-08-14 on a throwaway project
 *
 * Traversal is NOT reachable, and saying otherwise would be the overstatement this file's
 * first draft made: OSF rejects `..` and `../escape.txt` as file names with **400**, and
 * rejects `..`, `a\b` and `we<ird>` as *folder* names with 400 as well. A folder name can
 * therefore never poison a path segment.
 *
 * A FILE name can, and these all returned **201** and were listed back verbatim:
 *
 *   - `a\b.txt`   — a backslash. On Windows this silently becomes folder `a` + file `b.txt`,
 *                   restructuring the researcher's archive without a word.
 *   - `CON`       — a reserved device name; Windows cannot create the file at all.
 *   - `we<ird>.txt` — characters Windows forbids; unzippers fail or mangle them.
 *   - `trailing. ` — OSF strips the trailing space itself, keeping the dot, which Windows
 *                   then drops silently.
 *
 * That is why this runs on the outbound path too. Without it a report can say `verified`
 * for a file the reader's computer cannot write — a true statement about the checksum and a
 * false one about what they now have.
 *
 * **Neutralise, never drop.** Removing a file would lose data that genuinely exists;
 * rewriting the name keeps it and is reported, so nothing is silently renamed. Two distinct
 * OSF names CAN collapse to the same safe name (`a<b.txt` and `a>b.txt`); `reconcile()`
 * already detects destination-key collisions and refuses to call such a run complete.
 */

/** Characters Windows forbids in a path segment. `/` and `\` are handled as separators. */
const ILLEGAL = new Set(["<", ">", ":", '"', "|", "?", "*"]);

/** Windows-reserved device names, which cannot be files whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A relative path whose segments are safe on every filesystem, and which cannot escape the
 * directory it is extracted into.
 *
 * Never returns an empty string — a nameless entry is unwritable, so it gets a placeholder
 * rather than silently vanishing.
 */
/**
 * One NAME made safe — a single path segment, never a path.
 *
 * This is the outbound case, and it differs from `safeEntryPath` in exactly one way that
 * matters: a backslash is replaced, **not** treated as a separator. OSF stored `a\b.txt` as
 * one file's name; splitting it would invent a folder that never existed and silently
 * restructure the researcher's archive — the very thing this guard exists to prevent. A
 * Zenodo key, by contrast, may legitimately encode a path, so there the conservative reading
 * of `\` as a separator is correct.
 */
export function safeNameSegment(name: string): string {
  const cleaned = safeSegment(name.replace(/[/\\]/g, "-").trim());
  if (cleaned.length === 0 || cleaned === "." || cleaned === "..") return "unnamed-file";
  return cleaned;
}

/** Did sanitising change this single name? */
export function nameWasRewritten(name: string): boolean {
  return safeNameSegment(name) !== name;
}

export function safeEntryPath(path: string): string {
  const segments = path
    .split(/[/\\]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map(safeSegment)
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments.join("/") : "unnamed-file";
}

function safeSegment(segment: string): string {
  const cleaned = [...segment]
    // Spaces and hyphens are deliberately NOT in the illegal set: "PCIRR Stage 1" is a real
    // folder name and mangling it would defeat the point of preserving structure faithfully.
    .map((ch) => (ILLEGAL.has(ch) || ch.codePointAt(0)! < 32 ? "-" : ch))
    .join("")
    // A trailing dot or space is silently discarded by the Windows filesystem, which renames
    // the file without telling anyone.
    .replace(/[. ]+$/, "");
  if (cleaned.length === 0) return "";
  return RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Did sanitising change this path? Callers report every rewrite rather than hiding it. */
export function pathWasRewritten(path: string): boolean {
  return safeEntryPath(path) !== path;
}
