# Changelog

## 1.9.0 — 2026-08-13

**The transfer leg.** v1.8.0 shipped the half that gets data *out* of OSF (a verified
export to disk). This is the half that puts it somewhere it can keep living: a signed-in
researcher can now pick Zenodo as the destination, connect their own Zenodo account, and
have every file transferred with the **same three-way checksum verification** — ending in
a reconciliation verdict and a private **draft** that BetterOSF never publishes on its own.

### Added
- **Zenodo transfer** (`src/lib/transition/run-transfer.ts`). Files go browser → Zenodo
  directly; no research byte touches Vercel at any size. Each file is staged, hashed,
  checked against OSF's own checksums **before** it is uploaded, committed, then verified
  a second time against the checksum Zenodo reports for what it stored. This is the only
  path that sets `destinationExpected: true`, which makes a commit with no parseable
  checksum a **failure** rather than a skipped check.
- **Zenodo OAuth** (`/api/zenodo/oauth/start`, `/callback`, `/session`, `/token`). The
  access token is sealed with AES-256-GCM into an httpOnly cookie bound to the OSF user
  and the Zenodo environment, and handed to the browser only for the duration of a run —
  the same posture as `/api/osf/upload-token`. No refresh token is stored: Zenodo's tokens
  last ~60 days, and an untestable refresh path guarding a deposit credential is worse
  than a two-click reconnect.
- **Splitting large deposits across linked records.** A project over Zenodo's 100-file /
  50 GB per-record limit becomes several records tied together with DataCite
  `IsPartOf` — *not* archives (which would replace hundreds of per-file checksums with one
  checksum of a container OSF never held) and never Zenodo *versions* (which mean
  revisions of the same work). The count is shown in the preflight, before anything starts.
- **A durable ledger, so a run survives a closed tab.** IndexedDB is primary and written
  per file; Neon (`transition_jobs`, `transition_items`) takes coarse batched checkpoints
  roughly every 25 files or 30 seconds, which is what lets a run resume on another device.
  A resumed file is skipped **only** when our stored verification and Zenodo's *current*
  checksum agree — a stored "it was verified" is a memory, not a measurement.
- **Publishing, behind a phrase the server re-derives** (`/api/transition/publish`). The
  file count in the phrase comes from Zenodo's own listing of the draft at the moment of
  publishing, so a draft that changed under an open dialog no longer matches. Consent is
  recorded *before* the act. A run that did not reconcile as `complete` cannot be published
  from BetterOSF at all.
- **A report bundle deposited on every record** — the verification report, the crosswalk
  CSV, the RO-Crate description, the disclaimer, and the wikis and project metadata OSF
  offers no export for. Its own success is reported separately and never folded into the
  data verdict.
- **Screen Wake Lock** during long runs, with the UI saying plainly when the browser does
  not support it rather than implying the run is protected.
- **The licence OSF asserts** is now read (`?embed=license`) and carried into the deposit,
  exactly matched or kept as verbatim custom text — never mapped to a neighbouring licence.
- **Zenodo's resource-type vocabulary** (all 43 ids, copied from the live endpoint) offered
  as an explicit choice. Never inferred from OSF's category; `npm run test:live-zenodo`
  re-checks every id against the service.

### Fixed
- **Export was broken for everyone who signed in through `/transition`.** `ExportRunner`
  asked `/api/osf/upload-token`, which requires `session.osfCanWrite`, while the transition
  gate signs users in with **read-only** scope on purpose. Those users got a 403 the moment
  they pressed Start — on the headline feature of v1.8.0. New consent-gated
  `/api/transition/osf-token` returns the token a read-only session already has, and a test
  fails if any transition surface reaches for the write-scoped route again.
- **A critical regression test was load-flaky.** The 401-consistency probe pays for
  compiling a route's module graph inside the default 5 s budget and timed out under a full
  parallel run while passing in 155 ms alone. Given an explicit 20 s budget: a flaky
  regression test is worse than a slow one, because the next person re-runs it and moves on.

### Found by review, before shipping
Three second-model reviews (Codex and Sonnet, 2026-08-13) found six real defects in the new
code. Each was **reproduced against the unfixed code first**, and each fix has a test that
was watched going from red to green:
- A resumed run reused a stored verification for a file that had been **edited on OSF**
  between attempts — same id, same path, same length, different bytes. The fast path now
  also requires OSF's current checksums to match the ones we hashed last time.
- A Zenodo listing that could not be fetched left `destinationKeys` null and every other
  condition passing, so the run reported **COMPLETE** with the independent check skipped.
  `reconcile()` grew `blockers` — checks that did not *run*, as distinct from checks that
  failed — and refuses to call such a run complete.
