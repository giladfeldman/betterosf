import type { ContributorView } from "@/lib/osf/contributors";
import type { RelatedKind } from "@/lib/transition/related-nodes";

/**
 * The shape `/api/transition/plan/[guid]` returns.
 *
 * Shared by the export runner and the Zenodo transfer panel so the two cannot drift apart
 * — a duplicated response type is a place where one consumer quietly stops reading a field
 * the other depends on.
 */
export type PlanResponse = {
  guid: string;
  title: string;
  description: string;
  osfUrl: string;
  dateCreated: string;
  dateModified: string;
  tags: string[];
  /** OSF's category ("project", "analysis", …). Recorded, never mapped to a Zenodo type. */
  category: string;
  doi: string | null;
  addonProviders: string[] | null;
  files: {
    osfFileId: string;
    /** The name used in the archive and as the Zenodo key — safe on every filesystem. */
    path: string;
    /**
     * OSF's own name, present ONLY when it had to be rewritten to be writable.
     *
     * OSF accepts names a filesystem cannot take — `a\b.txt`, `CON` and `we<ird>.txt` were
     * all stored verbatim when measured. Absent means the name was used unchanged.
     */
    osfPath?: string;
    size: number;
    downloadUrl: string;
    md5: string | null;
    sha256: string | null;
    /** The node the file lives on: the root guid, or a component/registration's. */
    sourceGuid: string;
  }[];
  wikis: { id: string; name: string; size: number }[] | null;
  contributors: ContributorView[] | null;
  /**
   * `null` = OSF asserts no licence. Absent + `licenseLookupFailed` = we could not find
   * out, which is a different thing and must never be shown as "no licence".
   */
  license?: { id: string; name: string; text: string | null; copyrightHolders: string[]; year: string | null } | null;
  licenseLookupFailed?: boolean;
  truncated: boolean;
  limits: { maxFiles: number; maxDepth: number; maxRelatedNodes: number };
  unverifiableCount: number;

  /**
   * Everything hanging off this project, and what was actually walked.
   *
   * `components`, `linkedProjects` and `registrations` are `null` when the LOOKUP FAILED —
   * which is not the same as "there are none", and the UI must never render the second in
   * place of the first. An export that quietly omitted a component nobody was told about
   * would satisfy `reconcile()` while being exactly the incomplete copy this toolkit
   * exists to prevent.
   */
  components: { guid: string; title: string }[] | null;
  linkedProjects: { guid: string; title: string }[] | null;
  registrations: { guid: string; title: string; dateRegistered: string; public: boolean }[] | null;
  /** The related nodes whose files are IN `files`, with the prefix they were stored under. */
  included: {
    guid: string;
    title: string;
    kind: RelatedKind;
    prefix: string;
    fileCount: number;
    /** Non-null when this node was asked for and could not be read. Never silent. */
    error: string | null;
  }[];
  /** How many of `files` came from the root project itself. */
  rootFileCount: number;
  /** Asked for, not walked, because a cap was hit. Reported, never dropped. */
  skippedNodes: string[];
  /** Asked for and not on this project at all. */
  unknownNodes: string[];
};
