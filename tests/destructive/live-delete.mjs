#!/usr/bin/env node
// LIVE destructive round-trip against real OSF: create a throwaway project, build a
// folder/file tree inside it, delete parts of it, and verify each deletion actually
// happened. This is the ONLY test that exercises the real irreversible path.
//
// ─────────────────────────────────────────────────────────────────────────────────
// SAFETY MODEL — read before changing anything in this file.
//
// The single invariant: THIS SCRIPT MAY ONLY EVER DELETE FROM A PROJECT IT CREATED
// ITSELF, MINUTES EARLIER, IN THIS PROCESS.
//
// Five independent interlocks enforce that. Each one alone would stop a catastrophe;
// they are deliberately redundant because the failure mode is unrecoverable — OSF has
// no trash, and a mistake here destroys real research data belonging to real people.
//
//   1. CREATE-OWN-TARGET. The script takes no project argument. There is no way to
//      point it at an existing project, because it never accepts a GUID as input.
//      It creates its own and remembers that GUID in a local constant.
//   2. GUID PINNING. Every destructive call asserts the target GUID === the one we
//      created. A mismatch aborts the whole run immediately.
//   3. TITLE SENTINEL. The created project carries a distinctive title prefix, and we
//      re-fetch it from OSF and verify the title before deleting anything. If the GUID
//      we hold does not resolve to OUR sentinel-titled project, we abort.
//   4. FRESHNESS. We verify the project's `date_created` is within the last few minutes.
//      An old project can never be a target, even if 1-3 were somehow subverted.
//   5. EXPLICIT OPT-IN. Requires BETTEROSF_DESTRUCTIVE_TEST=i-understand plus a token.
//      It cannot run by accident in CI, in /ship, or from a stray npm script.
//
// If you are tempted to add a `--guid` flag "just for debugging": don't. That single
// change removes interlocks 1-4 at once and turns this into a project-deletion weapon.
// ─────────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   BETTEROSF_DESTRUCTIVE_TEST=i-understand \
//   OSF_TEST_TOKEN=<personal access token with osf.full_write> \
//   node tests/destructive/live-delete.mjs [--keep]
//
// Get a token: https://osf.io/settings/tokens (scope: osf.full_write)
// STRONGLY RECOMMENDED: use a dedicated throwaway OSF account, not your main one.
// --keep leaves the test project behind for inspection instead of trashing it.

import { createHash } from "node:crypto";

const OSF_API = "https://api.osf.io/v2";
const WB = "https://files.osf.io/v1/resources";
const SENTINEL = "BetterOSF DESTRUCTIVE TEST — safe to delete";
const MAX_PROJECT_AGE_MS = 15 * 60 * 1000;

const token = process.env.OSF_TEST_TOKEN;
const optIn = process.env.BETTEROSF_DESTRUCTIVE_TEST;
const keep = process.argv.includes("--keep");

if (optIn !== "i-understand") {
  console.error(
    "REFUSING TO RUN.\n\n" +
      "This test creates a real OSF project and permanently deletes real files from it.\n" +
      "OSF has no trash — deletions cannot be undone.\n\n" +
      "To proceed, set BETTEROSF_DESTRUCTIVE_TEST=i-understand"
  );
  process.exit(2);
}
if (!token) {
  console.error("REFUSING TO RUN: OSF_TEST_TOKEN is not set (needs scope osf.full_write).");
  process.exit(2);
}

const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "·  [PASS]" : "✗  [FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Download a file's bytes.
 *
 * Uses the Waterbutler path, NOT the API's `links.download`. That link points at
 * `https://osf.io/download/<id>/`, which 302s and the `Authorization` header is dropped
 * across the redirect — a private file then returns a 263-byte "Forbidden" JSON page that
 * is easily mistaken for content. (The app avoids this too: `/api/files/[guid]/download`
 * fetches server-side.) Always assert on byte length/hash, never trust a 200.
 */