- The **crosswalk CSV** printed `verified` for a file that another file had overwritten at
  the destination. Report rows are now keyed by OSF's immutable file id rather than by path
  (the rule the module already stated), and a collided file is reported as `overwritten`.
- A replayed publish request called Zenodo again. The publish is now **claimed in the
  database first**, so a second request is refused by us rather than by behaviour at Zenodo
  we have never measured.
- A publish whose draft had lost files since the run is refused (`draft_shrank`).
- A non-numeric `expiresAt` in the sealed cookie read as "never expires", because
  `NaN <= now` is false.

The publish route's own docstring was also corrected: `job.status` is a client checkpoint,
so "only a complete run may publish" is a safety interlock against an accidental publish,
**not** an authorisation control. Overstating it in a comment is the same defect class the
module exists to prevent.

### Database
`drizzle/0004_transition_jobs_items.sql` and `0005_transition_published_records.sql` were
**applied to production Neon on 2026-08-13** and verified present. Do not re-apply. Both are
additive: two new tables, three indexes, two foreign keys, one column.

### Testing
- `runTransfer` is tested end to end against a fake Zenodo that **hashes the bytes it
  receives** rather than echoing a checksum it was handed, with the real deposit client in
  the loop. The `destinationExpected` guard and the publish guards were each verified by
  breaking the code they guard and watching the tests go red.
- Two jsdom gaps that silently break byte-handling code are now polyfilled in
  `tests/setup.ts` and documented there: `Blob.prototype.stream` is absent, and
  `TextEncoder` returns a foreign-realm `Uint8Array` so `instanceof Uint8Array` is false.

## 1.8.0 — 2026-08-13

**The OSF Transition Toolkit.** On 2026-08-13 the Center for Open Science announced
that OSF Projects is being wound down: no new projects or components from
**2026-11-16**, and every project — public and private — becomes **read-only on
2027-02-19**, with many API write functions deprecated. Public projects stay online
read-only indefinitely; COS has said it anticipates removing private projects later,
with 12 months' notice. Registrations and preprints are unaffected.

OSF offers no wiki export, no cross-project view, and only per-folder "Download as
Zip". This release is BetterOSF's answer to that.

### Added
- **`/transition` — an inventory of every project you can reach**, with a computed
  recommendation per project and the reasons behind it. Loads in two tiers so hundreds
  of projects are readable in seconds, then enriches (DOI, wikis, add-ons, size) in
  batches behind a progress line. A row that has not been checked says so; it never
  shows a blank or a zero that would read as a fact.
- **`/transition/[guid]` — a complete, checksum-verified export** as a BagIt bag with
  RO-Crate metadata: files *plus* wikis, project metadata and contributors. Includes a
  SHA-256 manifest, `Payload-Oxum`, the full report, an `osf-to-destination.csv`
  crosswalk for repairing links in papers and READMEs, and a `DISCLAIMER.txt` that
  travels with the data.
- **OSF readers for everything BetterOSF could not previously see**: wikis (content
  and version history), comments, activity logs, contributors with ORCID, identifiers,
  institutions, add-ons, per-file version history, and node storage.
- **A Zenodo deposit client**, verified end to end against sandbox.zenodo.org, with a
  guarded live round-trip test (`npm run test:live-zenodo` — sandbox only, opt-in,
  never publishes, cleans up after itself).
- **Transition terms and a consent gate.** `src/lib/terms.ts` now has three clause
  groups (general / delete / transition) and eight new transition clauses. Consent is
  recorded per terms version in a new `transition_consents` table; no transition API
  route serves an unconsented caller.

### Changed
- **Sign-in for the transition toolkit asks for READ-ONLY OSF scope.** Export never
  writes to OSF, so requesting write would be over-permissioned.
- **`FileEntry` now carries OSF's `md5`/`sha256`.** They were being parsed away.
  Absence is preserved as `null` — that is what marks a file `unverifiable` instead of
  pretending it was checked.
- **`/terms` renders all three clause groups** with continuous numbering and
  per-clause anchors.

### Fixed
- **`DeleteDialog` selected its clickwrap clauses by heading text**, using a filter
  that silently drops unmatched entries. Rewording a heading would have rendered the
  dialog a clause short while still collecting the typed confirmation — a consent
  record for terms the user never saw. Clauses now have stable ids and `clausesByIds`
  throws on an unknown one.
- **`npm run lint` was already failing on `main`** (4 warnings against
  `--max-warnings 0`, in files unrelated to this work). Fixed rather than suppressed.

### Corrected
- **`docs/osf-exit-strategy.md` §1 and the matching `todo.md` entry were backwards.**
  They recommended building against figshare first because Zenodo's CORS was believed
  broken. Live probes on 2026-08-13 found the opposite: **Zenodo works browser-direct**
  (`ACAO: *`, `authorization` allowed, `PUT` on both `/api/records` and
  `/api/files/{bucket}/{name}`), while **figshare sends no `Access-Control-Allow-Origin`
  header at all**. Both documents now record the measurement and why the original call
  was wrong — it came from documentation and issue trackers rather than a request.

