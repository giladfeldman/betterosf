// Terms + confirmation-phrase derivation, for BOTH the deletion feature and the OSF
// Transition Toolkit.
//
// Deliberately client-safe (no `server-only`): a dialog renders the same clauses it asks
// the user to sign, and the server route re-derives the expected phrase. Having ONE
// source for both is the point — a terms page that drifts from what was actually agreed
// to is worse than no terms page.
//
// Clauses carry a stable `id`. Dialogs select their inline subset BY ID, never by
// heading text, so rewording a heading cannot silently empty a clickwrap — which would
// record consent to terms the user was never shown. `clausesByIds` throws on an unknown
// id rather than dropping it; `tests/unit/terms.test.ts` pins that.

/**
 * Bump when the substance of the terms changes. Recorded with every consent so we can
 * later show which version a given action was agreed under.
 *
 * 2026-08-03 — initial deletion terms.
 * 2026-08-13 — added TRANSITION_CLAUSES for the OSF Transition Toolkit.
 */
export const TERMS_VERSION = "2026-08-13";

export type TermsClause = { id: string; heading: string; body: string };

/**
 * Clauses that apply to BetterOSF as a whole.
 *
 * NOT LEGAL ADVICE. Drafted to be reviewable by counsel, not to substitute for review.
 * Two clauses are load-bearing and must not be "strengthened" by deleting them:
 * `liability-carveout` and `severability`. An exemption clause that purports to exclude
 * everything risks being struck down IN ITS ENTIRETY under the Hong Kong Control of
 * Exemption Clauses Ordinance (Cap. 71) reasonableness test — taking the enforceable
 * protection with it. A clean, survivable clause protects the operator better than a
 * maximalist one. `LOAD_BEARING_CLAUSE_IDS` + a test guard the pair.
 */
export const GENERAL_CLAUSES: TermsClause[] = [
  {
    id: "as-is",
    heading: "Service provided “as is”",
    body:
      "BetterOSF is provided free of charge, on an “as is” and “as available” basis, without warranty of any kind, express or implied, including without limitation any warranty of merchantability, fitness for a particular purpose, accuracy, availability, or non-infringement, to the maximum extent permitted by applicable law.",
  },
  {
    id: "limitation-of-liability",
    heading: "Limitation of liability",
    body:
      "To the maximum extent permitted by law, the operator of BetterOSF shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of data, research data, files, work product, publications, funding, academic standing, reputation, or opportunity, arising out of or relating to your use of BetterOSF, whether in contract, tort (including negligence), or otherwise, and whether or not the possibility of such loss was advised.",
  },
  {
    id: "aggregate-cap",
    heading: "Aggregate cap on liability",
    body:
      "To the maximum extent permitted by law, the operator’s total aggregate liability arising out of or relating to BetterOSF shall not exceed the greater of (a) the total amount you paid to use BetterOSF in the twelve months preceding the claim, which for a free service is HK$0, or (b) HK$100.",
  },
  {
    id: "no-custodial-relationship",
    heading: "No custodial or professional relationship",
    body:
      "BetterOSF is an independent, third-party client for the public OSF API. It is not affiliated with, endorsed by, sponsored by, or operated by the Center for Open Science or OSF. Using BetterOSF creates no data-custody, archival, preservation, fiduciary, or professional relationship of any kind.",
  },
  {
    id: "liability-carveout",
    heading: "Exclusions that do not apply",
    body:
      "Nothing in these terms excludes or limits liability for gross negligence, wilful misconduct, fraud or fraudulent misrepresentation, death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded or limited.",
  },
  {
    id: "severability",
    heading: "Severability",
    body:
      "If any provision of these terms is held to be invalid, unlawful, or unenforceable, that provision shall be severed or read down to the minimum extent necessary, and the remaining provisions shall continue in full force and effect.",
  },
  {
    id: "governing-law",
    heading: "Governing law",
    body:
      "These terms are governed by the laws of the Hong Kong Special Administrative Region, and you submit to the non-exclusive jurisdiction of its courts. If you are a consumer resident elsewhere, you may retain the benefit of mandatory protections of your local law.",
  },
  {
    id: "typed-confirmation-signature",
    heading: "Your typed confirmation is your signature",
    body:
      "Where BetterOSF asks you to type a confirmation phrase, doing so constitutes your electronic signature to these terms and your acknowledgement that you have read and understood them, that the action is irreversible, and that you accept all risk arising from it. A record of your confirmation — the phrase you typed, the terms version, the time, and the number of items — is retained as evidence of that agreement.",
  },
];

