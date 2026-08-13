/**
 * What should this researcher actually DO with this project?
 *
 * The inventory is only useful if it answers that. A table of 300 rows that merely
 * reports sizes leaves the hard part undone.
 *
 * The strong default is **do nothing**. COS keeps public projects online, read-only, at
 * the same URLs and DOIs, indefinitely. Mirroring a finished public project to Zenodo
 * mints a second DOI for identical content, splits its citation record, and loads a
 * free CERN-funded service for no scholarly gain. A tool that made "migrate everything"
 * the obvious click would do real harm at scale, so the recommendation for public work
 * is to leave it alone unless the researcher has a reason of their own.
 *
 * Pure and dependency-free: no network, no clock of its own — `now` is always passed in.
 */

import type { StorageUsage } from "./storage-usage";

/** Modified within this window counts as active work rather than a finished record. */
export const ACTIVE_WITHIN_DAYS = 180;

/** Above this, a Zenodo deposit needs packaging rather than per-file upload. */
export const ZENODO_MAX_FILES = 100;

/** Zenodo's default per-record ceiling. */
export const ZENODO_MAX_BYTES = 50 * 1024 * 1024 * 1024;

export type Action = "leave" | "back_up" | "migrate" | "review";

export type ProjectFacts = {
  guid: string;
  title: string;
  public: boolean;
  /** Null when we have not looked yet — NOT the same as "has no DOI". */
  hasDoi: boolean | null;
  /** ISO timestamp from OSF. */
  dateModified: string;
  storage: StorageUsage;
  /** Null when the file count has not been established. */
  fileCount: number | null;
  /**
   * Add-on providers connected to this node, e.g. ["dropbox", "github"].
   * Null means the lookup failed — NOT that there are none.
   */
  addonProviders: string[] | null;
  wikiCount: number | null;
  /** Registrations are unaffected by the transition and are never actionable here. */
  isRegistration?: boolean;
};

export type Recommendation = {
  action: Action;
  /** One-line summary shown in the table. */
  headline: string;
  /** Why — shown on expand. Every entry is a fact about THIS project. */
  reasons: string[];
  /** Things needing human attention, independent of the primary action. */
  warnings: string[];
};

function daysSince(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * Warnings are computed independently of the action, because they are about
 * *feasibility*, not about what to do. A public project nobody needs to move can still
 * have an add-on whose contents cannot be verified.
 */
function computeWarnings(facts: ProjectFacts): string[] {
  const warnings: string[] = [];

  if (facts.addonProviders === null) {
    // Silence here would be a claim of absence. Say we do not know.
    warnings.push(
      "Third-party storage could not be checked — BetterOSF could not confirm whether this project links " +
        "to Dropbox, Google Drive, S3 or similar. Check on OSF before assuming everything is OSF-hosted.",
    );
  } else if (facts.addonProviders.length > 0) {
    warnings.push(
      `Uses third-party storage (${facts.addonProviders.join(", ")}). Those files are not hosted by OSF, ` +
        `usually carry no checksum, and can only be exported as “unverifiable”. A revoked connection may ` +
        `become unfixable once project settings freeze.`,
    );
  }

  if (!facts.storage.known) {
    warnings.push("Size unknown — OSF only reports storage size to project contributors.");
  } else if (facts.storage.bytes > ZENODO_MAX_BYTES) {
    warnings.push(
      `Larger than Zenodo's ${Math.round(ZENODO_MAX_BYTES / 1024 ** 3)} GB per-record limit — a deposit ` +
        `would be split across several linked records.`,
    );
  }

  if (facts.fileCount !== null && facts.fileCount > ZENODO_MAX_FILES) {
    warnings.push(
      `${facts.fileCount} files exceeds Zenodo's ${ZENODO_MAX_FILES}-file limit per record — folders would ` +
        `be packaged into archives rather than uploaded individually.`,
    );
  }

  return warnings;
}

export function recommend(facts: ProjectFacts, now: Date): Recommendation {
  const warnings = computeWarnings(facts);

  if (facts.isRegistration) {
    return {
      action: "leave",
      headline: "Nothing to do — registrations are not affected",
      reasons: [
        "OSF Registries continues to operate. Registrations stay where they are, and this transition does not touch them.",
      ],
      warnings,
    };
  }

  const age = daysSince(facts.dateModified, now);
  const active = age !== null && age <= ACTIVE_WITHIN_DAYS;

  if (facts.public) {
    const reasons = [
      "Public projects stay on OSF as a read-only public record, at the same URL, indefinitely.",
    ];
    if (facts.hasDoi === true) {
      reasons.push(
        "It already has a DOI that will keep resolving. Depositing a copy elsewhere would mint a second DOI for the same work and split its citation record.",
      );
    } else if (facts.hasDoi === null) {
      reasons.push("Whether it has a DOI has not been checked yet.");
    }
    if (active) {
      reasons.push(
        `Modified ${age} days ago. If you are still working on it, you will need a new home for that work before 2027-02-19 — but the existing record can stay put either way.`,
      );
    }
    return {
      action: "leave",
      headline: active ? "Leave it — but move ongoing work elsewhere" : "Leave it where it is",
      reasons,
      warnings,
    };
  }

  // Private from here down.
  const privateReason =
    "Private projects go read-only on 2027-02-19, and COS has said it anticipates removing private projects later, with 12 months' notice.";

  if (active) {
    return {
      action: "migrate",
      headline: "Move it — private and still active",
      reasons: [
        privateReason,
        `Modified ${age} days ago, so this looks like live work that needs somewhere it can keep changing.`,
      ],
      warnings,
    };
  }

  return {
    action: "back_up",
    headline: "Take a verified copy",
    reasons: [
      privateReason,
      age === null
        ? "Last modified date unavailable."
        : `Last modified ${age} days ago, so it reads as finished — a verified local copy is the cheap insurance.`,
      "Making it public instead would keep it on OSF permanently, if the content can be public.",
    ],
    warnings,
  };
}

/** Short label for filters and counts. */
export function actionLabel(action: Action): string {
  switch (action) {
    case "leave":
      return "Leave it";
    case "back_up":
      return "Back it up";
    case "migrate":
      return "Move it";
    case "review":
      return "Needs a look";
  }
}