### Verified by live probe, not assumed
- Waterbutler allows `Range` + `Authorization` from a browser origin and returns 206,
  so downloads are genuinely resumable client-side.
- `api.osf.io` sends **no CORS headers at all**, so metadata must be proxied — which is
  why inventory enrichment is batched (~25× fewer function invocations).
- Zenodo accepts `/` in file keys, so deposits keep OSF's folder structure.
- Zenodo multipart upload is **live**, with per-part URLs that **expire after 14 days**.
- ORCID lives at `external_identity.ORCID`, not `social.orcid` — a 50-user sample found
  zero users with the latter set. Only VERIFIED ORCIDs are asserted.

### Notes
- No research bytes pass through Vercel: browser ↔ Waterbutler and browser ↔ Zenodo,
  both direct. A 200 GB migration costs no server bandwidth.
- The recommendation engine's default is **do nothing**. Public projects stay on OSF at
  the same URL and DOI; mirroring them elsewhere mints a second DOI and splits the
  citation record.

## 1.7.1 — 2026-08-04

Backlog reconciliation: everything in `todo.md` that could be done in-session was
done, and what remains is now split into "blocked on you" vs "deferred by choice"
at the top of that file rather than buried in 300 lines of history.

### Fixed
- **`/api/files/[guid]/folder` mapped an expired OSF token to a 500.** This route is
  called on *every* tree expand, and the tree renders its message verbatim — so a
  signed-in user with an expired token saw "Could not load this folder. Please try
  again later.", advice that can never succeed because retrying does not renew a
  token. New shared `src/lib/osf/error-response.ts` maps 401/403/429/502 honestly
  across the folder, skeleton and all-files routes; unknown errors still 500 so real
  bugs stay loud.

### Changed
- **Citations are no longer fetched during overview render.** Measured **9 → 5 OSF
  calls per overview (44% fewer)**. `CitationExport` now loads from
  `/api/osf/citation/<guid>` on click, so the page paints sooner and is materially
  less likely to trip OSF's rate limit.
- **`/feedback` reachable from the footer**, and the admin menu now links the
  Feedback inbox alongside Logs.
- **"My projects" in the user menu** — a signed-in shortcut to
  `/search?scope=user:me`, which previously required knowing the query string.
- **`drizzle/meta` snapshot resynced.** `drizzle-kit generate` previously emitted a
  `CREATE TABLE email_events` for a table that already exists in production, which
  would have failed if applied; it now reports "No schema changes, nothing to
  migrate".
- **`betterosf-qa/SKILL.md` trimmed** 382 → 335 lines by extracting
  `references/destructive-gates.md`. Every safety-critical rule is pinned by a test,
  so the trim provably dropped nothing.

