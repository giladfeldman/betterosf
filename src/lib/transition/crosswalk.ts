/**
 * OSF project metadata → Zenodo (InvenioRDM / DataCite) record metadata.
 *
 * A crosswalk between systems whose fields do not correspond one to one. The design rule
 * throughout: **never coerce silently.** Where a value has no faithful target, it is
 * either left out and recorded in the fidelity table, or carried in the side-car — never
 * rounded to the nearest plausible thing.
 *
 * Two specific refusals, both because being wrong here publishes a false statement about
 * someone's work under their name:
 *
 *   - **Licence.** Exact match or `other`. "CC-BY-NC 4.0" is NOT "CC-BY 4.0"; mapping it
 *     to the neighbour would relicense a researcher's data more permissively than they
 *     chose. Unmatched licences keep their verbatim OSF text.
 *   - **Resource type.** Never inferred. OSF's category vocabulary ("project",
 *     "analysis", "hypothesis") does not map onto Zenodo's, and a wrong resource_type
 *     corrupts DataCite indexing. The caller must supply one the user picked.
 *
 * Pure: facts in, object out. No network, no clock.
 */

import type { ContributorView } from "@/lib/osf/contributors";

/**
 * DataCite's `publisher` for a Zenodo deposit.
 *
 * Not derived from OSF, which has no such field. See `ZenodoMetadata.publisher`.
 */
export const ZENODO_PUBLISHER = "Zenodo";

/** How faithfully one field survived the crossing. */
export type FidelityStatus = "exact" | "approximated" | "dropped" | "user_supplied";

export type FidelityRow = {
  field: string;
  source: string;
  status: FidelityStatus;
  note: string;
};

export type ZenodoCreator = {
  person_or_org: {
    type: "personal";
    given_name?: string;
    family_name: string;
    name?: string;
    identifiers?: { scheme: "orcid"; identifier: string }[];
  };
};

export type ZenodoRelatedIdentifier = {
  identifier: string;
  scheme: string;
  relation_type: { id: string };
};

export type ZenodoMetadata = {
  title: string;
  description?: string;
  /**
   * REQUIRED to publish. Zenodo refuses to mint a DOI without it —
   * `{"field":"metadata.publisher","messages":["Missing publisher field required for DOI
   * registration."]}`, measured against sandbox.zenodo.org on 2026-08-14 with the exact
   * metadata this crosswalk emits. Creating and filling a draft works fine without it, so
   * the omission was invisible until the publish leg was probed end to end.
   */
  publisher: string;
  publication_date: string;
  resource_type: { id: string };
  creators: ZenodoCreator[];
  subjects?: { subject: string }[];
  rights?: { id?: string; title?: { en: string }; description?: { en: string } }[];
  related_identifiers?: ZenodoRelatedIdentifier[];
};

export type CrosswalkInput = {
  title: string;
  description: string;
  /** OSF category, e.g. "project". Recorded, never mapped. */
  category: string;
  tags: string[];
  dateCreated: string;
  dateModified: string;
  osfUrl: string;
  doi: string | null;
  /** OSF's node_license, verbatim. */
  license: { name: string; text?: string | null } | null;
  contributors: ContributorView[];
  /**
   * Chosen by the user, never inferred. Zenodo resource type id, e.g. "dataset".
   */
  resourceTypeId: string;
  /**
   * Whether the deposit is a byte-identical mirror of the OSF record. Decides the
   * DataCite relation type, which the user is shown before publishing.
   */
  isIdenticalMirror: boolean;
};

export type CrosswalkResult = {
  metadata: ZenodoMetadata;
  fidelity: FidelityRow[];
  /** Fields that could not be carried at all, for the side-car file. */
  sidecar: Record<string, unknown>;
};

