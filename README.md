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

- One-click download of the whole project tree (root + every component + every linked project, across every storage provider) as a streamed ZIP via `/api/zip/<guid>`. Per-provider archives are nested as `<provider>.zip` inside the outer ZIP — unzip twice if needed.
- Failures during the tree walk are logged into `_BETTEROSF_ERRORS.txt` at the ZIP root instead of aborting the download.
- Within-project search now has an "include collapsed folders" toggle that lazy-expands every folder client-side so the filter sees the whole tree.

## v0.3.0 (Plan 3: Auth + Dashboard) — what's new

- Sign in with OSF (OAuth, `osf.full_read` + `osf.full_write`, `access_type=offline`). Access + refresh tokens live in encrypted httpOnly session cookies — no database. BetterOSF renews the access token via the refresh token so sessions stay usable without hourly reconnects.
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

After this release, **provision Vercel KV** at https://vercel.com/your-team/betterosf/stores to enable persistent rate-limit counters across edge regions. Until then the limits work per-instance with in-memory state (still safe — just less aggressive about persistence).

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

## Not yet — possible future work

- Full-text search inside file contents
- Cross-device favorites sync (currently localStorage only)
- Pool of multiple OSF app tokens for higher anonymous quota
