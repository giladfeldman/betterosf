# Known Issues

## OSF OAuth — `invalid_client` despite valid developer-app registration (open as of 2026-05-23)

**Symptom.** OAuth sign-in via `https://betterosf.vercel.app/login` redirects to OSF's `accounts.osf.io/oauth2/authorize?...`, which then returns either:

1. CAS error page:
   ```
   Error: UnauthorizedServiceException
   Message: Service is not found in service registry.
   ```
2. OAuth error page:
   ```
   invalid_client: 3f59c94d4adf45e0a74a60478760114a
   ```

The `client_id` echoed back IS our registered developer-app ID.

**What's verified working on our side.**

- Developer app exists at https://osf.io/settings/applications/ under name `BetterOSF`.
- Client ID `3f59c94d4adf45e0a74a60478760114a` matches the one in our env vars (verified in screenshot of the OSF dev-app detail page).
- Client Secret matches.
- Authorization callback URL is registered as `https://betterosf.vercel.app/api/auth/callback/osf` — byte-for-byte identical to what Auth.js v5 sends.
- Env vars are correctly set in Vercel (Production + Development) under `AUTH_OSF_ID`, `AUTH_OSF_SECRET`, `AUTH_SECRET`, `NEXTAUTH_URL`.
- The redirect URI in the error trace decodes to exactly the registered URL.
- AUTH_SECRET has a trailing `=` (base64 padding) — verified not the cause (it's only used to sign session JWTs locally; never sent to OSF).
- The Plan 3 code is correct (54 unit/integration tests + 9 E2E tests pass). The only thing broken is OSF's recognition of our `client_id`.

**Likely root cause.** OSF's CAS server (`accounts.osf.io`) uses a service registry that's supposed to auto-sync when a developer app is registered. For our account, that sync didn't fire (or was rolled back). The developer-app UI shows the app as valid, but CAS rejects it as an unknown service.

**Confirmed second OSF bug:** the **Delete** button on the developer-app detail page returns "An error has occurred" — making it impossible to delete and re-register.

**Workaround in production right now.** Anonymous browsing of public OSF projects works via the app-owned PAT (`OSF_APP_TOKEN` env var). Private-project access via user OAuth login is unavailable until COS resolves this.

**Resolution path.**

1. Email sent to COS support — see `docs/osf-support-email-2026-05-23.md`. Asking them to either:
   - Manually push our developer app to the CAS service registry, or
   - Allow us to delete + re-register so the registry sync re-fires.
2. **Once COS unsticks the account, no code changes needed** — Plan 3 OAuth code should "just work." Re-test by visiting `https://betterosf.vercel.app/me` → click "Sign in with OSF".
3. Fallback if COS can't fix it: rework Plan 3 to use "paste your OSF Personal Access Token" instead of OAuth. Each user generates a PAT at `osf.io/settings/tokens` and pastes into BetterOSF. Same end UX (private projects accessible), bypasses OSF OAuth entirely. This is what `osfclient`, `osfr`, and most OSF tooling does. Sketch of the rework lives in `docs/superpowers/specs/2026-05-23-betterosf-v1-design.md` §12 ("Open questions deferred").

---

## Vercel CLI v53 — `vercel env add NAME preview` requires git branch even with `--value --yes`

When setting environment variables for the **Preview** environment via CLI, even the exact command the CLI itself suggests (`vercel env add NAME preview --value V --yes`) fails with `git_branch_required`. Workaround: set Preview env vars via the dashboard at https://vercel.com/your-team/betterosf/settings/environment-variables.

Production + Development env-var sets work fine via CLI.

---

## OSF developer apps only allow one callback URL

OSF's OAuth app registration UI accepts a single Authorization callback URL. We registered the production callback. Local-dev OAuth (`http://localhost:3000/api/auth/callback/osf`) will fail until either:

- OSF supports multiple callback URLs per app (open feature request), or
- We register a separate dev OAuth app and switch env vars per environment.

Not currently blocking — local dev uses anonymous browsing only.
