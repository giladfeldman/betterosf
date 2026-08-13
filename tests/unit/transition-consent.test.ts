// Consent policy for the OSF Transition Toolkit.
//
// The gate has to fail CLOSED. Every test here is a way the gate could wrongly open:
// no consent at all, consent to an older version of the terms, consent recorded for a
// different scope, or a publish confirmation the client merely claims was typed.
//
// The delete feature learned this the hard way (v1.6.0): an affordance gated on the
// wrong signal leaked 28 Delete buttons to anonymous visitors. Gates default to denied.

import { describe, it, expect } from "vitest";
import { TERMS_VERSION } from "@/lib/terms";
import {
  hasToolkitConsent,
  isConsentCurrent,
  publishConfirmationPhrase,
  publishConfirmationMatches,
  type ConsentRecord,
} from "@/lib/transition/consent";

const at = new Date("2026-08-13T00:00:00Z");

function rec(over: Partial<ConsentRecord> = {}): ConsentRecord {
  return { termsVersion: TERMS_VERSION, scope: "toolkit", acceptedAt: at, ...over };
}

describe("isConsentCurrent", () => {
  it("accepts a record matching the current terms version", () => {
    expect(isConsentCurrent(rec())).toBe(true);
  });

  it("rejects consent given under an older version of the terms", () => {
    // The whole reason TERMS_VERSION exists. Someone who agreed to the deletion-only
    // terms never saw a word about depositing participant data to a third party.
    expect(isConsentCurrent(rec({ termsVersion: "2026-08-03" }))).toBe(false);
  });

  it("rejects a record with an empty or malformed version", () => {
    expect(isConsentCurrent(rec({ termsVersion: "" }))).toBe(false);
  });
});

describe("hasToolkitConsent", () => {
  it("is false with no records at all — the gate defaults to denied", () => {
    expect(hasToolkitConsent([])).toBe(false);
  });

  it("is true when a current toolkit consent exists", () => {
    expect(hasToolkitConsent([rec()])).toBe(true);
  });

  it("is false when the only current consent is for a narrower scope", () => {
    // A per-run acknowledgement is not agreement to the toolkit terms as a whole.
    expect(hasToolkitConsent([rec({ scope: "job" }), rec({ scope: "publish" })])).toBe(false);
  });

  it("is false when the only toolkit consent is stale", () => {
    expect(hasToolkitConsent([rec({ termsVersion: "2026-08-03" })])).toBe(false);
  });

  it("finds a valid consent among a mix of stale and out-of-scope records", () => {
    expect(
      hasToolkitConsent([
        rec({ termsVersion: "2026-08-03" }),
        rec({ scope: "job" }),
        rec(),
      ]),
    ).toBe(true);
  });
});

describe("publish confirmation phrase", () => {
  // Publishing mints a permanent DOI. The phrase embeds the real file count so the
  // number has to be read before it can be typed — same reasoning as the delete phrase.
  it("embeds the file count", () => {
    expect(publishConfirmationPhrase({ fileCount: 42 })).toContain("42");
  });

  it("names the destination so it cannot be confused with a delete confirmation", () => {
    expect(publishConfirmationPhrase({ fileCount: 1 }).toLowerCase()).toContain("zenodo");
  });

  it("is singular for one file", () => {
    expect(publishConfirmationPhrase({ fileCount: 1 })).toContain("1 file ");
  });

  it("is plural for several", () => {
    expect(publishConfirmationPhrase({ fileCount: 3 })).toContain("3 files ");
  });

  it("matches only the exact phrase, trimmed", () => {
    const subject = { fileCount: 7 };
    expect(publishConfirmationMatches(`  ${publishConfirmationPhrase(subject)}  `, subject)).toBe(
      true,
    );
    expect(publishConfirmationMatches("publish", subject)).toBe(false);
    expect(publishConfirmationMatches("", subject)).toBe(false);
  });

  it("does not match a phrase derived from a DIFFERENT file count", () => {
    // Guards the case that makes the count meaningful: a stale dialog whose count no
    // longer describes what is about to be published.
    expect(publishConfirmationMatches(publishConfirmationPhrase({ fileCount: 7 }), { fileCount: 8 }))
      .toBe(false);
  });

  it("refuses to derive a phrase for zero files", () => {
    // Publishing an empty record is the empty-input false green in another costume.
    expect(() => publishConfirmationPhrase({ fileCount: 0 })).toThrow(/file/i);
  });
});
