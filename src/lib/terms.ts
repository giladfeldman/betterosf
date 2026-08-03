// Deletion terms + confirmation-phrase derivation.
//
// Deliberately client-safe (no `server-only`): the dialog renders the same clauses it
// asks the user to sign, and the delete route re-derives the expected phrase. Having ONE
// source for both is the point — a terms page that drifts from what was actually agreed
// to is worse than no terms page.

/**
 * Bump when the substance of the terms changes. Recorded with every consent so we can
 * later show which version a given deletion was agreed under.
 */
export const TERMS_VERSION = "2026-08-03";

export type TermsClause = { heading: string; body: string };

/**
 * The operative clauses. Rendered in full at /terms, and the starred subset is shown
 * inside the delete dialog itself — a clickwrap the user cannot miss by not following
 * a link.
 *
 * NOT LEGAL ADVICE. Drafted to be reviewable by counsel, not to substitute for review.
 * Two clauses are load-bearing and must not be "strengthened" by deleting them:
 * `liability-carveout` and `severability`. An exemption clause that purports to exclude
 * everything risks being struck down IN ITS ENTIRETY under the Hong Kong Control of
 * Exemption Clauses Ordinance (Cap. 71) reasonableness test — taking the enforceable
 * protection with it. A clean, survivable clause protects the operator better than a
 * maximalist one.
 */
export const TERMS_CLAUSES: TermsClause[] = [
  {
    heading: "Service provided “as is”",
    body:
      "BetterOSF is provided free of charge, on an “as is” and “as available” basis, without warranty of any kind, express or implied, including without limitation any warranty of merchantability, fitness for a particular purpose, accuracy, availability, or non-infringement, to the maximum extent permitted by applicable law.",
  },
  {
    heading: "You are solely responsible for deletions",
    body:
      "You alone choose which files and folders to delete, and you alone decide to proceed. You are solely responsible for the consequences of any deletion you carry out using BetterOSF. Use of the deletion feature is entirely at your own risk.",
  },
  {
    heading: "Deletion is permanent and cannot be reversed",
    body:
      "Files deleted through BetterOSF are removed from OSF by OSF. OSF provides no trash, recycle bin, or restore path for deleted files. BetterOSF has no ability to recover deleted files from OSF under any circumstances. Once you confirm, the deletion cannot be undone by BetterOSF or by OSF.",
  },
  {
    heading: "Backups are a convenience, not a guarantee",
    body:
      "Any backup BetterOSF creates is stored locally in your own browser and is a convenience only. Browser storage may be evicted by the browser at any time without notice, and may be lost if you clear site data, use private browsing, lose or replace your device, or run operating-system cleanup tools. BetterOSF is not a backup, archival, or preservation service, and does not warrant that any backup is complete, readable, or restorable. You remain responsible for keeping your own independent copies of anything you value. Restoring a backup uploads a new copy: it does not restore original file identifiers, version history, or links.",
  },
  {
    heading: "Limitation of liability",
    body:
      "To the maximum extent permitted by law, the operator of BetterOSF shall not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of data, research data, files, work product, publications, funding, academic standing, reputation, or opportunity, arising out of or relating to your use of BetterOSF, whether in contract, tort (including negligence), or otherwise, and whether or not the possibility of such loss was advised.",
  },
  {
    heading: "Aggregate cap on liability",
    body:
      "To the maximum extent permitted by law, the operator’s total aggregate liability arising out of or relating to BetterOSF shall not exceed the greater of (a) the total amount you paid to use BetterOSF in the twelve months preceding the claim, which for a free service is HK$0, or (b) HK$100.",
  },
  {
    heading: "No custodial or professional relationship",
    body:
      "BetterOSF is an independent, third-party client for the public OSF API. It is not affiliated with, endorsed by, sponsored by, or operated by the Center for Open Science or OSF. Using BetterOSF creates no data-custody, archival, preservation, fiduciary, or professional relationship of any kind.",
  },
  {
    heading: "Your authority to delete",
    body:
      "You warrant that you hold all necessary rights and authorisations to delete the data you select, including any permission required from co-authors, collaborators, supervisors, institutions, funders, ethics or IRB bodies, journals, and any applicable data-management plan, grant condition, or record-retention obligation. You agree to indemnify and hold harmless the operator against any third-party claim arising from data you delete using BetterOSF.",
  },
  {
    heading: "Exclusions that do not apply",
    body:
      "Nothing in these terms excludes or limits liability for gross negligence, wilful misconduct, fraud or fraudulent misrepresentation, death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded or limited.",
  },
  {
    heading: "Severability",
    body:
      "If any provision of these terms is held to be invalid, unlawful, or unenforceable, that provision shall be severed or read down to the minimum extent necessary, and the remaining provisions shall continue in full force and effect.",
  },
  {
    heading: "Governing law",
    body:
      "These terms are governed by the laws of the Hong Kong Special Administrative Region, and you submit to the non-exclusive jurisdiction of its courts. If you are a consumer resident elsewhere, you may retain the benefit of mandatory protections of your local law.",
  },
  {
    heading: "Your typed confirmation is your signature",
    body:
      "Typing the requested confirmation phrase constitutes your electronic signature to these terms and your acknowledgement that you have read and understood them, that the deletion is permanent, and that you accept all risk of data loss. A record of your confirmation — the phrase you typed, the terms version, the time, and the number of items — is retained as evidence of that agreement.",
  },
];

/** The subset shown inside the delete dialog. Keep it short enough to actually be read. */
export const DIALOG_CLAUSE_HEADINGS = [
  "Deletion is permanent and cannot be reversed",
  "You are solely responsible for deletions",
  "Backups are a convenience, not a guarantee",
  "Limitation of liability",
  "Your typed confirmation is your signature",
];

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