### Notes
- Two backlog items ("registration file-view breadcrumb", "per-registration expand
  state") turned out to be **already implemented** — the entries were stale. Both are
  now pinned by tests rather than simply ticked off.

## 1.7.0 — 2026-08-04

### Fixed
- **Deep file/folder pages no longer die on an expired OSF session.** OSF returns HTTP 401
  for an expired token, which mapped to `OsfError("unauthorized")` — a code absent from
  every deep-path walk's catch list, so it rethrew into the route error boundary and
  replaced the whole page with "Couldn't load this project". Affected only signed-in
  users; an anonymous request sends no bearer token and can never produce a 401, which is
  why anonymous QA never caught it. Pages now keep their tree and breadcrumb and offer a
  **Reconnect OSF** action (`src/lib/osf/walk-failure.ts`, `osfBackpressureKind`).
- **Empty text files rendered a blank pane** indistinguishable from a crash. A 0-byte file
  produced zero visible characters via Shiki. Text/code files now show name, size, line
  and character counts, and an empty or whitespace-only file says so explicitly.
- **"Upload pending" replaced** with actionable copy: per-file status reads "ready to
  upload" and the batch button reads "Upload 3 files" / "Upload remaining 2".

### Added
- **Informative landing page** — what it does, how it works, where your data goes.
- **Workspace table** with last-opened time, visit count and location; sortable/filterable.
- **Floating version badge** (bottom-right) sourced from `package.json` via
  `src/lib/version.ts`; doubles as the bug-report entry point.
- **Bug reports** — `/feedback` (anonymous allowed), stored in `bug_reports` (Neon EU),
  emailed to `ADMIN_NOTIFY_EMAIL` via SES from `betterosf@scimeto.app`, triaged at
  `/admin/feedback`.
- **Visit statistics** on recents (`lastViewed`, `visits`, `pinnedAt`), all optional so
  entries from older builds render "—" rather than a fabricated 1970 date.

### Changed
- **Removed the Many Labs 2 / RPP example links** from the anonymous homepage. Each costs
  dozens of OSF API calls to open, which put the app's most expensive request one click
  from every first-time visitor.
- **Local dev port moved 3000 → 4747.** `npm run dev` / `npm start` pin it; visual-qa
  gained `--local`. Port 3000 is banned and enforced repo-wide by
  `tests/unit/dev-port.test.ts`.
- `betterosf-cleanup` gained **Phase 4.5**: user-facing copy must match shipped features,
  verified in both directions on every run.

### Security
- **Protocol-relative URL smuggling in bug reports** (found by cross-model review).
  `//evil.example/x` starts with `/` but resolves to a different origin, so an anonymous
  reporter could plant a phishing link that rendered as a trusted clickable link in the
  admin inbox. Now rejected at intake (`//`, `/\`, `\/`, `\\`), absolute URLs are
  host-allowlisted, and the admin UI re-validates independently because rows stored
  before the fix remain in the database.
- Removed the blanket `taskkill //F //IM node.exe` from the pre-approved command list — it
  killed every other project's node processes.

## 1.6.0 — 2026-08-03

### Added
- **File and folder deletion from OSF Storage**, with deliberate multi-stage confirmation.
  Deletion is irreversible — OSF has no trash and no restore path — so the flow is built
  to make an accidental deletion structurally difficult:
  - Folders are expanded first, so you always see a real file count before consenting
  - A **verified backup is captured before any deletion**, and an incomplete backup
    hard-blocks the delete
  - A typed confirmation phrase is required; folders and bulk deletes additionally
    require an acknowledgement checkbox
  - Per-item outcomes are always reported (`deleted` / `already gone` / `failed`),
    never one opaque status
- **Local pre-delete backups** stored in the browser (IndexedDB), with one-click restore
  of a copy. Capped at 20 backups / 500 MB, oldest evicted first, with a 7-day grace floor.
- **Mandatory backup download** above 100 MB, above 100 files, when a folder is involved,
  or when browser storage is unavailable or too full.
- `/terms` — deletion terms, also shown inline in the delete dialog. The typed
  confirmation is recorded as an electronic signature.
- Restore path reuses the existing upload pipeline (`zipToDroppedNodes` → `runUploadPlan`).

### Security
- Registrations cannot be deleted: `resolveDeleteUrl` pins the target to
  `https://api.osf.io/v2/nodes/`. Registration and node Waterbutler URLs are
  origin-identical, so this pin — not the UI `readOnly` prop — is the real boundary.
- OSF Storage **roots cannot be deleted**. The query string is stripped before the path is
  inspected, so a client cannot smuggle `?confirm_delete=1` (which makes Waterbutler
  recursively wipe every file in the provider).
- Deletion runs server-side, not direct-from-browser. Unlike uploads there is no
  body-size benefit to justify exposing the OSF token to a destructive flow.
- Consent is re-validated on the server: the expected phrase is re-derived and a mismatch
  is rejected, so the audit record is evidence rather than a client assertion.
- Per-user delete rate caps (300/min, 2000/day) charged by item count, since signed-in
  requests bypass middleware rate limiting.

### Fixed
- Privacy notice corrected: it previously stated file contents are never cached, which the
  local backup feature makes untrue. Now discloses the IndexedDB backup store explicitly.

### Internal
- `makeIO` extracted from `UploadDialog` to `src/lib/upload/http-io.ts`, shared by uploads
  and restore so both behave identically.
- `logEventAwaited` added for records that must be durable before the next action runs.

## 1.5.1 — 2026-07-18

### Added
- AWS SES transactional email (`eu-west-1`) with interim FROM `betterosf@scimeto.app`
- `email_events` table for send idempotency + bounce/complaint suppression
- SNS webhook at `/api/email/webhook` (TopicArn allowlisted via `SNS_TOPIC_ARN`)
- Daily admin error digest cron (`0 8 * * *` → `/api/cron/admin-error-digest`)
- Admin test send at `/api/email/test` (session admin + recipient allowlist)

### Security
- SNS TopicArn allowlist before subscription confirm / event insert
- Idempotency claims released on SES failure (no burned keys)
- Digest path uses `sendEmail` (suppression + daily idempotency)

## 1.5.0 — 2026-07-17

### Added
- Neon Postgres EU (`betterosf-eu`, `aws-eu-central-1`) for users / bookmarks / prefs / admin logs
- `/api/me/bookmarks`, `/api/me/prefs`, `/admin/logs`
- AWS SES bootstrap scripts under `scripts/aws/`
