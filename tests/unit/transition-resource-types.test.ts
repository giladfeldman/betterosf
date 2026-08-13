// Zenodo's resource-type vocabulary.
//
// The lesson these tests encode is the licence map's: a vocabulary written from memory
// does not fail loudly — it fails by never matching, and a test written from the same
// assumption agrees with it. Every id here was copied from the live vocabulary endpoint
// on 2026-08-13, and `npm run test:live-zenodo` re-checks them against the service.

import { describe, it, expect } from "vitest";
import {
  RESOURCE_TYPES,
  SUGGESTED_RESOURCE_TYPE_IDS,
  DEFAULT_RESOURCE_TYPE_ID,
  isKnownResourceType,
} from "@/lib/transition/resource-types";

describe("RESOURCE_TYPES", () => {
  it("holds all 43 types the live vocabulary returned", () => {
    // A change in this number means Zenodo's vocabulary moved. Re-copy it from
    // GET /api/vocabularies/resourcetypes rather than editing this expectation.
    expect(RESOURCE_TYPES).toHaveLength(43);
  });

  it("has no duplicate ids", () => {
    const ids = RESOURCE_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a distinct label, including the three upstream 'Other's", () => {
    // Zenodo titles `image-other`, `publication-other` and `other` all as "Other". A flat
    // select showing three identical options is a coin toss, and the wrong resource type
    // corrupts DataCite indexing.
    const labels = RESOURCE_TYPES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps ids in Zenodo's own casing and punctuation", () => {
    for (const t of RESOURCE_TYPES) {
      expect(t.id).toMatch(/^[a-z]+(-[a-z]+)?$/);
      expect(t.id).toBe(t.id.toLowerCase());
    }
  });

  it("suggests only ids that exist", () => {
    for (const id of SUGGESTED_RESOURCE_TYPE_IDS) {
      expect(isKnownResourceType(id)).toBe(true);
    }
  });

  it("defaults to a real type", () => {
    expect(isKnownResourceType(DEFAULT_RESOURCE_TYPE_ID)).toBe(true);
  });

  it("rejects an unknown id rather than passing it through", () => {
    expect(isKnownResourceType("datasett")).toBe(false);
    expect(isKnownResourceType("")).toBe(false);
    // OSF's own category vocabulary is NOT Zenodo's, and is never inferred into it.
    expect(isKnownResourceType("project")).toBe(false);
    expect(isKnownResourceType("hypothesis")).toBe(false);
  });
});
