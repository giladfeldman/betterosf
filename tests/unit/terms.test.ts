// Invariants for the terms machinery.
//
// `src/lib/terms.ts` is the single source rendered at /terms, shown inline inside the
// delete dialog, and re-derived server-side by the delete route. Nothing tested it until
// 2026-08-13, when TRANSITION_CLAUSES were added for the OSF Transition Toolkit and the
// flat clause list was split into groups.
//
// The failure this file exists to prevent: a clause is renamed or moved between groups,
// the starred subset silently stops matching anything, and the clickwrap renders EMPTY
// while still recording consent. That is a consent record for terms the user was never
// shown — worse than no clickwrap, because it manufactures evidence.

import { describe, it, expect } from "vitest";
import {
  TERMS_VERSION,
  TERMS_CLAUSES,
  GENERAL_CLAUSES,
  DELETE_CLAUSES,
  TRANSITION_CLAUSES,
  DIALOG_CLAUSE_IDS,
  TRANSITION_DIALOG_CLAUSE_IDS,
  clausesByIds,
  LOAD_BEARING_CLAUSE_IDS,
} from "@/lib/terms";

describe("terms version", () => {
  it("is an ISO date so consent records sort and compare", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("clause groups", () => {
  it("TERMS_CLAUSES is exactly the three groups, in order, with nothing lost", () => {
    expect(TERMS_CLAUSES).toEqual([...GENERAL_CLAUSES, ...DELETE_CLAUSES, ...TRANSITION_CLAUSES]);
  });

  it("every clause has a stable id, a heading, and a body", () => {
    for (const clause of TERMS_CLAUSES) {
      expect(clause.id, `clause "${clause.heading}" needs an id`).toMatch(/^[a-z0-9-]+$/);
      expect(clause.heading.trim().length).toBeGreaterThan(0);
      expect(clause.body.trim().length).toBeGreaterThan(20);
    }
  });

  it("ids are unique — they are lookup keys, not decoration", () => {
    const ids = TERMS_CLAUSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("headings are unique — they are React keys at /terms", () => {
    const headings = TERMS_CLAUSES.map((c) => c.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("has a non-empty transition group", () => {
    expect(TRANSITION_CLAUSES.length).toBeGreaterThan(0);
  });
});

describe("starred subsets shown inline in dialogs", () => {
  // The whole point of the starred subset is that the user cannot miss it by not
  // following a link. An id that resolves to nothing renders nothing.
  it("every delete-dialog id resolves to a real clause", () => {
    expect(clausesByIds(DIALOG_CLAUSE_IDS)).toHaveLength(DIALOG_CLAUSE_IDS.length);
  });

  it("every transition-dialog id resolves to a real clause", () => {
    expect(clausesByIds(TRANSITION_DIALOG_CLAUSE_IDS)).toHaveLength(
      TRANSITION_DIALOG_CLAUSE_IDS.length,
    );
  });

  it("clausesByIds returns clauses in the order requested", () => {
    const ids = TRANSITION_DIALOG_CLAUSE_IDS.slice(0, 2).reverse();
    expect(clausesByIds(ids).map((c) => c.id)).toEqual(ids);
  });

  it("clausesByIds throws on an unknown id rather than silently dropping it", () => {
    // Silent dropping is the exact failure mode this file exists to prevent.
    expect(() => clausesByIds(["no-such-clause"])).toThrow(/no-such-clause/);
  });

  it("both subsets are short enough to actually be read", () => {
    expect(DIALOG_CLAUSE_IDS.length).toBeLessThanOrEqual(6);
    expect(TRANSITION_DIALOG_CLAUSE_IDS.length).toBeLessThanOrEqual(6);
  });
});

describe("load-bearing clauses", () => {
  // The terms.ts header warns: a maximalist exemption clause risks
  // being struck down IN ITS ENTIRETY under the Hong Kong Control of Exemption Clauses
  // Ordinance (Cap. 71) reasonableness test, taking the enforceable protection with it.
  // The carve-out and severability are what make the rest survivable. Adding transition
  // clauses must not "strengthen" the terms by deleting them.
  it("the carve-out and severability clauses still exist", () => {
    expect(clausesByIds(LOAD_BEARING_CLAUSE_IDS)).toHaveLength(LOAD_BEARING_CLAUSE_IDS.length);
  });

  it("the carve-out still names the liabilities that cannot be excluded", () => {
    const carveOut = clausesByIds(["liability-carveout"])[0]!;
    expect(carveOut.body).toMatch(/gross negligence/i);
    expect(carveOut.body).toMatch(/wilful misconduct/i);
    expect(carveOut.body).toMatch(/fraud/i);
  });
});

describe("transition clauses cover the promises the toolkit makes", () => {
  const body = TRANSITION_CLAUSES.map((c) => `${c.heading} ${c.body}`).join("\n").toLowerCase();

  it("says a verification report is not a warranty", () => {
    expect(body).toMatch(/not a guarantee|no warranty|does not warrant/);
  });

  it("says BetterOSF never deletes from OSF as part of an export or transfer", () => {
    expect(body).toMatch(/does not delete/);
  });

  it("disclaims the third-party destination", () => {
    expect(body).toMatch(/zenodo/);
    expect(body).toMatch(/not affiliated/);
  });

  it("warns that publishing mints an irreversible DOI", () => {
    expect(body).toMatch(/doi/);
    expect(body).toMatch(/cannot be (fully )?withdrawn|irreversible|permanent/);
  });

  it("puts deposit authority — including participant consent — on the user", () => {
    expect(body).toMatch(/participant/);
    expect(body).toMatch(/indemnif/);
  });
});
