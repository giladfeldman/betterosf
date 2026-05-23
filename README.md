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

- Sign in with OSF (OAuth, read-only `osf.full_read` scope). Tokens live in encrypted httpOnly session cookies — no database.
- `/me` dashboard listing your projects (including private ones).
- Private OSF projects you have access to are now browseable through BetterOSF.
- Anonymous browsing of public projects still works exactly as before.

## v0.4.0 (Plan 4: Discovery) — what's new

- Global `/search` page across projects / files / registrations / users — metadata-only (no full-text inside files).
- Type filter chips, real anchor links throughout, paginated, with result counts.
- New `/registrations/<guid>` page renders schema responses inline.
- Header now has a Search link.

## Not yet — coming in subsequent plans

- Rate-limit + abuse caps + public-launch polish (Plan 5)
