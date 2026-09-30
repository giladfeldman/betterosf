# Local-first testing - full text (moved verbatim from CLAUDE.md)

## 🚨 LOCAL-FIRST TESTING — MANDATORY, NO EXCEPTIONS

**NEVER test exclusively against production deployment. ALWAYS run the full
local probe and ensure it is GREEN before any code reaches Vercel.**

This is the single most important rule for this project. It exists because
on 2026-05-26 a URL-decoding regression shipped to production after a
"deploy-and-pray" pass — the bug was reproducible locally in 30 seconds
but visual-qa was running only against prod, so the broken commit deployed
unchallenged. Production-only testing means every regression discovers
itself on the user's URLs after deploy.

### Required order before any `git push`

```bash
# 1. Static gates
npm test                           # vitest must be fully green (601 tests as of v1.6.0)
npx tsc --noEmit                   # type-check clean
npm run build                      # production build must succeed

# 2. Local prod server (npm run dev is BROKEN on this Next.js 15.5 build —
#    optional-catch-all route bug — so use the production server locally).
#    `npm start` pins port 4747 — see "Port 4747, never 3000" below.
npm start &
sleep 5

# 3. Hardened visual-qa against LOCALHOST (the strict gate)
node tests/visual/visual-qa.mjs --local
# Must exit 0. Any FAIL line means a real bug — fix it before pushing.

# 4. Stop the local server — kill ONLY BetterOSF's process, by port.
#    Do NOT use `taskkill //F //IM node.exe`: it kills every other project's
#    node processes too (dev servers, test runners, agents) and has already
#    caused mid-run casualties in a shared session.
#    Windows (PowerShell):
#      Get-NetTCPConnection -LocalPort 4747 -State Listen |
#        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
#    POSIX: kill $(lsof -ti :4747)

# 5. Only NOW: git push (Vercel auto-deploys)

# 6. After Vercel READY, optionally re-run visual-qa against the prod URL
node tests/visual/visual-qa.mjs   # defaults to prod
```

If any of steps 1–3 fails, **fix it locally and re-run.** Do not commit a
"WIP fix" intended to be patched after deploy.

### 🚨 Port 4747, never 3000

**BetterOSF binds `4747` locally. Port 3000 is banned.** `npm run dev`,
`npm start`, `playwright.config.ts`, `start_app.bat`, and `.env.example` all pin
4747; `visual-qa.mjs --local` resolves to `http://localhost:4747`.

Why this is a hard rule, not a preference: 3000 is the default for Next.js,
CRA, Express and most of the JS ecosystem, so on a machine running several
projects it is *routinely already taken by something else*. On 2026-08-04 a probe
of "BetterOSF on localhost:3000" actually reached a different project's server
and returned its HTML — which briefly read as a BetterOSF bug and sent the
investigation down a false path. A port collision doesn't fail loudly; it
returns a confident, wrong answer.

`tests/unit/dev-port.test.ts` enforces this: it scans the operational files
(package.json, playwright config, start_app.bat, .env.example, visual-qa,
tests/setup.ts, e2e smoke, CLAUDE.md, AGENTS.md, README.md) and **fails the
suite if `3000` reappears** in any of them. Historical records under
`docs/superpowers/**` are excluded on purpose — those document what past
sessions actually ran, and rewriting them would be dishonest.

When starting a local server, always confirm it is really *this* project before
trusting any result — `curl -s localhost:4747 | grep -o "<title>[^<]*</title>"`.

### Local-server gotchas (already-solved, listed so they're never re-debugged)

- **visual-qa exiting 1 with ZERO `✗` lines is an infrastructure problem, not a
  code regression.** The usual cause is a Playwright version bump leaving the
  browser binary missing — the error is `browserType.launch: Executable doesn't
  exist at …chrome-headless-shell.exe`. Fix with `npx playwright install chromium`
  and re-run. Always read the actual output before treating a non-zero exit as a
  product defect.

- **`npm run dev` is broken** on this Next.js 15.5 build because of the
  optional-catch-all route `/api/zip/[guid]/[provider]/[[...path]]/route.ts`.
  Workaround: `npm run build && npm start`. (When Next.js fixes this upstream,
  re-test `npm run dev` and update this note.)
- **Auth.js v5 throws `UntrustedHost`** on localhost unless `trustHost: true`
  is set in `src/auth.ts`. This is committed (see commit 5040629). If you
  ever see `[auth][error] UntrustedHost: Host must be trusted` flooding
  the local server log, that flag was removed — restore it.
- **Auth log noise**: `npm start` logs a long stack on every request when
  no session cookie is present (Auth.js complains, the OSF client swallows
  it). Don't mistake the noise for a bug; the requests still succeed.
- **Killing the server on Windows**: `taskkill //F //IM node.exe`. (POSIX:
  `kill $(jobs -p)` or `kill $SERVER_PID` if you captured it.)

### Why production-only smoke is insufficient

- visual-qa against prod runs ~3–5 minutes; against localhost ~90 seconds.
  The slow loop encourages cutting corners.
- Production has the previous deploy's caches + Vercel function readiness
  delays. A "fixed locally, deploy, see what happens" loop wastes a deploy
  per debug round and is impossible to bisect cleanly.
- Real user-facing pages on prod cache for 5 minutes (revalidate: 300),
  so a fresh broken deploy can briefly read as PASS while caches drain.
- Every prod-only round adds a "Co-Authored-By Claude" commit to the public
  branch even when the change is internally just a single-character fix.

### When local-first is allowed to be skipped

Only when the change literally cannot run locally:
- Changes that depend on Vercel's runtime env (KV, edge config) AND the
  local mock for that runtime doesn't exist.
- Vercel project-config changes (vercel.json, env-var changes).

For everything else — code under `src/`, tests, components, API routes —
local probes are mandatory.
