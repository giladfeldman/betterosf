# BetterOSF

Alternative interface for the [Open Science Framework](https://osf.io). See [`docs/superpowers/specs/2026-05-23-betterosf-v1-design.md`](docs/superpowers/specs/2026-05-23-betterosf-v1-design.md) for the design.

## Development

    npm install
    cp .env.example .env.local   # fill in OSF_APP_TOKEN
    npm run dev

## Tests

    npm test          # unit + integration
    npm run test:e2e  # Playwright smoke (needs network)
