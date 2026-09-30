# Stack reminders, inherited rules, path conventions (moved verbatim from CLAUDE.md)

## Inherited rules from portfolio-wide `~/Vibe/CLAUDE.md`

- **Claude Max only — NEVER the Anthropic API.** All Claude model calls go
  through the Claude Max subscription via Claude Code (Agent tool, headless
  `claude -p`, or scheduled tasks). No `import anthropic` / API keys in
  scripts, hooks, or CI.
- **Read `todo.md` at session start** so you know what's deferred.
- **Per-skill backlog discovery via preflight heartbeats.**

## Stack reminders

- Next.js 15.5, React 19, Tailwind v4
- Tailwind dark mode is `class`-based; the `@custom-variant dark
  (&:where(.dark, .dark *))` directive in `src/styles/globals.css` is what
  makes `darkMode: "class"` work in v4 — DO NOT remove it
- next-themes toggles `class="dark"` on `<html>`
- Server components everywhere; client components only where state/effects
  require it (UnifiedTree, ThemeToggle, SplitPane)
- Auth.js v5 with OSF OAuth provider
- Vercel-deployed; Neon Postgres in EU (`betterosf-eu`, `aws-eu-central-1`) for
  users / bookmarks / prefs / admin logs / `email_events`; JWT sessions still
  hold OSF tokens. Vercel KV not yet provisioned (in-memory rate-limit fallback)
- **AWS SES (`eu-west-1`)** for admin digests — interim FROM
  `betterosf@scimeto.app` (scimeto.app already verified). Env:
  `AWS_SES_*`, `EMAIL_FROM_ADDRESS`, `EMAIL_CONFIG_SET`, `SNS_TOPIC_ARN`,
  `CRON_SECRET`, `ADMIN_NOTIFY_EMAIL`. Webhook `/api/email/webhook`; cron
  `/api/cron/admin-error-digest`. Dedicated BetterOSF domain later (see `todo.md`).
  **Feedback arrives ONLY as configuration-set events, which say `eventType`, not the
  identity-level `notificationType`** — dispatch on `msg.notificationType ?? msg.eventType`,
  and never let an unmatched SNS message return silently (v1.12.1; keys never values in the
  trace — the payload carries recipient addresses)
- **Content-Security-Policy is enforced and built per-request in
  `src/middleware.ts`** (script `nonce` + `strict-dynamic`, `connect-src 'self'
  https://*.osf.io`), NOT in `next.config.ts`. The root layout reads `x-nonce`
  from `headers()` and passes it to `<ThemeProvider nonce={…}>` so next-themes'
  inline script isn't blocked. `script-src` keeps `'wasm-unsafe-eval'` for the
  Shiki code viewer. Don't move CSP back to next.config or drop the nonce wiring.
- **File uploads go DIRECT browser → OSF Waterbutler** (`src/lib/upload/direct.ts`),
  bypassing Vercel's 4.5 MB serverless body limit (so GB files work). The token
  is fetched from `/api/osf/upload-token` (auth-gated), held in memory only, and
  pinned to `*.osf.io` via `src/lib/osf/waterbutler-url.ts` (shared by server
  `write.ts` and the client). Folder list/create stay on the server routes. The
  ZIP-upload tab extracts an archive into the same `DroppedNode[]` tree the
  drag-drop pipeline uses (`src/lib/upload/zip.ts`, lazy per-file decompression).

## File-system / path conventions

- Catch-all route segments (`[...path]`) in Next.js 15 arrive
  URL-ENCODED — always `decodeURIComponent(seg)` before matching against
  OSF API response names. See `src/app/[guid]/files/[...path]/page.tsx`
  and `[guid]/files/view/[...path]/page.tsx` for the canonical safe-decode
  pattern; `tests/integration/path-encoding.test.ts` locks it in.
- Use the `safeDecode` helper (try/catch around decodeURIComponent) to
  degrade gracefully on malformed escapes.


## Documentation locations

- Per-project lessons: `.claude/skills/_project/lessons.md`
- Project skills: `.claude/skills/betterosf-{qa,review,cleanup,deploy}/`
- Deferred work: `todo.md`
- Known external blockers: `KNOWN_ISSUES.md`
