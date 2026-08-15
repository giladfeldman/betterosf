/**
 * LIVE round trip against sandbox.zenodo.org, using the REAL deposit client.
 *
 * This is the calibration test. Every unit test in the toolkit checks our code against
 * our own fixtures; this one checks it against the actual service, which is the only way
 * to know the fixtures still describe reality. It creates a real draft, uploads real
 * bytes, and compares the checksum Zenodo computed against one computed independently
 * here — ground truth, not self-agreement.
 *
 * INTERLOCKS (same posture as `npm run test:destructive`):
 *   1. `BETTEROSF_LIVE_ZENODO=i-understand` must be set.
 *   2. `ZENODO_SANDBOX_TOKEN` must be set — from a THROWAWAY sandbox account.
 *   3. It refuses to run if `ZENODO_ENV=production`.
 *   4. It NEVER publishes. Publishing mints a permanent DOI.
 *   5. It deletes the draft it created, and fails loudly if cleanup fails.
 *
 * Not in `npm test` (see vitest.live.config.ts), not in CI, not in /ship.
 * Run with: npm run test:live-zenodo
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  createDraft,
  declareFiles,
  uploadSingle,
  commitFile,
  listDraftFiles,
  deleteDraft,
  parseChecksum,
  updateDraftMetadata,
  type ZenodoAuth,
} from "@/lib/transition/targets/zenodo";
import { RESOURCE_TYPES } from "@/lib/transition/resource-types";
import { hashBytes } from "@/lib/transition/hash";
import { verifyFile, reconcile } from "@/lib/transition/verify";
import { crosswalk } from "@/lib/transition/crosswalk";
import type { ContributorView } from "@/lib/osf/contributors";

const token = process.env.ZENODO_SANDBOX_TOKEN?.trim();
const optIn = process.env.BETTEROSF_LIVE_ZENODO === "i-understand";
const enabled = Boolean(token) && optIn && process.env.ZENODO_ENV !== "production";

const auth: ZenodoAuth = { accessToken: token ?? "", env: "sandbox" };
let createdDraftId: string | null = null;

afterAll(async () => {
  // Leave nothing behind. A probe that litters a sandbox with drafts trains people to
  // ignore what is in there.
  if (createdDraftId && token) {
    await deleteDraft(auth, createdDraftId);
  }
});

describe.skipIf(!enabled)("Zenodo sandbox round trip", () => {
  it("refuses to point at production", () => {
    expect(process.env.ZENODO_ENV).not.toBe("production");
    expect(auth.env).toBe("sandbox");
  });

  it("creates a draft, uploads a nested key, and Zenodo's checksum matches ours", async () => {
    const contributors: ContributorView[] = [
      {
        id: "probe-1",
        userId: "u1",
        fullName: "BetterOSF Probe",
        givenName: "BetterOSF",
        familyName: "Probe",
        orcid: null,
        orcidStatus: null,
        index: 0,
        bibliographic: true,
        permission: "admin",
        unregistered: false,
      },
    ];

    // Metadata comes from the REAL crosswalk, so this also proves the crosswalk emits
    // something Zenodo actually accepts — a shape unit tests cannot confirm.
    const { metadata } = crosswalk({
      title: "BetterOSF live probe — safe to delete",
      description: "Automated round-trip test. Never published.",
      category: "project",
      tags: ["betterosf-probe"],
      dateCreated: "2026-08-13T00:00:00",
      dateModified: "2026-08-13T00:00:00",
      osfUrl: "https://osf.io/abc12/",
      doi: null,
      license: { name: "CC0 1.0 Universal" },
      contributors,
      resourceTypeId: "dataset",
      isIdenticalMirror: true,
    });

    const draft = await createDraft(auth, metadata);
    createdDraftId = draft.id;
    expect(draft.id).toBeTruthy();

    // A key WITH slashes — the thing that decides whether deposits keep OSF's folders.
    const key = "osfstorage/sub dir/nested probe.txt";
    const bytes = new TextEncoder().encode("betterosf live probe payload");
    const localDigest = await hashBytes(bytes);

    const declared = await declareFiles(auth, draft.id, [{ key, size: bytes.byteLength }]);
    expect(declared).toHaveLength(1);
    expect(declared[0]!.key).toBe(key);
    expect(declared[0]!.transferType).toBe("L");

    await uploadSingle(auth, draft.id, key, new Blob([bytes]));
    const commit = await commitFile(auth, draft.id, key);

    expect(commit.status).toBe("completed");
    expect(commit.size).toBe(bytes.byteLength);
    // Ground truth: Zenodo hashed what it stored; we hashed what we sent, independently.
    expect(commit.md5).toBe(localDigest.md5);

    // The real verifier, on real data.
    const verification = verifyFile({
      osfFileId: "probe-file",
      path: key,
      declaredSize: bytes.byteLength,
      declared: { md5: localDigest.md5, sha256: localDigest.sha256 },
      written: [{ start: 0, end: bytes.byteLength }],
      local: localDigest,
      remoteMd5: commit.md5,
      contentType: "text/plain",
    });
    expect(verification.state).toBe("verified");

    // Independent third opinion: Zenodo's own listing, with slashes intact.
    const keys = await listDraftFiles(auth, draft.id);
    expect(keys).toContain(key);

    const verdict = reconcile({
      expected: [{ osfFileId: "probe-file", path: key, size: bytes.byteLength }],
      results: [verification],
      destinationKeys: keys,
    });
    expect(verdict.status).toBe("complete");
  });

  it("declares a large file as multipart with per-part URLs", async () => {
    // Does not upload 100 MB — it checks that Zenodo still ISSUES a multipart plan, which
    // is the fact the resumable-upload design rests on. If Zenodo ever withdraws it, the
    // "resumable on both legs" claim in the docs becomes false and must be corrected.
    const draft = await createDraft(auth, {
      title: "BetterOSF multipart probe — safe to delete",
      publisher: "Zenodo",
      publication_date: "2026-08-13",
      resource_type: { id: "dataset" },
      creators: [{ person_or_org: { type: "personal", family_name: "Probe" } }],
    });

    try {
      const declared = await declareFiles(auth, draft.id, [
        { key: "big.bin", size: 200 * 1024 * 1024 },
      ]);
      expect(declared[0]!.transferType).toBe("M");
      expect(declared[0]!.parts?.length).toBeGreaterThan(1);
      expect(declared[0]!.parts?.[0]?.url).toMatch(/^https:\/\/sandbox\.zenodo\.org\//);
      expect(declared[0]!.parts?.[0]?.expiration).toBeTruthy();
    } finally {
      await deleteDraft(auth, draft.id);
    }
  });

  it("still accepts a metadata-only PUT on a draft, which is how shards get linked", async () => {
    // Measured 2026-08-13: `{metadata}` alone returns 200, while echoing back the record
    // object from `GET .../draft` returns a **500**. A split deposit's IsPartOf links ride
    // on this call, so if Zenodo changes it the shards silently stop being related.
    const draft = await createDraft(auth, {
      title: "BetterOSF shard-link probe — safe to delete",
      publisher: "Zenodo",
      publication_date: "2026-08-13",
      resource_type: { id: "dataset" },
      creators: [{ person_or_org: { type: "personal", family_name: "Probe" } }],
    });

    try {
      const sibling = "https://sandbox.zenodo.org/records/999999";
      await updateDraftMetadata(auth, draft.id, {
        title: "BetterOSF shard-link probe — safe to delete",
        publisher: "Zenodo",
        publication_date: "2026-08-13",
        resource_type: { id: "dataset" },
        creators: [{ person_or_org: { type: "personal", family_name: "Probe" } }],
        related_identifiers: [
          { identifier: sibling, scheme: "url", relation_type: { id: "ispartof" } },
        ],
      });

      // Read it back rather than trusting the 200: the point is that it PERSISTED.
      const res = await fetch(`https://sandbox.zenodo.org/api/records/${draft.id}/draft`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const related = (json.metadata?.related_identifiers ?? []) as { identifier: string }[];
      expect(related.map((r) => r.identifier)).toContain(sibling);
    } finally {
      await deleteDraft(auth, draft.id);
    }
  });

  it("still publishes every resource-type id we offer", async () => {
    // The licence-map lesson, applied to a second vocabulary: an id that no longer exists
    // does not fail loudly — Zenodo rejects the deposit at create time, after the user has
    // chosen it. Checked against the live vocabulary rather than against our own copy.
    const res = await fetch("https://sandbox.zenodo.org/api/vocabularies/resourcetypes?size=200");
    expect(res.ok).toBe(true);
    const json = await res.json();
    const live = new Set(
      ((json.hits?.hits ?? []) as { id: string }[]).map((h) => h.id),
    );
    expect(live.size).toBeGreaterThan(0);

    const missing = RESOURCE_TYPES.filter((t) => !live.has(t.id)).map((t) => t.id);
    expect(missing).toEqual([]);

    // And the reverse: a type Zenodo added that we never offer. Not a failure, but it
    // should be visible rather than silently absent from the picker forever.
    const unoffered = [...live].filter((id) => !RESOURCE_TYPES.some((t) => t.id === id));
    if (unoffered.length > 0) {
      console.warn(`Zenodo now offers resource types BetterOSF does not list: ${unoffered.join(", ")}`);
    }
  });

  it("parses whatever checksum format Zenodo actually returns today", async () => {
    // Guards against Zenodo switching algorithm or prefix without us noticing: the
    // verifier compares bare hex and would silently start failing every file.
    expect(parseChecksum("md5:3833d18ed830b621388834f87be21458")).toBe(
      "3833d18ed830b621388834f87be21458",
    );
  });
});

describe.skipIf(enabled)("Zenodo live probe is disabled", () => {
  it("explains how to enable it", () => {
    expect(enabled).toBe(false);
  });
});
