# OSF Transition Toolkit - full text (moved verbatim from CLAUDE.md)

## OSF Transition Toolkit (v1.8.0 export, v1.9.0 transfer) — what the app is FOR from here

COS is winding OSF Projects down: **2026-11-16** no new projects/components;
**2027-02-19** everything read-only, many API write functions deprecated. Public
projects stay online read-only; private-project removal is anticipated later with 12
months' notice. Registrations and preprints are unaffected.

**This means BetterOSF's upload / delete / rename features have no server to talk to
after 2027-02-19.** Export and migration are the point of the app from here.

### The CORS matrix decides the architecture — all measured, none assumed

| Host | CORS | Consequence |
|---|---|---|
| `files.osf.io` (Waterbutler) | `Range` + `Authorization` allowed, returns 206 | **File bytes go browser-direct.** No Vercel bandwidth at any size. |
| `zenodo.org` | `ACAO: *`, `authorization`, `PUT` on `/api/records` and `/api/files/{bucket}/{name}` | **Zenodo is the browser-direct target** — not figshare. |
| `api.osf.io` | **none at all** | Every metadata call must be proxied by us → enrichment is BATCHED. |
| figshare | no `Access-Control-Allow-Origin` | Browser-direct blocked; would need a byte-proxy. |
| Dataverse | per-instance. Re-probed 2026-10-29: Harvard, AUSSDA, demo allow `*` + `PUT` + `X-Dataverse-key`; DataverseNL sends no CORS; unimi allows one other origin | Cannot be offered generically; Harvard is now viable (`docs/licence-check-and-destinations.md`). |

Also verified against sandbox.zenodo.org: **slash-containing file keys work** (deposits
keep OSF folder structure; URL-encode the key in the request path), and **multipart
upload is live** with per-part URLs that **expire after 14 days**.

`docs/osf-exit-strategy.md` originally recommended the opposite (figshare first) because
it reasoned from docs and issue trackers. Re-probe before trusting any of this.

### Hard rules for this feature

- **Never let an unknown read as a fact.** A size we could not fetch is "not counted",
  never `0`. A failed add-on lookup is `null`, never `[]`. `/nodes/{id}/storage/` is
  contributor-only and its response shape is still **UNVERIFIED**.
- **`reconcile()` decides success, and refuses to call an empty run complete.** Nothing
  else may present an export as successful. "No errors" is not a result.
- **A file with no OSF checksum is `unverifiable`, never `verified`.** Add-on storage
  (Dropbox/Drive/S3/GitHub) is the normal case, and the report names those files.
- **Three independent hash comparisons**, not one: local↔OSF sha256, local↔OSF md5,
  destination↔local md5. The third alone proves nothing — a destination reports what IT
  stored, so it agrees with locally wrong bytes.
- **Do not reuse `capture.ts`'s `sha256()`** for transition files: it is whole-buffer and
  cannot hash a 5 GB file. Use `src/lib/transition/hash.ts` (streaming, `hash-wasm`).
- **ORCID is at `external_identity.ORCID`, not `social.orcid`**, and only a `VERIFIED`
  one may be asserted into a published record.
- **Licences are exact-match or `other` + verbatim text.** Never map "CC-BY-NC" toward
  "CC-BY" — that relicenses someone's data. `resource_type` is never inferred.
- **The recommendation default is "leave it".** Public projects stay on OSF at the same
  URL and DOI. A frictionless "migrate all" would duplicate content COS keeps online and
  split citation records at scale.
- **Cost is a hard constraint**: no paid tiers, no meaningful Vercel usage. If a design
  needs a paid tier it is the wrong design. IndexedDB is the primary ledger; Neon takes
  coarse batched checkpoints only.
- **`npm run test:live-zenodo` is sandbox-only, opt-in, and never publishes.** It is not
  in `npm test`, CI, or `/ship`. Same posture as `test:destructive`. Run it with
  `BETTEROSF_LIVE_ZENODO=i-understand` and `ZENODO_SANDBOX_TOKEN` exported — the config
  does not read `.env.local`, and without the token it SKIPS while still reporting green.

