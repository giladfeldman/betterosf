# BetterOSF

A faster, friendlier interface for the [Open Science Framework](https://osf.io) (OSF), and a
toolkit for getting your work out of it.

**Live:** <https://betterosf.vercel.app> · **Licence:** [AGPL-3.0](LICENSE) · **Changes:** [CHANGELOG.md](CHANGELOG.md)

> **Status.** The Center for Open Science is winding OSF Projects down: no new projects from
> 2026-11-16 and everything read-only from 2027-02-19 (the dates the app itself uses are in
> [`src/lib/transition/deadlines.ts`](src/lib/transition/deadlines.ts)). BetterOSF's focus is
> therefore **export and migration**, with the browsing features kept for as long as OSF is up.

BetterOSF is an independent project. It is not affiliated with, or endorsed by, the Center for
Open Science.

## What it does

**Browse** (no account needed for public projects)
- Project overview with complete component, linked-project and registration lists.
- A tree navigator across all storage providers, deep-linkable folders, and in-browser viewers
  for PDF, DOCX, XLSX, CSV, Markdown, code, JSON, images, HTML, video, audio and notebooks.
- Search across projects, files, registrations and users, with `AND` / `OR` / `"phrases"` / `-exclusions`.
- Whole-project ZIP download, side-by-side registration comparison, citation export
  (APA, MLA, Chicago, BibTeX, RIS), pins and recently-viewed.

**Transition toolkit** (`/transition`)
- An inventory of every project you can reach, with a recommendation per project. The default
  recommendation is "leave it": a public project stays on OSF at the same URL and DOI.
- A checksum-verified export (BagIt bag with RO-Crate metadata, wikis, contributors and a link
  crosswalk). A file OSF supplies no checksum for is reported as *unverifiable*, never as verified.
- Transfer to your own Zenodo account as a private draft. Publishing is a separate, explicit step.
- A [licence check](https://betterosf.vercel.app/tools/licence-check) with a bulk "set one licence".
- A [Zenodo folder-tree downloader](https://betterosf.vercel.app/tools/zenodo-download) that works
  for any record whose file names contain paths.
- File bytes go browser → OSF and browser → Zenodo directly; research data does not pass through
  BetterOSF's servers.

**Signed in with OSF**
- Private projects, bookmarks that sync across devices, and write actions: upload (including ZIP
  and folders), create folder, rename, move, and delete.
- Deletion is permanent on OSF (no trash). BetterOSF requires a verified backup first and a typed
  confirmation; see [Known issues](KNOWN_ISSUES.md) and
  [`docs/engineering/deletion-rules.md`](docs/engineering/deletion-rules.md).

## Privacy

Anonymous browsing keeps only short-lived rate-limit counters and preferences stored in your own
browser. Signing in additionally stores your OSF user id, display name, email (if OSF provides
one), bookmarks and view preferences in a Postgres database in the EU. OSF access tokens are not
written to the database; they live in encrypted, httpOnly session cookies. Full text: [`/privacy`](https://betterosf.vercel.app/privacy).

## Run it locally

Requires Node.js and npm.

```bash
npm install
cp .env.example .env.local     # then fill in the values you need (see below)
npm run build
npm start                      # http://localhost:4747
```

Use the production build. `npm run dev` does not work on this Next.js version (details in
[`docs/engineering/local-first-testing.md`](docs/engineering/local-first-testing.md)). The port is
fixed at **4747** because OSF OAuth matches the callback URL exactly. On Windows, `start_app.bat`
does the same thing and opens the browser.

### Configuration

All variables are documented in [`.env.example`](.env.example). What you need depends on what you use:

| To use | Set |
|---|---|
| Anonymous browsing | `OSF_APP_TOKEN` (an OSF personal access token) |
| Sign in with OSF | `AUTH_OSF_ID`, `AUTH_OSF_SECRET` (your own OSF OAuth app), `AUTH_SECRET`, `DATABASE_URL` (Postgres) |
| Zenodo transfer | `ZENODO_ENV` plus that instance's OAuth client id and secret |
| Admin digests and bug-report email | AWS SES variables and `CRON_SECRET` |

Register your own OSF and Zenodo OAuth applications; credentials are never shared between
deployments, and nothing secret belongs in the repository.

## Tests

```bash
npm test                              # unit + integration (vitest)
npx tsc --noEmit                      # type-check
node tests/visual/visual-qa.mjs --local   # visual and behaviour probe against the local server
npm run test:e2e                      # Playwright smoke (needs network)
```

Two suites are deliberately **not** part of `npm test` or CI, because they act on real services.
Each is opt-in by environment variable and refuses to run without it:

```bash
npm run test:destructive   # creates and deletes a throwaway OSF project
npm run test:live-zenodo   # round-trips a draft deposit on sandbox.zenodo.org
```

Both need a token from a **throwaway account**. `test:live-zenodo` refuses to run against
production Zenodo and never publishes.

## Deploying

The app is built for Vercel (Next.js 15, Auth.js v5, Neon Postgres). Pushes to `main` deploy
through the Vercel GitHub integration; a daily cron hits `/api/cron/admin-error-digest`
(see [`vercel.json`](vercel.json)). The SES setup scripts are in [`scripts/aws/`](scripts/aws/RUNBOOK.md).

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md): what changed in each release.
- [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md): limits and external blockers.
- [`docs/engineering/`](docs/engineering): the rules the code relies on (deletion safety,
  local-first testing, transition-toolkit invariants, stack conventions).
- [`docs/licence-check-and-destinations.md`](docs/licence-check-and-destinations.md): design notes
  for the licence check and the "where should this go?" guide.
- [`SECURITY.md`](SECURITY.md): how to report a vulnerability.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run `npm test`,
`npx tsc --noEmit` and `npm run build`. By contributing you agree that your contribution is
licensed under the AGPL-3.0, like the rest of the project.

## Licence

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you run a modified copy as
a network service, the AGPL requires you to offer its source to that service's users.