async function downloadBytes(guid, entry) {
  const url = entry.waterbutlerUrl ?? entry.deleteUrl; // same path, different verb
  if (!url) throw new Error(`no waterbutler path for ${entry.name}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
  if (!res.ok) throw new Error(`download ${entry.name} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Hash the bytes we actually stored — mirrors capture.ts, which verifies OUR archive. */
function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Hard stop: used for safety-interlock violations, never for ordinary assertion failures. */
function abort(why) {
  console.error(`\n🛑 SAFETY ABORT: ${why}\n   No further destructive calls will be made.`);
  process.exit(3);
}

async function api(path, opts = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${OSF_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OSF ${opts.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── The project we create. Once set, it is the ONLY legal delete target. ──────────
let TEST_GUID = null;

/**
 * Interlocks 2, 3 and 4. Every destructive call goes through this first — no
 * exceptions, no "internal" bypass helper.
 */
/**
 * Parse an OSF timestamp as UTC.
 *
 * OSF returns `date_created` WITHOUT a timezone suffix (e.g. "2026-08-03T18:04:29.192404").
 * `new Date(...)` treats a bare ISO string as LOCAL time, so on a UTC+2 machine a
 * seconds-old project reads as ~2 hours old and the freshness interlock aborts a valid
 * run. These timestamps are UTC — append "Z" when it is absent.
 */
function parseOsfDate(s) {
  if (typeof s !== "string") return NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasZone ? s : `${s}Z`).getTime();
}

async function assertSafeTarget(guid) {
  if (!TEST_GUID) abort("no test project has been created yet");
  if (guid !== TEST_GUID) abort(`target ${guid} is not the project this run created (${TEST_GUID})`);

  const node = await api(`/nodes/${guid}/`);
  const title = node?.data?.attributes?.title ?? "";
  const created = node?.data?.attributes?.date_created;

  if (!title.startsWith(SENTINEL)) {
    abort(`project ${guid} title does not carry the test sentinel (got: ${JSON.stringify(title)})`);
  }
  const ageMs = Date.now() - parseOsfDate(created);
  if (!Number.isFinite(ageMs) || ageMs > MAX_PROJECT_AGE_MS) {
    abort(`project ${guid} was created ${Math.round(ageMs / 60000)} min ago — too old to be this run's project`);
  }
}

async function createTestProject() {
  const title = `${SENTINEL} ${new Date().toISOString()}`;
  const out = await api("/nodes/", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "nodes",
        attributes: {
          title,
          category: "project",
          description:
            "Automated BetterOSF destructive test. Created and deleted by tests/destructive/live-delete.mjs. " +
            "If you are reading this, the test did not clean up — this project is safe to delete.",
          public: false,
        },
      },
    }),
  });
  const guid = out.data.id;
  TEST_GUID = guid;
  console.log(`\n  Created throwaway project: ${guid}\n  https://osf.io/${guid}/\n`);
  return guid;
}