/**
 * Exact OSF-licence-name → Zenodo licence id.
 *
 * ⚠️ EVERY KEY BELOW IS A VERBATIM OSF LICENCE NAME, copied from
 * `GET https://api.osf.io/v2/licenses/` on 2026-08-13 — all 19 of them. Every VALUE was
 * confirmed to resolve at `https://zenodo.org/api/vocabularies/licenses/<id>` on the same
 * day. Neither side is guessed.
 *
 * The first draft of this map was written from memory and SIX of its keys could never
 * have matched: OSF says "CC-BY Attribution-NonCommercial 4.0 International", not
 * "CC-BY-NC 4.0 International", and 'BSD 3-Clause "New"/"Revised" License' uses a slash
 * where the draft used " or ". OSF has no plain CC-BY-SA at all, and its Eclipse licence
 * is 1.0 rather than 2.0. The fallback is safe — it preserves the licence text rather
 * than relicensing — but every non-commercial and no-derivatives deposit would have
 * reached Zenodo with NO machine-readable licence, so DataCite would not have known the
 * work was NC. A map that silently never fires is the "declared capability the code does
 * not deliver" defect in miniature.
 *
 * **If you add a key here, copy it from the live API. Do not type it from memory.**
 * `tests/unit/transition-crosswalk.test.ts` pins the full observed name list.
 *
 * Exact match only. Anything absent falls through to a custom licence carrying the
 * verbatim OSF text, reported as `approximated` so the researcher is told to check it.
 */
const LICENCE_IDS: Record<string, string> = {
  "cc0 1.0 universal": "cc0-1.0",
  "cc-by attribution 4.0 international": "cc-by-4.0",
  "cc-by attribution-no derivatives 4.0 international": "cc-by-nd-4.0",
  "cc-by attribution-noncommercial 4.0 international": "cc-by-nc-4.0",
  "cc-by attribution-noncommercial-sharealike 4.0 international": "cc-by-nc-sa-4.0",
  "mit license": "mit",
  "apache license 2.0": "apache-2.0",
  "academic free license (afl) 3.0": "afl-3.0",
  "artistic license 2.0": "artistic-2.0",
  'bsd 3-clause "new"/"revised" license': "bsd-3-clause",
  'bsd 2-clause "simplified" license': "bsd-2-clause",
  "gnu general public license (gpl) 3.0": "gpl-3.0-only",
  "gnu general public license (gpl) 2.0": "gpl-2.0-only",
  "gnu lesser general public license (lgpl) 3.0": "lgpl-3.0-only",
  "gnu lesser general public license (lgpl) 2.1": "lgpl-2.1-only",
  "eclipse public license 1.0": "epl-1.0",
  "mozilla public license 2.0": "mpl-2.0",
};

/**
 * OSF names that exist but assert no licence. Treated as "none set", not as a custom
 * licence — depositing a Zenodo record whose rights field reads "No license" would state
 * something the researcher never chose.
 */
const NON_LICENCE_NAMES = new Set(["no license", "other"]);

export function mapLicence(
  license: { name: string; text?: string | null } | null,
): { rights: ZenodoMetadata["rights"]; row: FidelityRow } {
  if (!license || !license.name.trim()) {
    return {
      rights: undefined,
      row: {
        field: "rights",
        source: "node_license",
        status: "dropped",
        note: "No licence set on OSF. Zenodo requires you to choose one before publishing.",
      },
    };
  }

  const name = license.name.trim().toLowerCase();

  if (NON_LICENCE_NAMES.has(name)) {
    // "No license" and "Other" are OSF's way of saying nothing was chosen. Carrying them
    // through as a custom licence title would put the words "No license" in the record's
    // rights field, which reads as a deliberate restriction rather than an absence.
    return {
      rights: undefined,
      row: {
        field: "rights",
        source: license.name,
        status: "dropped",
        note: `OSF records this project's licence as "${license.name}", which asserts no specific terms. Choose a licence before publishing — Zenodo requires one.`,
      },
    };
  }

  const id = LICENCE_IDS[name];
  if (id) {
    return {
      rights: [{ id }],
      row: {
        field: "rights",
        source: license.name,
        status: "exact",
        note: `Matched exactly to "${id}".`,
      },
    };
  }

  // No exact match. Carry the verbatim text rather than picking a neighbour: a licence
  // "close to" the one the researcher chose is a different licence.
  return {
    rights: [
      {
        title: { en: license.name },
        description: { en: license.text?.slice(0, 2000) ?? license.name },
      },
    ],
    row: {
      field: "rights",
      source: license.name,
      status: "approximated",
      note:
        `No exact match for "${license.name}", so it is recorded as a custom licence with its ` +
        `OSF text rather than mapped to a similar one. Check it before publishing.`,
    },
  };
}