### Verified working end to end (2026-08-14, v1.11.1)

A 79-file / 145 MB project transferred to **production Zenodo** in a real user run: 80 of
100 file slots, every file checksum-verified, left as an unpublished draft. Four bugs stood
between the feature and that run — see `.claude/skills/_project/lessons.md` v1.10.x–v1.11.1
for each in full. Two of them are the same shape and must not recur:

- **`connect-src` in `src/middleware.ts` must list every origin the browser fetches.** The
  transfer shipped without zenodo.org in it, so the browser refused every request before it
  left the page and reported a bare `TypeError: NetworkError`. Pinned by
  `tests/unit/csp-connect-src.test.ts`.
- **A browser destination must be checked with a real preflight**, not a server-side
  request. `osf.io/download/<id>/` sends no CORS headers; `files.osf.io/...?direct=` does.
  Pinned by `tests/unit/waterbutler-download-url.test.ts`.

**Node's `fetch` ignores CORS and vitest/jsdom ignore CSP.** Neither can be caught by an
integration test, which is why both guards are static assertions about the policy and the
URL builder.

Also load-bearing, learned the same day:
- **A checksum outranks a content-type header.** OSF serves small text-ish files as
  `text/html` with their real contents; rejecting on the header failed 12 of 79 good files.
  The header is only fatal when there is no checksum to corroborate (add-on storage).
- **Staged files must survive until the archive is built.** `archiveEntries` holds a `Blob`
  per file and client-zip reads them at the END, so peak browser storage for a local export
  is the whole project — the preflight says so.
- **Zenodo's 100-file / 50 GB caps are PER RECORD**, not per account, and every draft
  carries a `quota_increase` link.

### v1.12.0 — destinations, components, archives, browser-direct ZIPs

All measured against live Zenodo / live OSF on 2026-08-14 before being written. Do not
re-derive; do re-probe before trusting any of it a year from now.

- **`metadata.publisher` is REQUIRED to publish.** Without it Zenodo returns 400
  `"Missing publisher field required for DOI registration."` The crosswalk had never set
  one, so **every publish would have failed** — invisible because creating and filling a
  draft works fine, and the only real user run stopped at the draft. `ZENODO_PUBLISHER`.