/** Clauses specific to deleting files from OSF. Unchanged in substance since 2026-08-03. */
export const DELETE_CLAUSES: TermsClause[] = [
  {
    id: "delete-your-responsibility",
    heading: "You are solely responsible for deletions",
    body:
      "You alone choose which files and folders to delete, and you alone decide to proceed. You are solely responsible for the consequences of any deletion you carry out using BetterOSF. Use of the deletion feature is entirely at your own risk.",
  },
  {
    id: "delete-permanent",
    heading: "Deletion is permanent and cannot be reversed",
    body:
      "Files deleted through BetterOSF are removed from OSF by OSF. OSF provides no trash, recycle bin, or restore path for deleted files. BetterOSF has no ability to recover deleted files from OSF under any circumstances. Once you confirm, the deletion cannot be undone by BetterOSF or by OSF.",
  },
  {
    id: "delete-backups-not-guaranteed",
    heading: "Backups are a convenience, not a guarantee",
    body:
      "Any backup BetterOSF creates is stored locally in your own browser and is a convenience only. Browser storage may be evicted by the browser at any time without notice, and may be lost if you clear site data, use private browsing, lose or replace your device, or run operating-system cleanup tools. BetterOSF is not a backup, archival, or preservation service, and does not warrant that any backup is complete, readable, or restorable. You remain responsible for keeping your own independent copies of anything you value. Restoring a backup uploads a new copy: it does not restore original file identifiers, version history, or links.",
  },
  {
    id: "delete-authority",
    heading: "Your authority to delete",
    body:
      "You warrant that you hold all necessary rights and authorisations to delete the data you select, including any permission required from co-authors, collaborators, supervisors, institutions, funders, ethics or IRB bodies, journals, and any applicable data-management plan, grant condition, or record-retention obligation. You agree to indemnify and hold harmless the operator against any third-party claim arising from data you delete using BetterOSF.",
  },
];

/**
 * Clauses specific to the OSF Transition Toolkit — exporting a project and depositing it
 * into a third-party repository such as Zenodo.
 *
 * The risk being addressed is different from deletion's. Deletion destroys data in one
 * irreversible step. Migration can fail SILENTLY: an export that looks complete but is
 * not, a metadata mapping that quietly coerces a licence, or a public deposit of
 * participant data that breaches the consent under which it was collected. These clauses
 * exist to make clear that BetterOSF reports what it observed and the researcher remains
 * the one who decides and verifies.
 */
export const TRANSITION_CLAUSES: TermsClause[] = [
  {
    id: "transition-report-not-warranty",
    heading: "Verification reports are evidence, not a warranty",
    body:
      "Checksum comparisons, manifests, and reconciliation verdicts produced by BetterOSF record only what BetterOSF observed during a single run, using metadata supplied by OSF and the destination repository. They are not a guarantee that an export or deposit is complete, faithful, readable, durable, or fit for any purpose, and BetterOSF does not warrant that any file was transferred correctly. You must independently verify any export or deposit before relying on it.",
  },
  {
    id: "transition-never-deletes",
    heading: "BetterOSF does not delete anything when you export or transfer",
    body:
      "Exporting or transferring a project does not remove anything from OSF: BetterOSF does not delete, alter, or move your original data as part of these features, and will not offer to. Deciding to remove data from OSF, or from anywhere else, is a separate decision that is yours alone. You must independently confirm that your data is intact and complete at its destination before you delete it from any other location. Do not treat a BetterOSF report as sufficient grounds to delete anything.",
  },
  {
    id: "transition-third-party-destinations",
    heading: "Destination repositories are outside our control",
    body:
      "Zenodo is operated by CERN, and any other destination repository is operated by its own provider, each under its own terms of use, quotas, curation policies, retention rules, and availability. BetterOSF is not affiliated with, endorsed by, sponsored by, or acting as agent for Zenodo, CERN, the Center for Open Science, or OSF. Once data leaves for a destination repository, BetterOSF has no control over, and accepts no responsibility for, what happens to it. Your deposit is governed by that repository’s terms, which you are responsible for reading and complying with.",
  },
  {
    id: "transition-publication-irreversible",
    heading: "Publishing a deposit is irreversible",
    body:
      "Publishing a record mints a permanent Digital Object Identifier (DOI) and creates a public record that generally cannot be fully withdrawn, even if it is later hidden or tombstoned. Where the source project already has a DOI, publishing creates a second, separate identifier for the same content, which may fragment the citation record for your work. You alone decide whether to publish, you are responsible for reviewing the record before you do, and you accept the consequences of publication.",
  },
  {
    id: "transition-authority-to-deposit",
    heading: "Your authority to deposit, and participant data",
    body:
      "You warrant that you hold all rights and permissions necessary to copy the selected data to the destination you choose, including any permission required from co-authors, collaborators, supervisors, institutions, funders, ethics or IRB bodies, journals, licensors, and any applicable data-management plan, grant condition, licence, or record-retention obligation. You are solely responsible for determining whether the data may lawfully be transferred or made public. Depositing data collected from human participants may breach the consent under which it was collected, or applicable data-protection law including the GDPR, and BetterOSF performs no check for personal, identifiable, sensitive, or restricted data. You agree to indemnify and hold harmless the operator against any third-party claim arising from data you export, transfer, or publish using BetterOSF.",
  },
  {
    id: "transition-metadata-lossy",
    heading: "Metadata mapping is approximate and lossy",
    body:
      "Descriptive metadata is translated between systems whose fields do not correspond one to one. Some values have no equivalent at the destination and are omitted or recorded only in an accompanying file; others are approximated. BetterOSF shows which values mapped directly and which were approximated, but does not warrant that any mapping is correct or appropriate for your work. You are responsible for reviewing all metadata, including resource type, licence, dates, and creator details, before publishing.",
  },
  {
    id: "transition-runs-may-fail",
    heading: "Long-running transfers may fail or be interrupted",
    body:
      "Exports and transfers depend on your browser, device, storage, and network, and on services operated by third parties. Browser storage may be evicted without notice; a device may sleep; a network may drop; access tokens and upload sessions expire; and third parties may rate-limit, change, or withdraw their interfaces at any time. BetterOSF does not warrant that any run will start, continue, resume, complete, or verify, and is not liable for any consequence of an interrupted or incomplete run, including any deadline you fail to meet.",
  },
  {
    id: "transition-dates-not-advice",
    heading: "Transition dates are reported, not advised",
    body:
      "Any dates, deadlines, or descriptions of OSF’s plans shown in BetterOSF are reported in good faith from public announcements by the Center for Open Science and may be incomplete, superseded, or changed without notice. They are provided for information only and are not advice of any kind, legal, archival, or otherwise. Any recommendation BetterOSF displays about what to do with a project is a suggestion generated automatically from limited metadata, not professional judgement. You are responsible for confirming the current position with OSF and for meeting any deadline that applies to you.",
  },
];

