# Known Issues

## Deletion: three limits users and maintainers must know (2026-08-03)

**1. Local backups are evictable — they are not an archive.**
Pre-delete backups live in the browser's IndexedDB. The browser may clear them at any
time without notice, and they are lost with the device, on "clear site data", and in
private browsing. `navigator.storage.persist()` is requested but browsers may refuse.
This is why the ZIP download becomes **mandatory** above 100 MB / 100 files / any folder,
and why all UI copy says "kept in this browser" rather than "saved". Do not soften that
wording, and do not present the local backup as a durable copy.

**2. The delete rate cap is a speed bump, not enforcement.**
`src/middleware.ts` bypasses rate limiting for signed-in users, so the cap lives in the
route via `src/lib/limits.ts`. Vercel KV is **not provisioned**, so `limits.ts` falls back
to a per-lambda in-memory store — a determined caller can evade it by spreading requests
across lambdas. The real gate is the typed confirmation. Provisioning KV upgrades this to
a genuine cross-instance cap with no code change.

**3. Restore is not undo.**
Restoring a backup uploads new files. They receive new OSF file ids and fresh version
history, and any external link to an original file id stays broken. The UI says "restore a
copy" deliberately.

**Testing constraint.** `tests/visual/visual-qa.mjs` is anonymous and asserts only the
*absence* of delete controls; confirm-gating is covered in jsdom with mocks. The real
irreversible path is covered by `tests/destructive/live-delete.mjs`, which creates its own
throwaway OSF project, builds a tree, deletes from it, and verifies each removal:

```bash
BETTEROSF_DESTRUCTIVE_TEST=i-understand OSF_TEST_TOKEN=<token> npm run test:destructive
```

It needs a human with an OSF token — **an agent cannot run it**, and it must never be wired
into `/ship`, CI, or `npm test`. Use a **dedicated throwaway OSF account**. The script takes
no project argument by design; see its header for the five safety interlocks and why adding
a `--guid` flag would remove four of them at once.

## Anonymous delete-button leak (fixed 2026-08-03, same day)

For one build, row-level Delete buttons rendered for signed-out visitors — 28 of them on a
public project. Cause: the affordance was gated on `canUploadHere`
(= `!readOnly && osfstorage`), which is **true for anonymous users** since it only excludes
registrations. Fixed by gating on `canDeleteHere` (= `canUploadHere && canWrite`), where
`canWrite` comes from `/api/osf/write-status` and defaults to `false`.

Caught only by the visual-qa absence assertion, which is why that gate is mandatory on every
QA pass. Regression locked in by `tests/unit/delete-affordance.test.ts`. **Never gate a
destructive control on `readOnly`/`canUploadHere` alone.**

## Malformed multi-body `.docx` renders blank in docx-preview (mitigated 2026-06-07)

**Symptom.** Some `.docx` files on OSF — notably survey-tool exports (Qualtrics)
— contain hundreds of `<w:body>` elements, which violates OOXML (exactly one is
allowed). docx-preview reads only the first `<w:body>` (often empty) and
**resolves without throwing**, so the viewer used to show a blank gray page with
a misleading "Track changes rendering is experimental" footer, as if it had
succeeded. Real example: the project `3kmr9` file
`Newman_et_al_2011_RE_Studies_12.docx` has 485 `<w:body>` elements.

**Mitigation.** `DocxViewer` now detects an empty render
(`renderProducedContent()` — checks for text/media, ignoring docx-preview's
injected `<style>`) and shows an honest "Couldn't preview — malformed file,
download to view in Word" fallback instead of a blank box. There is no
docx-preview option that repairs multi-body files; only Microsoft Word merges
them on open. A future enhancement could merge the `<w:body>` elements in
`document.xml` before handing the blob to docx-preview so these files actually
render. Locked by `tests/unit/docx-empty-render.test.ts` and a visual-qa
assertion that accepts the fallback for the known-malformed fixture.

**Detector caveat.** `renderProducedContent()` must NOT key on a specific
wrapper element (it originally checked for `<article>`, which docx-preview
doesn't emit, so it false-positived and blanked *valid* docs). It now keys on
content signal (text or `img`/`table`/`svg`).

---

## Closed — Next.js 15.5 catch-all routing trap (resolved 2026-05-25)

**Was breaking:** every route returned 504 GATEWAY_TIMEOUT after the v0.6 deploy. Root cause: `src/app/[guid]/files/[...path]/view/page.tsx` put a static segment (`view`) AFTER a catch-all (`[...path]`), which Next.js 15.5 rejects at runtime with `Error: Catch-all must be the last part of the URL.` The error is fatal at module-init for the entire app, so even static routes like `/about` and `/` 504'd.

**Fixed in commit `af28a08`:** moved the viewer route to `src/app/[guid]/files/view/[...path]/page.tsx` (`view` BEFORE catch-all). Updated file-leaf hrefs in `UnifiedTree.tsx` (3 places) and E2E URL pattern. Lesson card at `~/.claude/skills/_shared/lessons/nextjs-catchall-must-be-last-breaks-runtime-not-just-build.md`.

**Lesson:** A "Ready" Vercel deploy with every URL 504'ing means `vercel logs <deploy-url>` is mandatory. Build success ≠ runtime success when Next.js router validation throws at boot.

---

## OSF OAuth — resolved (2026-07-17)

**Was:** COS CAS rejected the BetterOSF developer app (`invalid_client` /
`UnauthorizedServiceException`) despite a valid OSF UI registration (open since
2026-05-23). See historical notes in git history / `docs/osf-support-email-2026-05-23.md`.

**Now:** Sign-in with OSF and uploads work on production (user-verified
2026-07-17). COS status reports All Systems Operational. No code change was
required — the Plan 3 OAuth implementation was already correct.

**Still limited:** OSF allows only one OAuth callback URL per app (production is
registered), so localhost OAuth remains awkward without a separate dev app.

---

## Closed — OSF OAuth invalid_client (historical, 2026-05-23 → 2026-07-17)

<details>
<summary>Original symptom (collapsed)</summary>

OAuth sign-in returned CAS `UnauthorizedServiceException` or `invalid_client`
for client `3f59c94d4adf45e0a74a60478760114a`. App UI showed the developer app
as valid; CAS service registry was out of sync. Workaround was anonymous browse
via `OSF_APP_TOKEN` only.

</details>

---

## Vercel CLI v53 — `vercel env add NAME preview` requires git branch even with `--value --yes`

When setting environment variables for the **Preview** environment via CLI, even the exact command the CLI itself suggests (`vercel env add NAME preview --value V --yes`) fails with `git_branch_required`. Workaround: set Preview env vars via the dashboard at https://vercel.com/your-team/betterosf/settings/environment-variables.

Production + Development env-var sets work fine via CLI.

---

## OSF developer apps only allow one callback URL

OSF's OAuth app registration UI accepts a single Authorization callback URL. We registered the production callback. Local-dev OAuth (`http://localhost:4747/api/auth/callback/osf`) will fail until either:

- OSF supports multiple callback URLs per app (open feature request), or
- We register a separate dev OAuth app and switch env vars per environment.

Not currently blocking — local dev uses anonymous browsing only.

Note: if a dev OAuth app IS registered later, its callback must use port **4747**
(BetterOSF's local port — see the "Port 4747, never 3000" rule in `CLAUDE.md`).
OSF matches the callback URL exactly, so a mismatched port fails the OAuth
handshake with an opaque error.
