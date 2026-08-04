# Changelog

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