/**
 * The operative clauses, rendered in full at /terms.
 *
 * Order is deliberate: general terms first, then the feature-specific groups, so a
 * reader meets the limitation of liability before the feature that relies on it.
 */
export const TERMS_CLAUSES: TermsClause[] = [
  ...GENERAL_CLAUSES,
  ...DELETE_CLAUSES,
  ...TRANSITION_CLAUSES,
];

/**
 * The two clauses that keep the exemption survivable under Cap. 71. Guarded by a test
 * so a future "let's tighten the terms" edit cannot quietly remove them.
 */
export const LOAD_BEARING_CLAUSE_IDS = ["liability-carveout", "severability"] as const;

/** The subset shown inside the delete dialog. Keep it short enough to actually be read. */
export const DIALOG_CLAUSE_IDS = [
  "delete-permanent",
  "delete-your-responsibility",
  "delete-backups-not-guaranteed",
  "limitation-of-liability",
  "typed-confirmation-signature",
];

/** The subset shown inline on the transition clickwrap and every run preflight. */
export const TRANSITION_DIALOG_CLAUSE_IDS = [
  "transition-report-not-warranty",
  "transition-never-deletes",
  "transition-authority-to-deposit",
  "transition-runs-may-fail",
  "limitation-of-liability",
];

/**
 * Resolve clause ids to clauses, in the order requested.
 *
 * Throws on an unknown id. That is the whole point: a dialog that silently rendered
 * four of five clauses would still collect a confirmation, producing a consent record
 * for terms the user never saw. Failing loudly at render is the safe direction.
 */
export function clausesByIds(ids: readonly string[]): TermsClause[] {
  return ids.map((id) => {
    const clause = TERMS_CLAUSES.find((c) => c.id === id);
    if (!clause) throw new Error(`Unknown terms clause id: ${id}`);
    return clause;
  });
}

export type ConfirmationSubject =
  | { mode: "file"; name: string }
  | { mode: "folder"; name: string; itemCount: number }
  | { mode: "bulk"; itemCount: number };

/**
 * Derive the exact phrase the user must type.
 *
 * The delete route re-derives this independently and rejects a mismatch, so the client
 * gate is a UX affordance and the server check is the real one. A consent record that
 * merely echoed a client-supplied "yes they typed it" would be worthless as evidence.
 *
 * Bulk and folder phrases embed the real item count so the user has to read the number
 * before they can type it.
 */
export function confirmationPhrase(subject: ConfirmationSubject): string {
  if (subject.mode === "file") return subject.name;
  if (subject.mode === "folder") {
    return `delete ${subject.name} and ${subject.itemCount} ${plural(subject.itemCount)} permanently`;
  }
  return `delete ${subject.itemCount} ${plural(subject.itemCount)} permanently`;
}

function plural(n: number): string {
  return n === 1 ? "item" : "items";
}

/** Exact match, trimmed only. Paste is allowed — blocking it mostly punishes long filenames. */
export function confirmationMatches(typed: string, subject: ConfirmationSubject): boolean {
  return typed.trim() === confirmationPhrase(subject).trim();
}

/** Folder and bulk deletions additionally require the acknowledgement checkbox. */
export function requiresAcknowledgement(subject: ConfirmationSubject): boolean {
  return subject.mode !== "file";
}