/**
 * Contributors → creators.
 *
 * Lossy, unavoidably. DataCite has no home for OSF's bibliographic flag, permission
 * level, or contributor ordering semantics, and no role vocabulary that OSF populates.
 * Only bibliographic contributors become creators; everyone else, and every dropped
 * attribute, goes to the side-car so the authorship record is not quietly rewritten.
 */
export function mapCreators(contributors: ContributorView[]): {
  creators: ZenodoCreator[];
  rows: FidelityRow[];
  sidecar: Record<string, unknown>;
} {
  const bibliographic = [...contributors]
    .filter((c) => c.bibliographic)
    .sort((a, b) => a.index - b.index);

  const creators: ZenodoCreator[] = bibliographic.map((c) => {
    const person: ZenodoCreator["person_or_org"] = c.familyName
      ? { type: "personal", family_name: c.familyName, given_name: c.givenName ?? undefined }
      : // Zenodo requires family_name for a personal creator; a single-string OSF name
        // has no reliable split, so use it whole rather than guessing where to cut.
        { type: "personal", family_name: c.fullName };

    if (c.orcid) {
      person.identifiers = [{ scheme: "orcid", identifier: c.orcid }];
    }
    return { person_or_org: person };
  });

  const rows: FidelityRow[] = [
    {
      field: "creators",
      source: "contributors",
      status: "approximated",
      note:
        `${bibliographic.length} bibliographic contributor(s) became creators, in OSF order. ` +
        `Permission level and bibliographic status have no DataCite equivalent and are recorded ` +
        `in the side-car only.`,
    },
  ];

  const withoutOrcid = bibliographic.filter((c) => !c.orcid);
  if (withoutOrcid.length > 0) {
    rows.push({
      field: "creators.orcid",
      source: "external_identity",
      status: "dropped",
      note:
        `${withoutOrcid.length} of ${bibliographic.length} creator(s) have no VERIFIED ORCID on OSF, ` +
        `so none is asserted for them: ${withoutOrcid.map((c) => c.fullName).join(", ")}.`,
    });
  }

  const nonBibliographic = contributors.filter((c) => !c.bibliographic);
  if (nonBibliographic.length > 0) {
    rows.push({
      field: "contributors (non-author)",
      source: "contributors",
      status: "dropped",
      note: `${nonBibliographic.length} non-bibliographic contributor(s) are not creators and appear only in the side-car.`,
    });
  }

  return {
    creators,
    rows,
    sidecar: {
      osf_contributors: contributors.map((c) => ({
        name: c.fullName,
        osf_user_id: c.userId,
        index: c.index,
        bibliographic: c.bibliographic,
        permission: c.permission,
        orcid: c.orcid,
        orcid_status: c.orcidStatus,
        unregistered: c.unregistered,
      })),
    },
  };
}