- **An open community review request BLOCKS `POST /draft/actions/publish`** ("You cannot
  publish a draft with an open review request"). Community and direct publish are
  alternative paths, not additive. `submit-review` returns 202 and does NOT publish — the
  record waits for a curator. A community is therefore a *request*, never a submission, and
  never touches the verdict.
- **`POST /records/{id}/versions` returns an EMPTY draft** that inherits the published
  record's metadata. **Never call `draft/actions/files-import`** — it copies the previous
  version's files, spending Zenodo file slots on bytes this run never checked.
- **`GET /records/{id}/draft` serves a LEGACY, LOSSY serialization by default.** Reading it
  and PUTting it back silently erased `publisher`, `description` and a relation, returning
  200. `Accept: application/vnd.inveniordm.v1+json` returns the real shape and round-trips
  losslessly. `appendRelatedIdentifiers` uses it and verifies the merge by reading back.
- **Never author metadata on a record BetterOSF did not create.** Shard linking appends
  related identifiers; it no longer replaces metadata. An existing draft or an inherited
  version carries curation that a fresh crosswalk would silently undo.
- **`/user/records` is a search index and it LAGS** — a draft created seconds earlier
  returned `total: 0`, and the same listing reported `files.count: 0` for a draft with a
  committed file. Fine for "pick one of your deposits"; **never seed a capacity plan from
  it** — ask `listDraftFileEntries`.
- **An export covers every node the user selected, and the report names them.** Components
  default ON, registrations and linked projects OFF. `components` / `registrations` /
  `linkedProjects` are `null` when the LOOKUP FAILED, never `[]` — the UI must not render
  "we could not find out" as "there are none".
- **A single-archive deposit is offered only when the deposit would otherwise shard**, only
  for a new record, and never by default. `reconcile()` takes a `container` argument that
  skips the per-file destination check, turns a failed container checksum into a blocker,
  and produces a **different summary sentence**. A container deposit's verdict must never
  read as equivalent to a per-file one.

### v1.13.0 - licence check and destination guide

Full write-up: `docs/licence-check-and-destinations.md`. Code: `src/lib/licence/check.ts`, `src/lib/osf/licences.ts`, `/api/licences`, `/api/licences/apply`.

- **Write scope is requested at the point of use**, not at sign-in; a user who only wants the report is never asked for write access.
- **Only the read-back decides "confirmed".** Each change is PATCHed, then the node is read again; a 200 on the PATCH alone is never shown as done.
- **The apply route refuses from 2027-02-19** (OSF read-only), so the UI cannot promise a write that has no server.
- **Bulk-select guard.** Only "No licence" and "Other" rows are tickable; "Select all" takes only "No licence" rows, because "Other" may carry custom text a bulk apply would replace.
- **`LICENCE-NOT-CHECKED.txt` in the ZIP means the lookup FAILED**, never "no licence". `LICENSE.txt` is written only when OSF asserts a real licence.
- **The destination guide never points pseudonymised data at Zenodo.**

### v1.14.0 - publish claim, alert environment

- **Publish claim.** `claimPublish` marks a job as publishing before the Zenodo call. A definite refusal (4xx) or a consent-recording failure calls `releasePublishClaim`, so the user can retry. An unknown outcome (network error, 5xx, timeout) KEEPS the claim: sending again could mint a second permanent DOI. `recordPublishedDoi` stores the DOI on success; a stored claim without a DOI reads "could not confirm whether this record was published". Records published before v1.14.0 have no DOI stored and therefore take that path on retry. The claim SQL is tested on real Postgres (PGlite, `tests/db/pglite.ts`).
- **Wiki file names** go through `safeNameSegment` with collision suffixes, like every other name crossing the boundary.
- **Alert environment.** `src/lib/alert-env.ts` is the single definition of where an event happened; the digest filters on it in SQL before its row cap.

### 🚨 Names crossing a boundary are sanitised in ONE place, both directions

`src/lib/paths/entry-path.ts` is the single definition. Two functions, and the difference
between them is load-bearing:

- **`safeEntryPath(path)`** — a PATH. Splits on `/` **and `\`**, drops traversal segments.
  For untrusted Zenodo keys, which may legitimately encode a path.
- **`safeNameSegment(name)`** — one NAME. `\` is an illegal character, **not** a separator.
  For OSF file and folder names, which are single segments by construction. Using
  `safeEntryPath` here turned `a\b.txt` into `a/b.txt` and invented a folder.

Measured 2026-08-14, on a throwaway project each time:

- **OSF rejects traversal** — `..` and `../escape.txt` as file names, and `..`, `a\b`,
  `we<ird>` as FOLDER names, all 400. A path segment cannot be poisoned.
- **OSF accepts, as FILE names**, `a\b.txt`, `CON`, `we<ird>.txt` and `trailing. ` (it strips
  the trailing space, keeps the dot). Each is unwritable or silently renamed on Windows.
- **Zenodo accepts and publishes** `..\windows-escape.txt` and `C:\Windows\evil.dll`
  verbatim; `../` cannot reach a published record (the content PUT 404s) but such an entry
  also cannot be deleted, which **bricks the draft**.

**Renaming is never silent.** `osfPath` on the plan file, `stored_as` in the crosswalk CSV,
and a report section listing every rename. A file is renamed, never dropped — dropping loses
data that genuinely exists.

### 🚨 The Waterbutler CORS quirk that makes anonymous browser-direct downloads possible

**Waterbutler emits `Access-Control-Allow-Origin` only when an `Authorization` header is
PRESENT — any value at all.** `Bearer x`, `Basic x`, even a bare `x`. No other allowed
header does it (not `X-Requested-With`, `Cache-Control`, `Range`, `X-CSRFToken`).
Anonymously it answers 200 with the real bytes and no ACAO, so the browser discards a
response the server was happy to send.

**It is not an authorization bypass and cannot become one**: on a PRIVATE file the same
placeholder still returns **403**, while a real token returns 200. Verified by creating a
throwaway private project, uploading three bytes, and probing all three ways.

`osfBrowserAuthHeader()` is the single place that knows this. Because the behaviour is
undocumented, **every browser-direct download path falls back to the server route on any
failure** — that fallback is what makes depending on the quirk safe, and it is why
`/api/zip/[guid]` and `/api/zip/[guid]/selection` are still there rather than deleted.
Private projects use the server route by design.

### The transfer leg (v1.9.0) — additional hard rules

- **`destinationExpected: true` is set on the transfer path and nowhere else.** It is what
  makes a Zenodo commit that returned no parseable checksum a FAILURE rather than a
  silently skipped third comparison. `tests/integration/transition-transfer.test.ts` pins
  it, and that test was verified by breaking the flag and watching it go red.
- **A resumed file is skipped only when BOTH halves agree**: our stored verification, and
  the checksum Zenodo reports for that key *now*. The stored result alone is a memory; the
  destination listing alone cannot say whether the bytes ever matched OSF.
- **The publish phrase is derived server-side, twice** — once for the dialog and again at
  the moment of publishing, from Zenodo's own listing of the draft. Never accept a file
  count from the client, and never let the client decide the phrase matched.
- **BetterOSF will not publish a run that did not reconcile as `complete`.** Not a
  technical limit — Zenodo would accept it. We decline to be the thing that made a
  permanent, citable record of a copy we know is missing files.
- **Over Zenodo's per-record caps, a deposit becomes several LINKED records** (DataCite
  `IsPartOf`), never archives-per-subtree (which would replace hundreds of per-file
  checksums with one checksum of a container OSF never held) and never Zenodo *versions*
  (which mean revisions of the same work). One file slot per record is reserved for the
  report bundle, hence `FILES_PER_RECORD = 99`.
- **`PUT /api/records/{id}/draft` must send `{metadata}` alone.** Echoing back the record
  object from the matching GET returns a **500** (measured 2026-08-13). Shard linking rides
  on this call; the live probe re-checks it.
- **The Zenodo token lives in a sealed httpOnly cookie**, AES-256-GCM under a key derived
  from `AUTH_SECRET`, bound to the OSF user id AND the environment, and handed to the
  browser only for a run. No refresh token is stored — Zenodo's tokens last ~60 days and an
  unexercisable refresh path guarding a deposit credential is worse than a reconnect.
- **The Zenodo OAuth redirect URI comes from `NEXT_PUBLIC_BASE_URL`, never the request
  Host.** Zenodo matches it exactly, and taking it from the request would let an attacker
  steer the code elsewhere.
- **The app must be a Confidential Zenodo client.** A Public one has no usable secret and
  fails with an opaque `invalid_client`. Check the client TYPE first, always.

### Two jsdom gaps that silently break byte-handling tests

Both measured on 2026-08-13, both polyfilled in `tests/setup.ts`. Neither exists in a
browser; both make correct code look broken (or worse, make broken code look fine):

- **jsdom's `Blob` has no `stream()`.** client-zip streams rather than buffering — that is
  what makes a multi-gigabyte export possible — and without the polyfill it took the wrong
  branch entirely.
- **`new TextEncoder().encode("x") instanceof Uint8Array` is FALSE**: `TextEncoder` comes
  from Node's realm, `Uint8Array` from jsdom's. Any `instanceof Uint8Array` check silently
  takes the wrong branch.
- Related, in tests only: **undici's `fetch` will not send a jsdom `Blob`** — it serialises
  as `"[object Blob]"`, so every checksum comparison fails while the code under test is
  correct. `tests/integration/transition-transfer.test.ts` hands it a Node `Blob` and says
  so at the mock.
