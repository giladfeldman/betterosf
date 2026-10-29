# BetterOSF

Alternative interface for the [Open Science Framework](https://osf.io). See [`docs/superpowers/specs/2026-05-23-betterosf-v1-design.md`](docs/superpowers/specs/2026-05-23-betterosf-v1-design.md) for the design.

**Production:** https://betterosf.vercel.app

## Development

    npm install
    cp .env.example .env.local   # fill in OSF_APP_TOKEN
    npm run dev

### Windows quick-launch

Double-click `start_app.bat` — it soft-kills anything on port 4747, runs `next dev -p 4747`, waits for the server, and opens your default browser to http://localhost:4747.

## Tests

    npm test          # unit + integration
    npm run test:e2e  # Playwright smoke (needs network)

Two suites are deliberately NOT part of `npm test`, CI, or `/ship`, because they act on
real services. Each is opt-in by environment variable:

    npm run test:destructive   # creates and deletes a throwaway OSF project
    npm run test:live-zenodo   # round-trips a real deposit on sandbox.zenodo.org

`test:live-zenodo` needs `BETTEROSF_LIVE_ZENODO=i-understand` and a
`ZENODO_SANDBOX_TOKEN` from a throwaway sandbox account. It refuses to run against
production Zenodo, never publishes (publishing mints a permanent DOI), and deletes the
drafts it creates.

## Deploy

Production deploys automatically on every push to `main` via the Vercel GitHub integration. To deploy manually:

    vercel deploy --prod

## v0.1.0 (Plan 1: Foundation + Anonymous Browsing) — what works

- Anonymous browsing of public OSF projects via `/<guid>`
- Project overview with un-truncated components / linked-projects / registrations
- Files tree across all storage providers
- Deep folder URLs (right-click → open in new tab works everywhere)
- ZIP download of any folder (proxied through WaterButler)
- Within-project search of top-level tree entries

## v0.2.0 (Plan 2: Whole-tree ZIP + Deep Search) — what's new

- One-click download of the whole project tree (root + every component + every linked project, across every storage provider) as one ZIP. Per-provider archives are nested as `<provider>.zip` inside the outer ZIP — unzip twice if needed. For a public project the archive is assembled **in your browser**, so the files go straight from OSF to your computer and never through BetterOSF's servers; private projects and any failure fall back to the server route (`/api/zip/<guid>`).
- A standalone [Zenodo folder-tree downloader](https://betterosf.vercel.app/tools/zenodo-download) at `/tools/zenodo-download`. Zenodo has no folders and renders file keys as long flat names; paste any public record and this rebuilds the tree the keys describe, checks every file against the checksum Zenodo publishes, and hands you one ZIP. No account needed, and it works for any deposit whose names contain paths — not only ones made with BetterOSF.
- A [licence check](https://betterosf.vercel.app/tools/licence-check) at `/tools/licence-check` (v1.13.0): every project and component you can reach with its licence status, plus a bulk "set one licence" for the ones you can write to (read back from OSF before it counts as confirmed; refused after OSF goes read-only on 2027-02-19). Each project's transition page also has a "where should this go?" guide, and the export ZIP carries `LICENSE.txt` (or `LICENCE-NOT-CHECKED.txt` when the lookup failed).
- Failures during the tree walk are logged into `_BETTEROSF_ERRORS.txt` at the ZIP root instead of aborting the download.
- Within-project search now has an "include collapsed folders" toggle that lazy-expands every folder client-side so the filter sees the whole tree.

## v0.3.0 (Plan 3: Auth + Dashboard) — what's new

- Sign in with OSF (OAuth, `osf.full_read` + `osf.full_write`, `access_type=offline`). Access + refresh tokens live in encrypted httpOnly session cookies. Signed-in bookmarks and view prefs sync to Neon Postgres in the EU (`aws-eu-central-1`); anonymous browsing stays public via the app token. BetterOSF renews the access token via the refresh token so sessions stay usable without hourly reconnects.
- `/me` dashboard listing your projects (including private ones).
- Private OSF projects you have access to are now browseable through BetterOSF.
- Anonymous browsing of public projects still works exactly as before.

## v0.4.0 (Plan 4: Discovery) — what's new

- Global `/search` page across projects / files / registrations / users — metadata-only (no full-text inside files).
- Type filter chips, real anchor links throughout, paginated, with result counts.
- New `/registrations/<guid>` page renders schema responses inline.
- Header now has a Search link.

## v0.5.0 (Plan 5: Public-launch polish) — what's new

- Per-IP rate limit (60 page navs/min) for anonymous traffic. Signed-in users unaffected.
- Whole-tree ZIP cap (5/hr per IP) for anonymous downloads.
- Daily app-token quota tracking; banner appears if BetterOSF is over its OSF API budget for the day.
- Privacy and About pages; footer links; mobile responsive sweep; focus-visible keyboard rings.

After this release, **provision Vercel KV** at https://vercel.com/your-team/betterosf/stores to enable persistent, cross-instance rate-limit counters. Until then the limits fall back to per-lambda-instance in-memory state — a real speed bump against a single runaway client on a single warm instance, but not a distributed control: it does not coordinate across concurrent instances and resets on every cold start or deploy. See `KNOWN_ISSUES.md` and `todo.md` for the exact provisioning steps.

## v0.6.0 (Plan 6: Navigator + Viewers + Dark Mode) — what's new

- **Unified tree navigator** on /files pages — multi-root (OSF Storage, other providers, Components, Linked projects, Registrations), all folders expanded by default, lazy file load, virtualized.
- **In-browser viewers for every common file format** — PDF (better than OSF's Google-Docs-viewer), DOCX (no conversion), XLSX, CSV, Markdown, code/text with syntax highlighting, JSON, images (including sanitized SVG), HTML, video, audio, Jupyter notebooks.
- **Dark / light / system theme toggle** in the header, persisted across sessions.
- **Right-click → "Open in new tab"** works on every link; clicking a file leaf in the tree opens inline in the same tab by default; folders + components + linked + registrations also stay in same tab.
- **Resizable split pane** on files pages (drag handle, width persisted).
- **Breadcrumbs always show parent context** — sticky at top of right pane, truncates with `…` for very deep paths, every segment a real anchor.

## v0.7.0 (Plan 7: Search overhaul + list controls) — what's new

- Google-style query syntax: AND (default between tokens), `OR` (uppercase), `"quoted phrases"`, `-exclusions`, parens for grouping.
- Help popover (`?` icon) next to the search box documenting syntax.
- Scope-restricted search: `/search?scope=user:me` (your projects) or `?scope=project:<guid>` (within a project's components/linked/registrations).
- Per-page-size selector (10/20/50/100/200/All, default 50) with sticky preference per surface.
- Sort and filter controls on every paginated list. State syncs to URL — share/refresh-safe.

## v0.8.0 (Plan 8: Favorites + Polish) — what's new

- **Pin** any project, file, or registration; **recently viewed** auto-tracked. Both surface on the landing page and your /me dashboard.
- **Pinned section** in the unified file tree shows your pins as the top root.
- **Compare two registrations** side-by-side at `/registrations/compare?a=<g1>&b=<g2>` — differences highlighted.
- **Citation export** in APA / MLA / Chicago / BibTeX / RIS with copy-to-clipboard, on every project page.
- **Print stylesheet** for archival snapshots — hides nav/footer, expands content, shows URLs after links.
- **Accessibility polish:** skip-to-content link, reduced-motion + high-contrast media queries, focus-visible rings everywhere.
- **Perf:** preconnect to `api.osf.io` + `files.osf.io` to speed up first contentful paint.

## v1.2.0 (Recursive ZIP upload + direct large-file uploads) — what's new

- **Upload a ZIP** tab in the upload dialog: pick a `.zip`, BetterOSF extracts its folder structure, shows the full tree for confirmation (per-file deselect, OS junk like `__MACOSX`/`.DS_Store` filtered), then recreates that exact hierarchy of folders + files inside the chosen OSF Storage folder — like pushing a directory.
- **Direct browser → OSF uploads for everything** (single files, dropped folders, ZIPs). File bytes `PUT` straight from the browser to OSF Waterbutler, bypassing Vercel's 4.5 MB serverless body limit — so uploads up to OSF's 5 GB/file work and **never silently fail**. ZIP entries are decompressed lazily (one at a time) so a multi-GB archive never sits fully in memory. The OSF access token is fetched on demand (`/api/osf/upload-token`), kept in memory only, pinned to `*.osf.io`, and cleared after each batch.
- **Hardened Content-Security-Policy:** the CSP is now enforced (not report-only) and built per-request in `src/middleware.ts` with a script `nonce` + `strict-dynamic` (no `'unsafe-inline'` for scripts on modern browsers). A tight `connect-src 'self' https://*.osf.io` ensures the in-browser upload token can only ever be sent to OSF.

## v1.2.1 (Upload reliability + recovery UX) — what's new

- **Clear, real error messages.** Upload/folder failures now show the *actual* OSF/server response (with HTTP status) instead of a generic "Upload failed" — client code reads the raw response body, so a rate-limit or server error is no longer masked.
- **Self-recovering uploads.** Directory uploads issue ~half as many OSF calls (no redundant per-file folder check) and honor `Retry-After` on a 429, so transient rate-limits retry and recover instead of failing the batch.
- **Live upload status + retry.** The dialog shows an `⤴ uploading…` row for the in-flight file and the real error inline per failed file, with a Retry.
- **Folder create gives feedback + refreshes.** Creating a folder now shows an explicit `✓ Created` (or the full error + a Retry) and the new folder appears immediately — no page reload.
- **⟳ Refresh button** in the file/directory navigator re-fetches every loaded folder from OSF, bypassing the cache (fixes stale listings after changes made elsewhere).

## v1.4.0 (Parent project UI + OSF session refresh) — what's new

- **Parent project** surfaced on component/child pages: breadcrumb `Home › Parent › Current`, Status aside link, and a top-of-navigator `Parent:` row (collapsed by default; expand loads the parent's files; click the label to open the parent).
- **OSF OAuth** now requests `access_type=offline` so BetterOSF gets a refresh token and can renew the ~1h access token without hourly "Reconnect needed". Existing sessions: click **Reconnect OSF once** after deploy.

## v1.3.0 (Navigator depth control + deep-review hardening) — what's new

- **"Levels" depth control in the file/folder navigator.** A stepper at the top
  of the tree sets how many folder levels to show under each storage root —
  default **1** (just the direct children of `osfstorage`). The tree only
  fetches and renders down to that depth, so opening a deep project no longer
  auto-drills every level and burns OSF API calls on folders you never look at.
  Raise it (1 … 5 … All), or click any folder at the limit to **drill just that
  branch** one level deeper without changing the global setting. The level is
  remembered per project; "Expand all" / "Directory" lift it to "All".
- **Explicit Show files / Hide files toggle** and a read-only **"N loaded"
  counter** (folder listings fetched from OSF this session) in the navigator
  toolbar, so the cost of expanding the tree is visible and controllable.
- **Deep-review hardening:** a full codebase audit (39 findings) landed alongside
  the navigator work — accessibility (keyboard tree navigation), correctness, and
  a flatter, forge-proof per-IP rate limit in middleware (the signed-in multiplier
  was removed; it could be spoofed without a verified session).

## v1.5.0 (Neon EU + synced bookmarks) — what's new

- Signed-in bookmarks and view prefs sync to Neon Postgres in the EU (`betterosf-eu`, `aws-eu-central-1`). JWT sessions still hold OSF tokens.
- Admin log viewer at `/admin/logs` (gated by `ADMIN_OSF_USER_IDS`).

## v1.5.1 (AWS SES admin digests) — what's new

- Admin error digests via AWS SES (`eu-west-1`), interim FROM `betterosf@scimeto.app`.
- Bounce/complaint webhook + suppression (`email_events`); daily cron at 08:00 UTC.
- Dedicated BetterOSF sending domain still deferred (see `todo.md`).

## v1.6.0 (File/folder deletion + local backups) — what's new

- **Delete files and folders from OSF Storage**, with a deliberately slow confirmation
  flow. OSF has no trash and no restore path, so deletion is permanent:
  - Folders are expanded first, so you see a real file count before consenting
  - A **verified backup is captured before any deletion**; an incomplete backup blocks it
  - A typed confirmation phrase is required — folders and bulk deletes also need a checkbox
  - Per-item outcomes are always reported (`deleted` / `already gone` / `failed`)
- **Local pre-delete backups** kept in your browser, with one-click restore of a copy.
  Capped at 20 backups / 500 MB, oldest evicted first (7-day grace).
- **Mandatory backup download** above 100 MB, above 100 files, when a folder is involved,
  or when browser storage is unavailable — browser storage can be evicted at any time.
- Deletion terms at `/terms`, also shown inline in the delete dialog; the typed
  confirmation is recorded as an electronic signature.
- Registrations remain immutable — no delete affordance anywhere.

## v1.9.0 (Transfer to Zenodo) — what's new

v1.8.0 got data *out* of OSF. This puts it somewhere it can keep living.

- **Choose a destination** at `/transition/[guid]`: download a verified archive, or
  transfer to **Zenodo**. Connect your own Zenodo account by OAuth; the deposit is yours,
  in your account, under your name.
- **Three independent checksum comparisons per file** — local↔OSF sha256, local↔OSF md5,
  and Zenodo↔local md5. What OSF says it holds is checked *before* anything is uploaded, so
  bytes that do not match are never pushed into an archive meant to outlive OSF.
- **A private draft, never published.** Publishing is a separate step behind a typed phrase
  the server re-derives from Zenodo's own listing of the draft, and BetterOSF refuses to
  publish a run that did not reconcile as complete.
- **Runs survive a closed tab.** The full record lives in your browser; the server takes
  coarse checkpoints so a run can be resumed, including on another device. A resumed file
  is skipped only when our recorded verification and Zenodo's current checksum agree.
- **Projects over Zenodo's 100-file / 50 GB per-record limit** become several linked
  records (DataCite `IsPartOf`) rather than zipped bundles, so per-file verification
  survives the split. The record count is shown before anything starts.
- Each record also receives the verification report, the link-crosswalk CSV, the RO-Crate
  description and the wikis OSF offers no export for.

Zenodo is configured per deployment (`ZENODO_ENV` plus that instance's OAuth credentials).
Where it is not configured, `/transition` still offers the verified local export and says
plainly that the destination is unavailable.

## v1.8.0 (OSF Transition Toolkit) — what's new

COS is winding OSF Projects down — no new projects from **2026-11-16**, everything
read-only from **2027-02-19**. Public projects stay online read-only indefinitely;
private-project removal is anticipated later. OSF offers no wiki export and no
cross-project view, so:

- **`/transition`** — an inventory of every project you can reach, with a recommendation
  and its reasons per project. Loads in two tiers so hundreds of projects are readable
  immediately. The default recommendation is **leave it alone**: a public project stays on
  OSF at the same URL and DOI, and mirroring it elsewhere mints a second DOI.
- **`/transition/[guid]`** — a checksum-verified export as a BagIt bag with RO-Crate
  metadata: files *plus* wikis, project metadata and contributors, with a SHA-256
  manifest, a link crosswalk CSV for repairing citations, and a disclaimer that travels
  inside the archive.
- **A Zenodo deposit client**, verified end to end against sandbox.zenodo.org.

File bytes go **browser → OSF** and **browser → Zenodo** directly, so no research data
passes through BetterOSF's servers at any project size.

An export is only reported as complete when every expected file is accounted for. Files
OSF supplies no checksum for — normal for Dropbox/Drive/S3 add-on storage — are reported
as *unverifiable*, never as verified, and are listed individually.

## v1.7.0 (Landing page, version badge, bug reports) — what's new

- **Informative landing page** explaining what BetterOSF does, how it works, and where your
  data goes. The two heavy example projects were removed — each cost dozens of OSF API
  calls to open, putting the most expensive request in the app one click from every
  first-time visitor.
- **Workspace table** on the homepage: recently-opened projects, files, and folders with
  when you last opened them, how often, and where they live. Sortable and filterable;
  stays in your browser.
- **Floating version badge** (bottom-right) showing the running build, doubling as the
  entry point to bug reporting.
- **Bug reports at `/feedback`** — no account needed, no email address required. Reports
  are stored in Neon (EU) and emailed to the maintainer; triaged at `/admin/feedback`.
- **Empty text files now say they're empty** instead of rendering a blank pane that looked
  like a crash. Text/code files show name, size, line and character counts.
- **Expired OSF sessions fail soft.** A 401 from OSF used to destroy the whole page with
  "Couldn't load this project"; deep file and folder pages now keep their tree and
  breadcrumb and offer a "Reconnect OSF" button.
- **Local dev moved to port 4747.** Port 3000 is banned and enforced by
  `tests/unit/dev-port.test.ts` — it collides with other local projects and once caused a
  probe to hit a different app's server entirely.

## Not yet — possible future work

- Full-text search inside file contents
- Cross-device favorites sync (pins/prefs sync for signed-in users; local backups stay local by design)
- Pool of multiple OSF app tokens for higher anonymous quota
- File move / copy (rename shipped in v1.6.1; upload and delete already supported)
