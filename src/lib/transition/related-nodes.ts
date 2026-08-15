/**
 * Where a component, linked project or registration's files sit inside an export.
 *
 * Client-safe on purpose: the plan route builds the paths and the preflight has to be able
 * to describe them, so the rule lives in one place rather than being written twice and
 * drifting.
 */

export type RelatedKind = "component" | "linked" | "registration";

/** Top-level folder per kind. Registrations are kept visibly apart from live components. */
const FOLDER: Record<RelatedKind, string> = {
  component: "components",
  linked: "linked-projects",
  registration: "registrations",
};

/**
 * One path segment made safe for a ZIP entry and for a Zenodo file key.
 *
 * Zenodo stores a key verbatim and renders it as a flat filename containing slashes, so a
 * segment carrying its own `/` would invent a folder level that OSF never had. Windows'
 * reserved characters go too, because the archive has to unpack there.
 */
export function safeSegment(value: string, max = 60): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
    // A trailing dot is legal in a ZIP and illegal as a Windows folder name.
    .replace(/\.+$/, "");
  return cleaned.length > 0 ? cleaned : "untitled";
}

/**
 * The prefix every file from a related node is stored under, e.g.
 * `components/ytpuq-Analysis/`.
 *
 * The guid comes FIRST and is never truncated: two components can share a title, and a
 * collision would silently merge two people's folders into one. The guid is also what a
 * reader needs to find the original on OSF.
 */
export function relatedNodePrefix(kind: RelatedKind, guid: string, title: string): string {
  return `${FOLDER[kind]}/${guid}-${safeSegment(title)}/`;
}
