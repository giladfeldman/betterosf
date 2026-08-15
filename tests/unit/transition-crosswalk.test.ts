// The metadata crosswalk.
//
// Everything here can publish a false statement about someone's work under their name,
// without anything crashing. The two that matter most:
//
//   - relicensing by rounding: "CC-BY-NC 4.0" mapped to "CC-BY 4.0" would give away
//     rights the researcher deliberately kept;
//   - a guessed resource_type, which corrupts DataCite indexing and cannot be quietly
//     fixed once the DOI is minted.
//
// Both are refusals rather than best-effort mappings, and both are pinned below.

import { describe, it, expect } from "vitest";
import { crosswalk, mapLicence, mapCreators, blockingGaps, type CrosswalkInput } from "@/lib/transition/crosswalk";
import type { ContributorView } from "@/lib/osf/contributors";

function contributor(over: Partial<ContributorView> = {}): ContributorView {
  return {
    id: "n-u",
    userId: "u1",
    fullName: "Ada Lovelace",
    givenName: "Ada",
    familyName: "Lovelace",
    orcid: "0000-0002-1825-0097",
    orcidStatus: "VERIFIED",
    index: 0,
    bibliographic: true,
    permission: "admin",
    unregistered: false,
    ...over,
  };
}

function input(over: Partial<CrosswalkInput> = {}): CrosswalkInput {
  return {
    title: "A project",
    description: "About the project",
    category: "project",
    tags: ["replication"],
    dateCreated: "2020-03-04T10:00:00",
    dateModified: "2026-01-01T10:00:00",
    osfUrl: "https://osf.io/abc12/",
    doi: "10.17605/OSF.IO/ABC12",
    license: { name: "CC0 1.0 Universal" },
    contributors: [contributor()],
    resourceTypeId: "dataset",
    isIdenticalMirror: true,
    ...over,
  };
}

describe("licence mapping refuses to round", () => {
  it("maps an exactly-known licence to its SPDX id", () => {
    expect(mapLicence({ name: "CC0 1.0 Universal" }).rights).toEqual([{ id: "cc0-1.0" }]);
    expect(mapLicence({ name: "MIT License" }).rights).toEqual([{ id: "mit" }]);
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    // Real OSF name ("CC-By Attribution 4.0 International"), deliberately re-cased and
    // padded. Case-insensitivity matters because OSF's own capitalisation is
    // inconsistent — note "CC-By" here versus "CC-BY" on the other Creative Commons
    // entries. Matching case-sensitively would drop exactly one licence and nobody
    // would notice which.
    expect(mapLicence({ name: "  cc-by ATTRIBUTION 4.0 international " }).rights).toEqual([
      { id: "cc-by-4.0" },
    ]);
  });

  it("does NOT map a non-commercial licence onto its permissive neighbour", () => {
    // The defect this exists to prevent: giving away rights the researcher kept.
    //
    // NOTE the name. This test originally used "CC-BY-NC 4.0 International", which OSF
    // never returns — so it passed against a map key that could never fire in
    // production. The test agreed with the code and both were wrong about reality.
    // The string below is verbatim from GET https://api.osf.io/v2/licenses/.
    const nc = mapLicence({ name: "CC-BY Attribution-NonCommercial 4.0 International" });
    expect(nc.rights).toEqual([{ id: "cc-by-nc-4.0" }]);
    expect(JSON.stringify(nc.rights)).not.toContain('"cc-by-4.0"');
  });

  it("carries an unknown licence verbatim instead of guessing", () => {
    const r = mapLicence({ name: "Weird Lab Licence 1975", text: "Do what thou wilt." });
    expect(r.rights?.[0]?.id).toBeUndefined();
    expect(r.rights?.[0]?.title).toEqual({ en: "Weird Lab Licence 1975" });
    expect(r.row.status).toBe("approximated");
    expect(r.row.note).toMatch(/rather than mapped to a similar one/i);
  });

  it("maps EVERY licence name OSF actually returns, verbatim", () => {
    // Regression, betterosf-review 2026-08-13. The first map was written from memory and
    // six keys could never match: OSF says "CC-BY Attribution-NonCommercial 4.0
    // International", not "CC-BY-NC 4.0 International". Every non-commercial and
    // no-derivatives deposit would have reached Zenodo with no machine-readable licence.
    //
    // These strings are verbatim from GET https://api.osf.io/v2/licenses/ (2026-08-13).
    // If OSF renames one, this test fails and the map gets updated — rather than the
    // mapping silently degrading to "custom licence" for real users.
    const OSF_LICENCE_NAMES_WITH_TERMS: [string, string][] = [
      ["CC0 1.0 Universal", "cc0-1.0"],
      ["CC-By Attribution 4.0 International", "cc-by-4.0"],
      ["CC-BY Attribution-No Derivatives 4.0 International", "cc-by-nd-4.0"],
      ["CC-BY Attribution-NonCommercial 4.0 International", "cc-by-nc-4.0"],
      ["CC-BY Attribution-NonCommercial-ShareAlike 4.0 International", "cc-by-nc-sa-4.0"],
      ["MIT License", "mit"],
      ["Apache License 2.0", "apache-2.0"],
      ["Academic Free License (AFL) 3.0", "afl-3.0"],
      ["Artistic License 2.0", "artistic-2.0"],
      ['BSD 3-Clause "New"/"Revised" License', "bsd-3-clause"],
      ['BSD 2-Clause "Simplified" License', "bsd-2-clause"],
      ["GNU General Public License (GPL) 3.0", "gpl-3.0-only"],
      ["GNU General Public License (GPL) 2.0", "gpl-2.0-only"],
      ["GNU Lesser General Public License (LGPL) 3.0", "lgpl-3.0-only"],
      ["GNU Lesser General Public License (LGPL) 2.1", "lgpl-2.1-only"],
      ["Eclipse Public License 1.0", "epl-1.0"],
      ["Mozilla Public License 2.0", "mpl-2.0"],
    ];

    for (const [osfName, zenodoId] of OSF_LICENCE_NAMES_WITH_TERMS) {
      const r = mapLicence({ name: osfName });
      expect(r.rights, `${osfName} must map exactly`).toEqual([{ id: zenodoId }]);
      expect(r.row.status, `${osfName} must be exact`).toBe("exact");
    }
  });

  it("treats OSF's 'No license' and 'Other' as no licence, not as a custom one", () => {
    // Putting the words "No license" in a Zenodo rights field would state a restriction
    // the researcher never chose.
    for (const name of ["No license", "Other"]) {
      const r = mapLicence({ name });
      expect(r.rights, name).toBeUndefined();
      expect(r.row.status, name).toBe("dropped");
    }
  });

  it("reports a missing licence as dropped, not as a default", () => {
    const r = mapLicence(null);
    expect(r.rights).toBeUndefined();
    expect(r.row.status).toBe("dropped");
  });

  it("treats a blank licence name as missing", () => {
    expect(mapLicence({ name: "   " }).rights).toBeUndefined();
  });
});