export function crosswalk(input: CrosswalkInput): CrosswalkResult {
  const fidelity: FidelityRow[] = [];
  const sidecar: Record<string, unknown> = {};

  fidelity.push({ field: "title", source: "title", status: "exact", note: "Carried unchanged." });

  if (input.description.trim()) {
    fidelity.push({
      field: "description",
      source: "description",
      status: "exact",
      note: "Carried unchanged.",
    });
  }

  // publication_date: a CHOICE, not a fact. OSF has no publication date; date_created is
  // when the project row was made, which may be years before anything was published.
  fidelity.push({
    field: "publication_date",
    source: "date_created",
    status: "approximated",
    note:
      "OSF has no publication date. The project's creation date is used, which is a choice rather " +
      "than a fact — change it if the work was published on a different date.",
  });

  fidelity.push({
    field: "publisher",
    source: "(set by BetterOSF)",
    status: "user_supplied",
    note:
      `OSF has no publisher field, and Zenodo will not mint a DOI without one, so the deposit ` +
      `records "${ZENODO_PUBLISHER}" — the same value Zenodo's own upload form pre-fills. ` +
      `Change it on the draft if a different publisher is correct for this work.`,
  });

  fidelity.push({
    field: "resource_type",
    source: "(you chose it)",
    status: "user_supplied",
    note:
      `OSF's category ("${input.category}") has no equivalent in Zenodo's resource-type vocabulary, ` +
      `so it was never inferred. You selected "${input.resourceTypeId}".`,
  });
  sidecar.osf_category = input.category;

  const licence = mapLicence(input.license);
  fidelity.push(licence.row);

  const creators = mapCreators(input.contributors);
  fidelity.push(...creators.rows);
  Object.assign(sidecar, creators.sidecar);

  const related: ZenodoRelatedIdentifier[] = [];
  // Always point back at the original, whether or not it has a DOI. A deposit that does
  // not say where it came from makes the duplication problem worse, not better.
  related.push({
    identifier: input.osfUrl,
    scheme: "url",
    relation_type: { id: input.isIdenticalMirror ? "isidenticalto" : "isderivedfrom" },
  });
  // `.trim()` matters: a whitespace-only DOI is truthy and would be published as a
  // related identifier pointing at nothing. (Codex consult 2026-08-13.)
  const doi = input.doi?.trim() || null;
  if (doi) {
    related.push({
      identifier: doi,
      scheme: "doi",
      relation_type: { id: input.isIdenticalMirror ? "isidenticalto" : "isderivedfrom" },
    });
    fidelity.push({
      field: "related_identifiers",
      source: "OSF DOI",
      status: "approximated",
      note:
        `Linked to the existing OSF DOI as "${input.isIdenticalMirror ? "IsIdenticalTo" : "IsDerivedFrom"}". ` +
        `DataCite's relation vocabulary was designed for versioning and citation graphs, not for moving ` +
        `custody of the same work, so no relation type fits perfectly. This deposit will mint a SECOND DOI.`,
    });
  }

  if (input.tags.length === 0) {
    fidelity.push({
      field: "subjects",
      source: "tags",
      status: "dropped",
      note: "No tags on OSF, so no subjects were set.",
    });
  } else {
    fidelity.push({
      field: "subjects",
      source: "tags",
      status: "exact",
      note: `${input.tags.length} OSF tag(s) carried as free-text subjects.`,
    });
  }

  fidelity.push({
    field: "communities",
    source: "—",
    status: "dropped",
    note: "OSF has no equivalent, so no Zenodo community is proposed. Add one yourself if you want to.",
  });

  // Things with nowhere to go at all.
  sidecar.osf_url = input.osfUrl;
  sidecar.osf_doi = input.doi;
  sidecar.osf_date_created = input.dateCreated;
  sidecar.osf_date_modified = input.dateModified;
  fidelity.push({
    field: "date_modified",
    source: "date_modified",
    status: "dropped",
    note: "Zenodo tracks its own record dates; OSF's last-modified date is kept in the side-car.",
  });

  const metadata: ZenodoMetadata = {
    title: input.title,
    // "Zenodo" rather than "OSF" or the institution: DataCite's publisher is the entity
    // making the resource available, which for this deposit is Zenodo. It is also what
    // Zenodo's own upload form pre-fills, so a researcher who later edits the draft by
    // hand sees the value they would have got anyway.
    publisher: ZENODO_PUBLISHER,
    publication_date: (input.dateCreated || "").slice(0, 10),
    resource_type: { id: input.resourceTypeId },
    creators: creators.creators,
    related_identifiers: related,
  };
  if (input.description.trim()) metadata.description = input.description;
  if (input.tags.length > 0) metadata.subjects = input.tags.map((t) => ({ subject: t }));
  if (licence.rights) metadata.rights = licence.rights;

  return { metadata, fidelity, sidecar };
}

/** Fields the user must resolve before a deposit can be published. */
export function blockingGaps(result: CrosswalkResult): string[] {
  const gaps: string[] = [];
  if (result.metadata.creators.length === 0) {
    gaps.push(
      "No bibliographic contributors were found, so the deposit has no creators. Zenodo requires at least one.",
    );
  }
  if (!result.metadata.rights) {
    gaps.push("No licence is set. Choose one before publishing — Zenodo will not accept a record without it.");
  }
  // Length alone is not validity: "2026-99-99" is ten characters and not a date.
  // DataCite would reject it, or worse, coerce it. (Codex consult 2026-08-13.)
  if (!isRealIsoDate(result.metadata.publication_date)) {
    gaps.push("No usable publication date could be derived from OSF. Set one before publishing.");
  }
  return gaps;
}

/** True only for a real YYYY-MM-DD that round-trips through Date. */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
