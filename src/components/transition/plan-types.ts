import type { ContributorView } from "@/lib/osf/contributors";

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
    path: string;
    size: number;
    downloadUrl: string;
    md5: string | null;
    sha256: string | null;
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
  limits: { maxFiles: number; maxDepth: number };
  unverifiableCount: number;
};