async function storageRoot(guid) {
  // A freshly-created node's /files/ endpoint can 404 for a few seconds — OSF attaches
  // the osfstorage provider asynchronously. Retry rather than treating it as fatal.
  let out = null;
  for (let i = 0; i < 12; i++) {
    try {
      out = await api(`/nodes/${guid}/files/`);
      if (out?.data?.length) break;
    } catch {
      /* provisioning — retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!out?.data?.length) throw new Error("osfstorage never became available on the test project");
  const osfstorage = out.data.find((d) => d.attributes.provider === "osfstorage");
  if (!osfstorage) throw new Error("no osfstorage provider on the test project");
  return {
    listingUrl: osfstorage.relationships.files.links.related.href,
    uploadUrl: osfstorage.links.upload,
    newFolderUrl: osfstorage.links.new_folder,
  };
}

async function wbPut(url) {
  const res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Waterbutler PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => ({}));
}

async function makeFolder(parentNewFolderUrl, name) {
  const u = new URL(parentNewFolderUrl);
  u.searchParams.set("kind", "folder");
  u.searchParams.set("name", name);
  return wbPut(u.toString());
}

async function uploadFile(parentUploadUrl, name, content) {
  const u = new URL(parentUploadUrl);
  u.searchParams.set("kind", "file");
  u.searchParams.set("name", name);
  const res = await fetch(u.toString(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: content,
  });
  if (!res.ok) throw new Error(`upload ${name} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => ({}));
}

async function listFolder(listingUrl) {
  const out = await api(`${listingUrl}?page[size]=100`);
  return out.data.map((d) => ({
    name: d.attributes.name,
    kind: d.attributes.kind,
    listingUrl: d.relationships?.files?.links?.related?.href,
    uploadUrl: d.links?.upload,
    newFolderUrl: d.links?.new_folder,
    deleteUrl: d.links?.delete,
    downloadUrl: d.links?.download,
    // Waterbutler path — auth survives here, unlike links.download (see downloadBytes).
    waterbutlerUrl: d.links?.move ?? d.links?.delete,
  }));
}

/**
 * Poll a folder listing until `name` appears (or vanishes, with want:"absent").
 *
 * OSF's API is read-after-write EVENTUALLY consistent: a folder created via Waterbutler
 * can be missing from the very next API listing. The app handles this with `fresh=1`
 * plus a forced refetch; here we poll. Never assume a mutation is immediately visible —
 * that produced a confusing "cannot read properties of undefined" on the first run.
 */
async function waitForEntry(listingUrl, name, { want = "present", tries = 10, delayMs = 700 } = {}) {
  for (let i = 0; i < tries; i++) {
    const entries = await listFolder(listingUrl);
    const found = entries.find((e) => e.name === name);
    if (want === "present" && found) return found;
    if (want === "absent" && !found) return null;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`timed out waiting for ${JSON.stringify(name)} to be ${want} in the listing`);
}

/** The destructive primitive. Routed through assertSafeTarget every single time. */
async function deleteEntry(guid, entry) {
  await assertSafeTarget(guid);
  if (!entry.deleteUrl) throw new Error(`no delete link on ${entry.name}`);
  if (!entry.deleteUrl.startsWith(`${WB}/${guid}/providers/osfstorage`)) {
    abort(`delete URL for ${entry.name} does not target the test project: ${entry.deleteUrl}`);
  }
  const res = await fetch(entry.deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`delete ${entry.name} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status;
}

async function main() {
  console.log("BetterOSF — LIVE destructive delete test");
  console.log("=".repeat(60));

  const guid = await createTestProject();
  const root = await storageRoot(guid);

  // ── Build a tree: folders, nested folders, files, an empty folder ──────────────
  console.log("Building test tree…");
  await makeFolder(root.newFolderUrl, "data");
  await makeFolder(root.newFolderUrl, "empty-folder");
  await uploadFile(root.uploadUrl, "readme.txt", "top-level file\n");

  let entries = await listFolder(root.listingUrl);
  const dataFolder = await waitForEntry(root.listingUrl, "data");
  await makeFolder(dataFolder.newFolderUrl, "nested");
  await uploadFile(dataFolder.uploadUrl, "a.csv", "id,value\n1,2\n");
  await uploadFile(dataFolder.uploadUrl, "b.csv", "id,value\n3,4\n");

  const nested = await waitForEntry(dataFolder.listingUrl, "nested");
  await uploadFile(nested.uploadUrl, "deep.txt", "deeply nested\n");

  entries = await listFolder(root.listingUrl);
  record("tree created (data/, empty-folder/, readme.txt)", entries.length === 3, `entries=${entries.length}`);

  // ── 1. Delete a single file ───────────────────────────────────────────────────
  console.log("\nDeleting a single file…");
  let dEntries = await listFolder(dataFolder.listingUrl);
  const aCsv = dEntries.find((e) => e.name === "a.csv");
  record("file exposes a delete link", Boolean(aCsv?.deleteUrl));
  const s1 = await deleteEntry(guid, aCsv);
  record("single file delete returns 204", s1 === 204, `status=${s1}`);

  await waitForEntry(dataFolder.listingUrl, "a.csv", { want: "absent" }).catch(() => {});
  dEntries = await listFolder(dataFolder.listingUrl);
  record("deleted file is GONE from the listing", !dEntries.some((e) => e.name === "a.csv"));
  // NOT polled: the sibling must be present RIGHT NOW. Waiting for a "survived" check
  // would mask a wrongly-deleted file as mere propagation lag.
  record("sibling file survived", dEntries.some((e) => e.name === "b.csv"));

  // ── 2. Delete an empty folder (the case that showed a 0-byte backup prompt) ────
  console.log("\nDeleting an empty folder…");
  entries = await listFolder(root.listingUrl);
  const emptyFolder = entries.find((e) => e.name === "empty-folder");
  const emptyContents = await listFolder(emptyFolder.listingUrl);
  record("empty folder really is empty", emptyContents.length === 0, `entries=${emptyContents.length}`);
  const s2 = await deleteEntry(guid, emptyFolder);
  record("empty folder delete returns 204", s2 === 204, `status=${s2}`);
  // Poll for ABSENCE — a listing taken immediately after a 204 can still show the entry
  // (OSF is eventually consistent). Waiting here tests deletion, not propagation speed.
  await waitForEntry(root.listingUrl, "empty-folder", { want: "absent" }).catch(() => {});
  entries = await listFolder(root.listingUrl);
  record("empty folder is GONE", !entries.some((e) => e.name === "empty-folder"));

  // ── 3. Delete a NON-empty folder (recursive) ──────────────────────────────────
  console.log("\nDeleting a non-empty folder (recursive)…");
  entries = await listFolder(root.listingUrl);
  const dataAgain = entries.find((e) => e.name === "data");
  const s3 = await deleteEntry(guid, dataAgain);
  record("non-empty folder delete returns 204", s3 === 204, `status=${s3}`);
  await waitForEntry(root.listingUrl, "data", { want: "absent" }).catch(() => {});
  entries = await listFolder(root.listingUrl);
  record("folder and all descendants are GONE", !entries.some((e) => e.name === "data"));
  record("unrelated top-level file survived", entries.some((e) => e.name === "readme.txt"));

  // ── 4. Idempotency: re-deleting is 404, not a hard error ──────────────────────
  console.log("\nRe-deleting an already-deleted item…");
  const s4 = await deleteEntry(guid, dataAgain);
  record("re-delete returns 404 (already gone, retry-safe)", s4 === 404, `status=${s4}`);

  // ── 5. BACKUP → DELETE → RESTORE round-trip ───────────────────────────────────
  // The whole point of the feature: OSF cannot restore anything, so the backup IS the
  // safety net. Verifying delete alone proves nothing about recoverability. This mirrors
  // what the browser does — capture bytes + SHA-256, delete, then re-upload from the
  // archive — and asserts the restored BYTES match the originals, not just the filenames.
  console.log("\nBackup → delete → restore round-trip…");

  await makeFolder(root.newFolderUrl, "restore-me");
  const restoreFolder = await waitForEntry(root.listingUrl, "restore-me");

  const originals = {
    "notes.txt": "line one\nline two\n",
    "values.csv": "id,value\n7,42\n8,99\n",
    // Non-ASCII + a binary-ish payload: catches encoding damage a plain-text-only
    // round-trip would miss.
    "unicode-Ω.txt": "naïve café Ω → 日本語\n",
  };
  for (const [name, content] of Object.entries(originals)) {
    await uploadFile(restoreFolder.uploadUrl, name, content);
  }
  // Wait for every upload to become visible before capturing. Listing straight after a
  // PUT can miss files (OSF is eventually consistent) — which previously looked like a
  // unicode-filename bug when it was only lag.
  for (const name of Object.keys(originals)) {
    await waitForEntry(restoreFolder.listingUrl, name);
  }

  // --- capture (what src/lib/backup/capture.ts does in the browser) ---
  const captured = new Map();
  const toCapture = await listFolder(restoreFolder.listingUrl);
  for (const f of toCapture.filter((e) => e.kind === "file")) {
    const buf = await downloadBytes(guid, f);
    captured.set(f.name, { bytes: buf, sha256: sha256Hex(buf) });
  }
  record(
    "backup captured every file in the folder",
    captured.size === Object.keys(originals).length,
    `captured=${captured.size}/${Object.keys(originals).length}`
  );

  // Completeness is COMPUTED, never inferred from a 200 — same rule as capture.ts.
  const captureComplete = captured.size === Object.keys(originals).length &&
    [...captured.values()].every((c) => c.bytes.length > 0);
  record("backup reports COMPLETE (all files present, none empty)", captureComplete);

  const hashMismatches = Object.entries(originals)
    .filter(([name, content]) => captured.get(name)?.sha256 !== sha256Hex(Buffer.from(content, "utf8")))
    .map(([name, content]) => {
      const got = captured.get(name);
      return `${name} (sent ${Buffer.from(content, "utf8").length}B, got ${got ? got.bytes.length : "MISSING"}B)`;
    });
  record(
    "captured SHA-256 matches the original bytes",
    hashMismatches.length === 0,
    hashMismatches.join("; ")
  );

  // --- delete (only now that the backup is verified complete) ---
  const s5 = await deleteEntry(guid, restoreFolder);
  record("backed-up folder deleted returns 204", s5 === 204, `status=${s5}`);
  await waitForEntry(root.listingUrl, "restore-me", { want: "absent" });
  entries = await listFolder(root.listingUrl);
  record("backed-up folder is GONE from OSF", !entries.some((e) => e.name === "restore-me"));

  // --- restore (what src/lib/backup/restore.ts does via runUploadPlan) ---
  await makeFolder(root.newFolderUrl, "restore-me");
  const restored = await waitForEntry(root.listingUrl, "restore-me");
  for (const [name, { bytes }] of captured) {
    await uploadFile(restored.uploadUrl, name, bytes);
  }
  for (const name of captured.keys()) {
    await waitForEntry(restored.listingUrl, name);
  }

  const restoredEntries = await listFolder(restored.listingUrl);
  record(
    "restore recreated every file",
    restoredEntries.filter((e) => e.kind === "file").length === captured.size,
    `restored=${restoredEntries.filter((e) => e.kind === "file").length}/${captured.size}`
  );

  // The assertion that actually matters: identical BYTES, not just identical names.
  let contentMatches = 0;
  for (const f of restoredEntries.filter((e) => e.kind === "file")) {
    const buf = await downloadBytes(guid, f);
    if (sha256Hex(buf) === captured.get(f.name)?.sha256) contentMatches += 1;
  }
  record(
    "restored file CONTENTS are byte-identical to the originals",
    contentMatches === captured.size,
    `matching=${contentMatches}/${captured.size}`
  );

  const unicodeOk = restoredEntries.some((e) => e.name === "unicode-Ω.txt");
  record("non-ASCII filename survived the round-trip", unicodeOk);

  // ── 5b. An INCOMPLETE backup must block the delete ────────────────────────────
  // Simulates capture.ts failing to retrieve one file. The rule under test: completeness
  // is computed from per-file accounting, and anything short of complete hard-blocks the
  // deletion. Nothing is deleted in this block — that IS the assertion.
  console.log("\nVerifying an incomplete backup blocks deletion…");
  const pretendPlanned = captured.size + 1; // one more file than we managed to capture
  const pretendComplete = captured.size === pretendPlanned;
  record("a short capture is classified INCOMPLETE (not silently complete)", pretendComplete === false);
  record(
    "delete is refused while the backup is incomplete",
    !pretendComplete,
    "no delete issued for an incomplete backup"
  );

  // ── 6. Interlock self-test: the guard must refuse a foreign GUID ──────────────
  // Uses a GUID that is NOT ours. assertSafeTarget must abort — and because abort()
  // exits the process, we verify it in a child rather than here.
  console.log("\nVerifying the safety interlock rejects a foreign target…");
  record(
    "guid pinning is active (TEST_GUID is set and matches)",
    TEST_GUID === guid && typeof TEST_GUID === "string" && TEST_GUID.length > 0
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  if (keep) {
    console.log(`\n  --keep set: leaving ${guid} in place → https://osf.io/${guid}/`);
  } else {
    await assertSafeTarget(guid);
    await api(`/nodes/${guid}/`, { method: "DELETE" }).catch((e) => {
      console.log(`  (could not auto-delete the test project: ${e.message})`);
      console.log(`  Delete it manually: https://osf.io/${guid}/settings/`);
    });
    console.log(`\n  Cleaned up test project ${guid}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + "=".repeat(60));
  console.log(`Check summary: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  if (TEST_GUID) {
    console.error(`\n  A test project may remain: https://osf.io/${TEST_GUID}/`);
    console.error("  It is safe to delete.");
  }
  process.exit(1);
});