describe("resource type is never inferred", () => {
  it("uses only the value the user supplied, and says so", () => {
    const r = crosswalk(input({ category: "analysis", resourceTypeId: "software" }));
    expect(r.metadata.resource_type).toEqual({ id: "software" });
    const row = r.fidelity.find((f) => f.field === "resource_type")!;
    expect(row.status).toBe("user_supplied");
    expect(row.note).toMatch(/never inferred/i);
  });

  it("keeps the OSF category in the side-car rather than discarding it", () => {
    expect(crosswalk(input({ category: "hypothesis" })).sidecar.osf_category).toBe("hypothesis");
  });
});

describe("creators", () => {
  it("attaches a verified ORCID", () => {
    const { creators } = mapCreators([contributor()]);
    expect(creators[0]!.person_or_org.identifiers).toEqual([
      { scheme: "orcid", identifier: "0000-0002-1825-0097" },
    ]);
  });

  it("omits the identifier entirely when there is no verified ORCID", () => {
    const { creators } = mapCreators([contributor({ orcid: null, orcidStatus: "CREATE" })]);
    expect(creators[0]!.person_or_org.identifiers).toBeUndefined();
  });

  it("names who is missing an ORCID rather than silently omitting", () => {
    const { rows } = mapCreators([contributor({ orcid: null, orcidStatus: null })]);
    expect(rows.find((r) => r.field === "creators.orcid")!.note).toMatch(/Ada Lovelace/);
  });

  it("excludes non-bibliographic contributors from creators but keeps them in the side-car", () => {
    const { creators, sidecar, rows } = mapCreators([
      contributor(),
      contributor({ id: "n-u2", fullName: "Helper", bibliographic: false }),
    ]);
    expect(creators).toHaveLength(1);
    expect(JSON.stringify(sidecar)).toMatch(/Helper/);
    expect(rows.some((r) => r.field === "contributors (non-author)")).toBe(true);
  });

  it("preserves OSF author order", () => {
    const { creators } = mapCreators([
      contributor({ id: "b", familyName: "Second", index: 1 }),
      contributor({ id: "a", familyName: "First", index: 0 }),
    ]);
    expect(creators.map((c) => c.person_or_org.family_name)).toEqual(["First", "Second"]);
  });

  it("does not guess where to split a single-string name", () => {
    // Splitting "Maria de la Cruz" on whitespace would mangle it.
    const { creators } = mapCreators([
      contributor({ givenName: null, familyName: null, fullName: "Maria de la Cruz" }),
    ]);
    expect(creators[0]!.person_or_org.family_name).toBe("Maria de la Cruz");
    expect(creators[0]!.person_or_org.given_name).toBeUndefined();
  });

  it("records permission and bibliographic status in the side-car", () => {
    const { sidecar } = mapCreators([contributor()]);
    expect(JSON.stringify(sidecar)).toMatch(/"permission":"admin"/);
  });
});

