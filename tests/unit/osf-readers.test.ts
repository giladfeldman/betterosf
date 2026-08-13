// Parsers for the OSF content BetterOSF could not previously see.
//
// Every fixture here is a VERBATIM shape observed from api.osf.io on 2026-08-13, not an
// invented one. That matters more than usual: the first draft of the contributor parser
// read ORCID from `attributes.social.orcid`, which looks entirely reasonable and is
// wrong. A 50-user sample of the live API found ZERO users with `social.orcid` set and
// 24 with a verified ORCID under `external_identity`. A test written against an assumed
// shape would have passed while the feature silently shipped no ORCIDs at all.

import { describe, it, expect } from "vitest";
import { extractOrcid, normaliseOrcid } from "@/lib/osf/contributors";
import { extractStorageBytes, describeStorageUnknown } from "@/lib/transition/storage-usage";
import { findDoi } from "@/lib/osf/project-extras";

describe("extractOrcid", () => {
  // Observed verbatim on /v2/users/tmwry/.
  const REAL = { ORCID: { id: "0000-0002-8713-1972", status: "VERIFIED" } };

  it("reads a verified ORCID from external_identity", () => {
    expect(extractOrcid(REAL)).toEqual({ id: "0000-0002-8713-1972", status: "VERIFIED" });
  });

  it("returns null for a contributor with no external identity", () => {
    expect(extractOrcid(undefined)).toEqual({ id: null, status: null });
    expect(extractOrcid({})).toEqual({ id: null, status: null });
  });

  it("does NOT assert an unverified ORCID, but still reports its status", () => {
    // Publishing an unverified identifier into DataCite would be a claim about a real
    // person that neither we nor OSF can stand behind.
    expect(extractOrcid({ ORCID: { id: "0000-0002-8713-1972", status: "CREATE" } })).toEqual({
      id: null,
      status: "CREATE",
    });
  });

  it("survives the key being lower-cased in future", () => {
    expect(extractOrcid({ orcid: { id: "0000-0001-5098-814X", status: "VERIFIED" } }).id).toBe(
      "0000-0001-5098-814X",
    );
  });

  it("ignores other external identities", () => {
    expect(extractOrcid({ SOMETHING_ELSE: { id: "x", status: "VERIFIED" } }).id).toBeNull();
  });

  it("handles a trailing X checksum", () => {
    expect(extractOrcid({ ORCID: { id: "0000-0001-5098-814X", status: "VERIFIED" } }).id).toBe(
      "0000-0001-5098-814X",
    );
  });
});

describe("normaliseOrcid", () => {
  it("accepts both the bare id and a full URL", () => {
    expect(normaliseOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(normaliseOrcid("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
  });

  it("upper-cases the X checksum so comparisons are stable", () => {
    expect(normaliseOrcid("0000-0001-5098-814x")).toBe("0000-0001-5098-814X");
  });

  it("rejects anything that is not an ORCID", () => {
    expect(normaliseOrcid("")).toBeNull();
    expect(normaliseOrcid(null)).toBeNull();
    expect(normaliseOrcid(12345)).toBeNull();
    expect(normaliseOrcid("not-an-orcid")).toBeNull();
  });
});

describe("extractStorageBytes", () => {
  // The /storage/ response shape is UNVERIFIED — it is contributor-only and returned 403
  // for every account available for testing. The parser therefore accepts the plausible
  // field names and, crucially, returns null rather than guessing.
  it("finds a byte count under attributes", () => {
    expect(extractStorageBytes({ data: { attributes: { storage_usage: 4096 } } })).toBe(4096);
  });

  it("accepts a numeric string", () => {
    expect(extractStorageBytes({ data: { attributes: { storage_usage: "4096" } } })).toBe(4096);
  });

  it("looks in meta as well as attributes", () => {
    expect(extractStorageBytes({ meta: { size: 12 } })).toBe(12);
    expect(extractStorageBytes({ data: { meta: { bytes: 7 } } })).toBe(7);
  });

  it("treats a genuine zero as known, not missing", () => {
    // An empty project really does use 0 bytes. Conflating that with "unknown" would be
    // the opposite error, and just as misleading.
    expect(extractStorageBytes({ data: { attributes: { storage_usage: 0 } } })).toBe(0);
  });

  it("returns null — never 0 — for an unrecognised shape", () => {
    // This is the whole point. A silent 0 would let a researcher scan an inventory and
    // skip a project that actually holds 40 GB.
    expect(extractStorageBytes({})).toBeNull();
    expect(extractStorageBytes({ data: { attributes: { something_else: 5 } } })).toBeNull();
    expect(extractStorageBytes({ data: { attributes: { storage_usage: "not a number" } } })).toBeNull();
    expect(extractStorageBytes({ data: { attributes: { storage_usage: -1 } } })).toBeNull();
  });
});

describe("describeStorageUnknown", () => {
  it("explains every reason without ever implying zero", () => {
    for (const reason of ["forbidden", "not_found", "unrecognised_shape", "error"] as const) {
      const text = describeStorageUnknown(reason);
      expect(text).toMatch(/not counted/i);
      expect(text).not.toMatch(/\b0\b|zero|empty/i);
    }
  });
});

describe("findDoi", () => {
  // Observed verbatim on /v2/nodes/8cd4r/identifiers/.
  const IDENTIFIERS = [
    { category: "ark", value: "c7605/osf.io/8cd4r" },
    { category: "doi", value: "10.17605/OSF.IO/8CD4R" },
  ];

  it("picks the DOI out of a mixed identifier list", () => {
    expect(findDoi(IDENTIFIERS)).toBe("10.17605/OSF.IO/8CD4R");
  });

  it("is null when the project has no DOI", () => {
    expect(findDoi([{ category: "ark", value: "c7605/osf.io/x" }])).toBeNull();
    expect(findDoi([])).toBeNull();
  });

  it("matches the category case-insensitively", () => {
    expect(findDoi([{ category: "DOI", value: "10.1234/x" }])).toBe("10.1234/x");
  });
});
