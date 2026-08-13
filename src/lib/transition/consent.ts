// Consent policy for the OSF Transition Toolkit.
//
// Client-safe on purpose (no `server-only`), for the same reason `terms.ts` is: the
// dialog that collects a confirmation and the route that verifies it must derive the
// expected value from ONE place. A client-supplied "the user agreed" is worthless as
// evidence, so the server always re-derives.
//
// Everything here fails CLOSED. Absent, stale, or wrongly-scoped consent is treated as
// no consent. This mirrors `canDeleteHere` in the delete feature, which defaults to
// false because getting that default wrong once leaked 28 Delete buttons to anonymous
// visitors (v1.6.0).

import { TERMS_VERSION } from "@/lib/terms";

/**
 * What a consent record attests to.
 *
 * - `toolkit` — the one-time clickwrap on entering /transition. Agreement to the
 *   transition terms as a whole. This is what unlocks the feature.
 * - `job`     — the per-run acknowledgement on a preflight. Narrower: it says "I accept
 *   these specific clauses for THIS run", and never substitutes for `toolkit`.
 * - `publish` — the typed confirmation before minting a DOI. Narrowest and strongest.
 */
export type ConsentScope = "toolkit" | "job" | "publish";

export type ConsentRecord = {
  termsVersion: string;
  scope: ConsentScope;
  acceptedAt: Date;
};

/**
 * Is this consent still current?
 *
 * Exact version match, deliberately — not "same or newer". Someone who agreed to the
 * 2026-08-03 deletion terms never saw a word about depositing participant data to a
 * third party, so their agreement cannot carry forward. Bumping TERMS_VERSION
 * re-prompts everyone, which is the point of having a version at all.
 */
export function isConsentCurrent(record: ConsentRecord): boolean {
  return record.termsVersion.length > 0 && record.termsVersion === TERMS_VERSION;
}

/** True only if the user has agreed to the CURRENT transition terms at toolkit scope. */
export function hasToolkitConsent(records: readonly ConsentRecord[]): boolean {
  return records.some((r) => r.scope === "toolkit" && isConsentCurrent(r));
}

export type PublishSubject = { fileCount: number };

/**
 * The phrase a user must type before a deposit is published.
 *
 * Publishing mints a permanent DOI and creates a public record that generally cannot be
 * withdrawn — the one irreversible act in the toolkit, and the only one that earns a
 * typed confirmation. The file count is embedded so the number has to be read before it
 * can be typed, which also makes a stale dialog fail to match.
 */
export function publishConfirmationPhrase(subject: PublishSubject): string {
  if (!Number.isInteger(subject.fileCount) || subject.fileCount < 1) {
    // Publishing an empty record is the empty-input false green wearing a different hat.
    throw new Error(`Refusing to derive a publish phrase for ${subject.fileCount} file(s)`);
  }
  const noun = subject.fileCount === 1 ? "file" : "files";
  return `publish ${subject.fileCount} ${noun} to zenodo permanently`;
}

/** Exact match, trimmed only. Paste is allowed — blocking it mostly punishes long phrases. */
export function publishConfirmationMatches(typed: string, subject: PublishSubject): boolean {
  return typed.trim() === publishConfirmationPhrase(subject).trim();
}