describe("the second-DOI problem is stated, not hidden", () => {
  it("links back to the OSF DOI and warns a second DOI will be minted", () => {
    const r = crosswalk(input());
    expect(r.metadata.related_identifiers).toContainEqual({
      identifier: "10.17605/OSF.IO/ABC12",
      scheme: "doi",
      relation_type: { id: "isidenticalto" },
    });
    const row = r.fidelity.find((f) => f.field === "related_identifiers")!;
    expect(row.note).toMatch(/SECOND DOI/);
    expect(row.note).toMatch(/no relation type fits perfectly/i);
  });

  it("uses IsDerivedFrom when the deposit is not a byte-identical mirror", () => {
    const r = crosswalk(input({ isIdenticalMirror: false }));
    expect(r.metadata.related_identifiers![0]!.relation_type).toEqual({ id: "isderivedfrom" });
  });

  it("still links back to the OSF URL when there is no DOI", () => {
    const r = crosswalk(input({ doi: null }));
    expect(r.metadata.related_identifiers!.map((x) => x.scheme)).toEqual(["url"]);
  });
});

describe("publication_date is labelled a choice", () => {
  it("derives it from date_created and says that is not a fact", () => {
    const r = crosswalk(input());
    expect(r.metadata.publication_date).toBe("2020-03-04");
    expect(r.fidelity.find((f) => f.field === "publication_date")!.note).toMatch(
      /a choice rather than a fact/i,
    );
  });
});

describe("fidelity table", () => {
  it("accounts for every field, including the ones that went nowhere", () => {
    const fields = crosswalk(input()).fidelity.map((f) => f.field);
    for (const expected of ["title", "publication_date", "resource_type", "rights", "creators", "communities", "date_modified"]) {
      expect(fields).toContain(expected);
    }
  });

  it("marks communities as dropped rather than guessing one", () => {
    const row = crosswalk(input()).fidelity.find((f) => f.field === "communities")!;
    expect(row.status).toBe("dropped");
  });

  it("notes when there were no tags to carry", () => {
    const row = crosswalk(input({ tags: [] })).fidelity.find((f) => f.field === "subjects")!;
    expect(row.status).toBe("dropped");
  });
});

describe("blockingGaps", () => {
  it("is empty for a complete record", () => {
    expect(blockingGaps(crosswalk(input()))).toEqual([]);
  });

  it("blocks a deposit with no creators", () => {
    expect(blockingGaps(crosswalk(input({ contributors: [] }))).join(" ")).toMatch(/no creators/i);
  });

  it("blocks a deposit with no licence", () => {
    expect(blockingGaps(crosswalk(input({ license: null }))).join(" ")).toMatch(/No licence/i);
  });

  it("blocks a deposit with no usable date", () => {
    expect(blockingGaps(crosswalk(input({ dateCreated: "" }))).join(" ")).toMatch(/publication date/i);
  });
});

describe("codex-consult 2026-08-13 — reproduced metadata defects", () => {
  it("does not publish a whitespace-only DOI as a related identifier", () => {
    const r = crosswalk(input({ doi: "   " }));
    expect(r.metadata.related_identifiers!.map((x) => x.scheme)).toEqual(["url"]);
  });

  it("rejects a ten-character non-date as a publication date", () => {
    // "2026-99-99" is the right length and not a date. Length is not validity.
    expect(blockingGaps(crosswalk(input({ dateCreated: "2026-99-99" }))).join(" ")).toMatch(
      /publication date/i,
    );
    expect(blockingGaps(crosswalk(input({ dateCreated: "2026-02-30" }))).join(" ")).toMatch(
      /publication date/i,
    );
  });

  it("still accepts a real date", () => {
    expect(blockingGaps(crosswalk(input({ dateCreated: "2024-02-29T00:00:00" })))).toEqual([]);
  });
});

describe("publisher — the field that made every publish fail", () => {
  /**
   * Measured against sandbox.zenodo.org on 2026-08-14, with the exact metadata shape this
   * crosswalk emitted at the time:
   *
   *   POST /api/records/{id}/draft/actions/publish
   *   → 400 {"field":"metadata.publisher",
   *          "messages":["Missing publisher field required for DOI registration."]}
   *
   * The identical draft with `publisher: "Zenodo"` added published with 202. Nothing
   * caught this because the only real user run stopped at the draft — the publish leg had
   * never been exercised end to end against a live Zenodo.
   */
  it("sets a publisher, because Zenodo refuses to mint a DOI without one", () => {
    expect(crosswalk(input()).metadata.publisher).toBe("Zenodo");
  });

  it("records the publisher in the fidelity table rather than slipping it in silently", () => {
    const row = crosswalk(input()).fidelity.find((r) => r.field === "publisher");
    expect(row).toBeDefined();
    expect(row!.status).toBe("user_supplied");
    expect(row!.note).toMatch(/DOI/i);
  });
});
