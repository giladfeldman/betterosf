# BetterOSF

Alternative interface for the [Open Science Framework](https://osf.io). See [`docs/superpowers/specs/2026-05-23-betterosf-v1-design.md`](docs/superpowers/specs/2026-05-23-betterosf-v1-design.md) for the design.

## Development

    npm install
    cp .env.example .env.local   # fill in OSF_APP_TOKEN
    npm run dev

## Tests

    npm test          # unit + integration
    npm run test:e2e  # Playwright smoke (needs network)

## v0.1.0 (Plan 1: Foundation + Anonymous Browsing) — what works

- Anonymous browsing of public OSF projects via `/<guid>`
- Project overview with un-truncated components / linked-projects / registrations
- Files tree across all storage providers
- Deep folder URLs (right-click → open in new tab works everywhere)
- ZIP download of any folder (proxied through WaterButler)
- Within-project search of top-level tree entries

## Not yet — coming in subsequent plans

- Whole-project ZIP (Plan 2)
- OSF OAuth login + private projects + `/me` dashboard (Plan 3)
- Global search page + registration detail (Plan 4)
- Rate-limit + abuse caps + public-launch polish (Plan 5)
