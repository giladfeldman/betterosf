/**
 * How a whole-tree ZIP names its folders — **one definition, two producers.**
 *
 * BetterOSF assembles that archive two ways: server-side in `/api/zip/[guid]`, and in the
 * browser from `/api/zip/[guid]/manifest`. Both must produce the SAME archive, because the
 * browser path silently falls back to the server one and a researcher is never told which
 * they got.
 *
 * That is a duplication invariant (defect class 10): two things that must agree, with
 * nothing checking that they do. When the browser path was written these helpers were copied
 * rather than shared, and the copies had already drifted by the end of the same session — the
 * errors file carried a different header on each side. Hence one module, imported by both,
 * rather than a test pinning two copies: a pointer cannot drift, a pinned pair can still be
 * jointly wrong and costs a maintainer every edit.
 */

/** A node title made safe as a single ZIP folder segment. */
export function safeFolderName(title: string): string {
  // Path separators would invent folder levels the project never had.
  return title.replace(/[\\/]/g, "_").slice(0, 80).trim() || "untitled";
}

/**
 * The folder a node's provider archives live under.
 *
 * The root sits at the archive root; everything else is nested under it and carries its
 * guid, because two components can share a title and a collision would merge them. Linked
 * projects are prefixed so they are never mistaken for the author's own work.
 */
export function nodeFolder(input: {
  rootTitle: string;
  guid: string;
  title: string;
  linked: boolean;
  isRoot: boolean;
}): string {
  if (input.isRoot) return input.rootTitle;
  return `${input.rootTitle}/${input.linked ? "linked_" : ""}${safeFolderName(input.title)}_${input.guid}`;
}

/** The name of the partial-failure report written inside the archive. */
export function errorsFileName(rootTitle: string): string {
  return `${rootTitle}/_BETTEROSF_ERRORS.txt`;
}

/**
 * The partial-failure report's contents.
 *
 * Byte-identical from both producers on purpose: the claim that a researcher cannot tell
 * which path built their archive is only true if the artefacts actually match.
 */
export function errorsFileBody(input: {
  guid: string;
  generatedAt: string;
  problems: string[];
}): string {
  return (
    `BetterOSF whole-tree ZIP — partial failures\n` +
    `Generated for OSF project ${input.guid} at ${input.generatedAt}\n\n` +
    input.problems.map((p) => `- ${p}`).join("\n") +
    "\n"
  );
}
