# Changelog

## 1.14.2 — 2026-10-30

The repository is now public, under the AGPL-3.0. Documentation and hygiene release; the one
behaviour change is the admin test-email route.

### Added
- `LICENSE` (AGPL-3.0-only), `SECURITY.md` (private vulnerability reporting), and a rewritten,
  shorter `README.md`; the About page states the licence.
- `docs/engineering/`: the deletion, local-first testing, transition-toolkit and stack rules the
  code relies on, now part of the public documentation.
- `scripts/public-hygiene.mjs` (also run by `npm test`): fails if a maintainer-local file is
  tracked, or if the published tree contains an unknown e-mail address, a local path, a cloud
  account number, a deployment id or a secret-shaped string.

### Changed
- The admin test-email route (`/api/email/test`) allows only the addresses configured in
  `ADMIN_NOTIFY_EMAIL` and `NEXT_PUBLIC_ADMIN_EMAIL` (plus the SES simulator) instead of a
  hard-coded list. Covered by `tests/integration/email-test-route.test.ts`.
- `package.json` carries a real description, licence, repository and keywords.
- Maintainer-local files (assistant configuration, working notes, plans) are no longer tracked.

## 1.14.1 — 2026-10-30

### Fixed
- **A project deleted on OSF now says so.** OSF answers HTTP 410 for a deleted project; BetterOSF
  turned that into a 502 "try again", which could never succeed. The API now returns 410 with
  code `osf_deleted` ("This was deleted on OSF, so there is nothing left to read."), and the
  OSF client maps 410 to the same `not_found` error code as 404, so every page's not-found
  path handles it.
- **The export page drops a deleted project from the saved project list.** The list kept in
  this browser is a snapshot that is never refreshed silently; when OSF confirms a project is
  gone, that one row is removed (and the page says so), so it stops being offered. The list's
  stale-snapshot note now also mentions deleted projects.

### Security
- Bumped `next` from `^15.5.18` to `^15.5.28` (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r,
  GHSA-673q-mjm6-r5xr).

## 1.14.0 — 2026-10-29

### Added
- **Move a file or folder** to another folder of the same project's OSF Storage. Gated exactly
  like Rename and Delete (fails closed without verified write access; never offered on
  registrations). The destination is derived server-side and pinned to this project's OSF
  Storage; a name clash moves nothing (`conflict=warn`). The picker goes one folder per click.
- **Local signed-in probe**, `npm run test:signed-in`. Mints a session for a throwaway OSF
  account, creates and deletes its own private project, and walks deep pages, the 401 path,
  licence check and Move end to end. There is no test route in the app. Not part of `npm test`.
- **OSF circuit breaker** (per server instance): 5 consecutive upstream failures fail fast for
  30 s; an anonymous 429 is remembered until its Retry-After.
- **Admin alerts record where they happened.** Every log event stores the deployment
  environment (`_env`, from the platform marker, never `NODE_ENV`). Only production events are
  emailed. Non-production emails go out only with `ALERT_EMAILS_NON_PRODUCTION=1`, and then the
  subject starts `[LOCAL TEST - NOT PRODUCTION]`.
- `.vercel/project.json` is now tracked (project and org ids only) so the CLI cannot create a
  duplicate Vercel project.
- Test infrastructure: PGlite (real Postgres in-process) for SQL tests, used for the publish
  claim and the admin digest.

### Fixed
- **MLA citations were silently empty since launch.** The citation route asked OSF for the
  style `mla`, which is a 404 on OSF (`mla.csl is not a known style`). It now requests OSF's
  real id, `modern-language-association-8th-edition`. Caught by the new signed-in probe.
- **The citation panel reports OSF failures honestly**: 401 says "sign in again", other failures
  carry the real status code, errors are never cached, and a signed-in success is `private`.
- **A signed-in user's private file reached the viewer as OSF's sign-in page.** The download
  proxy now keeps the user's token across OSF's redirects (sent to OSF hosts only), those
  bytes are never publicly cached (`private, no-store`), and a stale token falls back to an
  anonymous fetch so public files still open.
- **Zenodo publish retry.** A definite Zenodo refusal (4xx) or a failure to record consent now
  releases the publish claim so the user can retry. An unknown outcome keeps the claim and tells
  the user to check Zenodo before retrying. The DOI is recorded on success. **Note:** records
  published before v1.14.0 have no DOI stored, so retrying one now reads "could not confirm
  whether this record was published" instead of "already published".
- **Wiki page file names** in export and transfer go through the shared `safeNameSegment`
  sanitiser, with collision handling.
- **OSF timeouts answer 504 "OSF is slow to respond right now."** (was 500) on the zip,
  manifest and wiki routes.
- **Search no longer says "no matches" for a walk it did not finish.** When the file walk was
  capped or a folder failed, it says "Not every file was searched".
- **The daily admin digest filters by environment in SQL before its row cap**, so a noisy local
  session can no longer push production errors out of the window.
- **Feedback rate limit**: signed-in reporters get their own 10/hour budget; anonymous keep the
  per-IP cap; a 100/hour per-IP ceiling applies to both.

### Changed
- The project file walk lists folders in parallel (at most 3 at a time).

### Removed
- The orphaned `/api/files/[guid]/all` route (nothing called it).

## 1.13.0 — 2026-10-29

### Added
- **Licence check** (`/tools/licence-check`). Lists every OSF project and component the
  signed-in user can reach with its licence status (Licensed / No licence / "Other" /
  Couldn't check), one OSF call per 100 projects. Users with write permission can set one
  licence on many projects at once (CC BY 4.0 preselected); each change is PATCHed, then
  read back, and only the read-back marks it confirmed. Write access is requested at the
  point of use; the apply route refuses from 2027-02-19, when OSF goes read-only.
  Bulk-select guard: only "No licence" and "Other" rows are tickable (a row that already has a
  real licence cannot be overwritten), and "Select all" takes only "No licence" rows, because
  "Other" may carry custom licence text a bulk apply would replace.
  Background: Siepe, Heck & Quintana (psyarxiv 4rjg3).
- **"Where should this go?" guide** on each project's transition page: three questions
  (pseudonymised data? mainly code? by hand?) → one suggested destination following Lakens
  (2026-08), with steps for Zenodo, DataverseNL, institutional repositories, Harvard
  Dataverse, ResearchBox and GitHub. Pseudonymised data is never pointed at Zenodo.
- **`LICENSE.txt` in the export ZIP** when OSF asserts a real licence: name, copyright
  line, and OSF's stored licence text (none for "No license" / "Other"). When the licence
  lookup FAILED the ZIP carries `LICENCE-NOT-CHECKED.txt` instead, so a failed lookup is never
  mistaken for "no licence".

## 1.12.1 — 2026-08-27

### Fixed
- **🚨 Every bounce and complaint SES sent us was silently discarded.** SES speaks two
  shapes for the same event: identity-level notifications say `notificationType`, and
  configuration-set EVENT DESTINATIONS say `eventType`. This handler only ever knew the
  first, and BetterOSF is wired entirely through the second — `ses-events-betterosf-config`
  → topic `ses-events-betterosf` → `/api/email/webhook`, with no identity-level bounce topic
  on the sending identity. So 100% of real bounces matched no branch, returned
  `{ inserted: 0 }` and answered HTTP 200; SNS recorded a successful delivery each time.
  Measured before the fix: 10 `sent` rows, **0 bounce, 0 complaint**. Same defect and same
  fix as Metaventory v0.7.20.
- **The miss was silent, which was the worse half of the bug.** An SNS notification that
  matches no branch — or a `Message` body that is not JSON — now leaves a trace naming the
  event type and the message's top-level KEYS (never values: the payload carries recipient
  addresses). A `KNOWINGLY_IGNORED_EVENTS` set keeps "ignored on purpose"
  (Delivery/Send/Reject/Open/Click/Rendering Failure/DeliveryDelay/Subscription) visibly
  distinct from "never seen before". The trace is awaited, not fire-and-forget — a floating
  insert dies with the serverless instance, which is the same failure being fixed.
- Operational logs gained an `email` type, and `/admin/logs` now offers every `LogType` in
  its filter (`delete`, `rename`, `transition` and `email` were all missing) — a log nobody
  can filter for is most of the value of writing it thrown away.


## 1.12.0 — 2026-08-14

The five agreed-but-unbuilt items carried over from 1.11.1, plus a bug the probing for
them uncovered. Everything below rests on measurements taken against live Zenodo and live
OSF before any of it was written — the last five releases in this project were all
"assumed instead of measured", and it stopped being a coincidence.

### Fixed
- **🚨 An export could contain file names the researcher's computer cannot write.** OSF
  accepts names a filesystem does not — measured on a throwaway project, `a\b.txt`, `CON`,
  `we<ird>.txt` and `trailing. ` are all stored verbatim and listed back. Left alone,
  `a\b.txt` silently becomes a folder on Windows extraction and `CON` cannot be created at
  all, so a report could say `verified` for a file that is not on disk. Names are now made
  safe on the way out as well as the way in, from one shared module, and **every rename is
  reported** — a new `stored_as` column in the crosswalk beside OSF's own `osf_path`, plus a
  report section listing each one. Files are renamed, never dropped.
  (Traversal was checked and is *not* reachable: OSF rejects `..` in file and folder names.)
- **A rate limit from OSF was reported as a server error.** `/api/zip/[guid]/manifest`
  collapsed every OSF failure into a 502, so a transient 429 read as "the upstream broke" —
  and the browser-direct button's fallback then re-ran the *expensive* server route,
  answering OSF's request to slow down with more load. It now uses the shared error mapper
  (429 with `Retry-After`, 404 for a missing project, 500 only for our own bugs), and the
  button shows the wait rather than falling back. Caught by a post-deploy behaviour probe.
- **🚨 The browser-direct migration lost a rate limit.** `/api/zip/[guid]` caps anonymous
  callers at 5/IP/hour; its replacement `/api/zip/[guid]/manifest` shipped with none. It
  returns a few KB of JSON, but producing it walks up to 500 nodes — roughly 1000 OSF
  requests per call, made with BetterOSF's **own app token** when the caller is anonymous.
  Uncapped it was an amplifier against OSF under a shared credential and a hole in exactly
  the function budget this work exists to protect. Now capped on the *same key*, so a caller
  cannot take 5 server ZIPs and unlimited manifests.
- **`package-lock.json` had been stuck at 1.7.1 since v1.7.1** — five releases of version
  bumps edited `package.json` alone. `npm ci` is the only gate that compares them, and it
  fails outright when they disagree; nothing else notices. Synced, and the lockfile is now
  part of a version bump.
- **🚨 The Zenodo folder-tree downloader had a Zip Slip.** It passed each record's file key
  straight into a ZIP entry name, and a key is whatever the depositor uploaded. Established
  by publishing a record for each case on sandbox rather than by reasoning about it:
  - **`..\windows-escape.txt` and `C:\Windows\evil.dll` upload, commit and PUBLISH**, and
    appear verbatim on the public record. Many Windows unzippers treat a backslash in an
    entry name as a separator, so that escapes the extraction directory.
  - `CON`, `dir/NUL.txt`, `a<b>c"d|e?f*g.txt` and `trailing. ` all publish fine too, and are
    each unusable or silently renamed on Windows.
  - `../` traversal, by contrast, **cannot** reach a published record: Zenodo accepts the
    declare but 404s the content upload, so the file never completes and the draft will not
    publish. (It also cannot be deleted — declaring one bricks the draft.)

  `zipEntryPath()` now neutralises all of it — *neutralise, never drop*, so the folder
  structure the page exists to rebuild survives intact — and every name it had to change is
  listed in the UI and in `ZENODO-MANIFEST.txt`, so nothing is renamed silently. Found while
  answering "how do I test this?"; six tests were watched failing against the raw-key version.
- **🚨 Every publish would have failed with an opaque 400.** Zenodo refuses to mint a DOI
  without `metadata.publisher`, and the crosswalk never set one:
  `{"field":"metadata.publisher","messages":["Missing publisher field required for DOI
  registration."]}`. Nothing caught it because creating and filling a draft works fine
  without it — the only real user run stopped at the draft, so the publish leg had never
  been exercised end to end. Found by probing `POST /versions`, not by looking for it.
  The same draft with `publisher: "Zenodo"` published with 202.

### Added
- **Three Zenodo destinations instead of one.** Every transfer used to create a new record.
  - *A draft you already have.* BetterOSF adds files to it and **does not author its
    metadata** — whatever you curated there stays. The per-record file cap is seeded from
    what the draft actually holds (read from `listDraftFileEntries`, never from the search
    listing, which reported `files.count: 0` for a draft with a committed file), and a
    draft with no room left is refused before anything uploads.
  - *A new version of something you published.* `POST /records/{id}/versions` returns an
    **empty** draft that inherits the record's metadata. BetterOSF deliberately never calls
    `files-import`: this run uploads its own verified copy, and importing the old version's
    files would spend file slots on bytes nothing checked. Offered only behind an explicit
    "this is the same work" acknowledgement, because a Zenodo version is a revision, not a
    sequel.
  - *A community.* Attaching one creates a submission **request**, which BetterOSF never
    sends — a curator decides, and a refusal says nothing about whether the files copied.
    The measured consequence is carried into the UI: **an open review request blocks direct
    publishing** ("You cannot publish a draft with an open review request"), so the publish
    panel explains that instead of offering a button that 400s.
- **Components and linked registrations travel with an export.** An export covered ONE
  node, silently — a project with six components exported as a copy of a seventh of itself,
  and `reconcile()` called it complete because it reconciles against a plan that never
  mentioned them. The preflight now lists the component tree, registrations and linked
  projects with checkboxes. **Components default ON** (same project, same fate);
  registrations and linked projects default OFF, with the reason next to each. Files nest
  under `components/<guid>-<title>/`, every file records the node it came from, and the
  report opens with a table naming every node the export covers.
- **A single-archive Zenodo deposit, offered only where it is a real choice.** Past
  Zenodo's 100-file cap a deposit becomes several linked records — and several DOIs for one
  dataset. "One archive, one DOI" is now offered *at that point and nowhere else*, never as
  a default. Every file is still downloaded and checked against OSF's checksums before it
  goes in, a failing file is left OUT, and every digest is written into `MANIFEST.tsv`
  inside the archive and into the crosswalk CSV. What it costs is stated in the checkbox,
  in the record description, and in the verdict's own wording: **Zenodo holds one checksum,
  for a container OSF never had.**
- **A Zenodo → folder-tree downloader at `/tools/zenodo-download`.** Zenodo has no folders;
  it stores each key verbatim and its UI renders them as long flat filenames. This rebuilds
  the tree from the keys, verifies every file against the checksum Zenodo publishes, and
  refuses to include one that does not match. Public, standalone, no account at either end —
  it works for any deposit whose names contain paths, not just ours.

### Changed
- **Whole-project and selected-items ZIPs are assembled in the browser.** They used to
  fetch every byte server-side and stream it through a Vercel function, so bandwidth equalled
  project size — the one real cost risk if the app goes public. The browser now fetches one
  Waterbutler `?zip=` archive per (node, provider) and nests them with `client-zip`, byte for
  byte the same output. It also removes the 4.5 MB serverless response ceiling.
  - This works **anonymously**, which looked impossible at first: Waterbutler sends no
    `Access-Control-Allow-Origin` on an anonymous request, so the browser discards a
    response it was perfectly willing to serve. It emits CORS headers whenever an
    `Authorization` header is *present*, whatever its value — and on a private file that
    same placeholder is still **403**, so it flips the CORS branch and nothing else.
  - Undocumented, therefore never depended on: **every direct path falls back to the server
    route** if it fails, and private projects use the server route by design.
- **The landing page now says what actually shipped.** It described neither the Zenodo
  transfer's destination options nor the folder-tree downloader, and still said BetterOSF
  "streams downloads through to you" — which understates the current behaviour: downloading a
  public project, exporting one, and transferring one to Zenodo now all move the bytes
  directly between the browser and OSF, never through our servers.
- **One definition for how a whole-tree ZIP names its folders** (`src/lib/zip/tree-naming.ts`).
  The archive has two producers — the server route and the browser assembler — and they must
  agree, because the browser silently falls back to the server and a researcher is never told
  which built their archive. The helpers had been copied rather than shared, and had already
  drifted within one session: the partial-failure report carried a different header on each
  side. Both now import one module, pinned by `tests/unit/zip-tree-naming.test.ts`.
- The crosswalk CSV gained `osf_node_guid` / `osf_node_url`. It used to stamp the root
  project's guid on every row, which became wrong the moment an export could span components —
  and this is the file researchers use to repair links in papers.

## 1.11.1 — 2026-08-14

### Fixed
- **🚨 Our own Content-Security-Policy was blocking every request to Zenodo.**
  `connect-src` read `'self' https://*.osf.io` — Zenodo was never added when the transfer
  shipped in v1.9.0 — so the browser refused each fetch to zenodo.org *before it left the
  page*. A CSP block surfaces to JavaScript as a bare
  `TypeError: NetworkError when attempting to fetch resource`, naming neither the policy
  nor the host, and appears in the console only. That is why it read as a network problem
  through two rounds of investigation: the OSF half kept working (`*.osf.io` was allowed),
  the OAuth redirect kept working (a navigation, not a fetch), and Zenodo's own CORS was
  measured clean throughout.
  - Both Zenodo origins are listed **explicitly**, never `https://*.zenodo.org`, which
    would authorise the browser to send a deposit credential to any subdomain. Multipart
    part-upload URLs were measured to be on the same host, so large files are covered.
  - A test now fails if either origin is dropped, verified by restoring the old line and
    watching it go red.
  - The reachability check tells the user to look for a CSP block in the console and report
    it as a BetterOSF bug — the one cause the app itself can create, and the one I could not
    distinguish from a blocking extension.

## 1.11.0 — 2026-08-14

### Added
- **The transfer keeps a run log too.** The export gained one in 1.10.4 and it turned the
  next bug report into a ten-minute diagnosis; the transfer had none, so a Zenodo failure
  said only `TypeError: NetworkError when attempting to fetch resource` — no host, no call,
  no file. Every Zenodo call is now labelled (`zenodo: createDraft (record 1 of 1) —
  FAILED`), shown on both the success and failure screens, downloadable and copyable.
- **A reachability check before anything is created in your Zenodo account.** It separates
  the three causes that need three different responses: *unreachable* (the request never
  completed — a privacy extension, VPN or proxy, or Zenodo down), *rejected* (Zenodo
  answered no — reconnect), and fine. Previously the first sign of trouble was a
  `NetworkError` at file 1 of 79, with drafts already littering the account.
- **Download and transfer are no longer either/or.** After a verified download you are
  offered the Zenodo transfer; after a transfer you are offered the local archive. They
  answer different questions — one is a copy you hold, the other is a citable location that
  outlives OSF — and the radio button implied choosing one ruled out the other.

### Fixed
- **The Zenodo OAuth round trip no longer forgets what you chose.** Connecting sends the
  browser to zenodo.org and back, remounting the page — which reset the destination to
  "download", so you had to re-pick "Transfer to Zenodo" having just granted the permission
  that only makes sense if you meant it. The choice is now carried in the URL.

## 1.10.5 — 2026-08-14

### Fixed
- **🚨 12 of 79 files were failed for a header OSF got wrong.** The export rejected any
  response typed `text/html` as "an error page rather than file content" — and OSF serves
  small text-ish files (`.bib`, `.Rmd`, several `.docx`) as `text/html; charset=UTF-8`
  **with their real, complete bytes**. Measured 2026-08-14: every failure in a real 79-file
  export was under ~82 KB, every success over ~160 KB, and `grateful-refs.bib` came back as
  `text/html` containing exactly the BibTeX it should, at exactly its declared size.
  - A content type is the **server's claim about** the bytes; a checksum is a statement
    **about the bytes themselves**. The checksum now decides: when OSF's own published hash
    matches what arrived, the content is provably right and the header is provably wrong,
    and the run records both rather than discarding the file.
  - **The protection is not weakened where it was actually needed.** With no checksum to
    fall back on — add-on storage (Dropbox, Drive, S3, GitHub), which publishes none — a
    suspect content type stays fatal, because it is then the only signal there is. A file
    whose bytes do not match OSF's checksum still fails regardless of its header.
  - The check also moved from fetch time to verify time, since it can only be judged once
    the bytes exist and can be hashed.

## 1.10.4 — 2026-08-14

### Fixed
- **🚨 The export deleted every file before it packaged them.** This is what the
  `AbortError` was, and it has been there since v1.8.0. Each staged file's `Blob` was
  pushed into the archive list and the backing storage deleted **immediately afterwards**,
  under a comment claiming "peak disk stays at one file". But the ZIP is assembled at the
  *end*, and that is when those Blobs are read — by which point every one of them was
  dangling. Firefox reports reading a deleted file as `AbortError: The operation was
  aborted`, naming neither the cause nor a file, which is why two rounds of fixes aimed at
  the network missed it. Staged files now live until the archive exists, and are cleared
  together afterwards.
  - **The honest consequence, now stated in the preflight:** a local export uses browser
    storage equal to the whole project, not one file at a time. The old comment described a
    property the code did not have.

### Added
- **A run log.** Every step — file, position, phase, retry attempt, duration, and the exact
  error name and message — recorded as the run goes, shown on both the success and failure
  screens, and downloadable or copyable in one click. It is kept in an array the *caller*
  owns, so it survives even a run that throws, which is exactly when it is needed.
  `AbortError: The operation was aborted` becomes `stage [48] osfstorage/big.csv (attempt
  3): Download failed — AbortError: …`.
- **The failure message now names the last thing the run did**, e.g. *Failed during
  "package" on osfstorage/x.csv*, instead of only repeating the exception.
- **The error title matches what failed.** An export that died mid-run was headed "Could
  not read this project", which sends people to look in entirely the wrong place; it now
  says "The export did not finish" and offers a route back to the preflight rather than a
  reload.

## 1.10.3 — 2026-08-14

### Fixed
- **An export that was cut short threw away everything it had already verified.** A 79-file
  run reached ~60% and died with `AbortError: The operation was aborted` — an hour of
  downloading and checksumming lost, with no list of which files had been fine. That
  contradicted the module's own stated contract ("a file that fails is recorded and the run
  CONTINUES"); a torn-down connection was the one path that ignored it. Now the run
  packages what completed, reconciles it as **incomplete**, names the file it stopped at,
  and distinguishes *you pressed Stop* from *the connection dropped*.
- **A dropped download is retried** (3 attempts, backing off) before the file is given up
  on. Seventy-nine long-lived connections to OSF means one of them dropping is ordinary,
  not exceptional. Deliberately narrow: a checksum or size mismatch is **not** retried,
  because retrying cannot change it and would only take three times as long to reach the
  same honest failure.

### Added
- **You can choose where the archive is saved.** Where the browser supports it (Chrome,
  Edge) the button opens a save dialog and streams the archive straight into the file you
  pick. Firefox and Safari have no such API, so they get the ordinary download — and the UI
  now says which of the two will happen *before* you press it, rather than leaving "it
  downloaded, but where?" to be discovered afterwards.
- **The progress text no longer misleads about where files go.** It said files were
  "downloaded straight from OSF to your computer", which read as *files are appearing in my
  Downloads folder*. They are held in the browser's private storage while the archive is
  built — nothing reaches Downloads until you save at the end — and it now says exactly that.

## 1.10.2 — 2026-08-14

### Fixed
- **🚨 The export downloaded nothing. Every file, every project, since v1.8.0.** A 79-file
  export reported `0 of 79 verified; 79 failed`, each with *"NetworkError when attempting to
  fetch resource"*. The browser was fetching OSF's `links.download`
  (`https://osf.io/download/<id>/`), and **that host sends no CORS headers at all** — a
  `fetch` carrying `Authorization` triggers a preflight, the preflight fails, and no request
  ever leaves the tab.

  Why it survived a "verified CORS matrix": every *other* consumer of that URL is
  server-side (the ZIP route, the download proxy), where CORS does not exist — and the
  matrix itself was measured with a server-side client, which cannot observe CORS either.
  **Node's `fetch` ignores CORS entirely, so a probe run in Node can only ever confirm that
  a URL responds, never that a browser may use it.**

  Measured against the real hosts on 2026-08-14:
  | URL | Preflight | Result |
  |---|---|---|
  | `osf.io/download/<id>/` | `ACAO: null` | blocked outright |
  | `files.osf.io/v1/resources/…` | `ACAO: <origin>`, allows `Range`, `Authorization` | **302 → `storage.googleapis.com`, which sends no CORS headers** — the redirect fails too |
  | `files.osf.io/v1/resources/…?direct=` | `ACAO: <origin>` | streams the bytes, no redirect ✓ |

  The plan now builds `?direct=` Waterbutler URLs. A file OSF describes without a provider
  or path gets an empty URL and **fails loudly** rather than being dropped from a plan that
  would then look complete.
- **A resumed download is restarted rather than trusted.** Waterbutler's `?direct=` answers
  a ranged request with `200` and no `Content-Range`. The bytes really are the requested
  range — verified by comparing them against the whole file — but a server that does not say
  so cannot be taken at its word, and appending on a guess yields a file of the right length
  with the wrong contents. `checkRangeResponse` already refused it; it claimed "the transfer
  restarts instead" while the code actually threw. Now it restarts, so that sentence is true.

## 1.10.1 — 2026-08-14

### Fixed
- **Signing in with OSF failed after you approved it**, landing on a black
  *"Server error — There is a problem with the server configuration. Check the server logs"*
  box. Nothing was misconfigured: `error=Configuration` is Auth.js's catch-all for **any**
  server-side failure during the callback. The Vercel log said only
  `Error: OSF userinfo failed: 401` — the code exchange succeeded, then `api.osf.io`
  rejected the token OSF had just issued, and the thrown error discarded everything that
  would explain which of the several possible causes it was.
  - The provider now **distinguishes the causes**: an exchange that returned no
    `access_token` is reported as a BetterOSF bug rather than as an OSF 401 (previously it
    sent `Bearer undefined` and blamed the user's OSF account), and a real refusal is logged
    with the status, scope, token *length*, and OSF's response body. The token itself is
    never logged.
  - It **retries once on 401**, because OSF's API is eventually consistent and a token
    `accounts.osf.io` minted a second ago can briefly not exist as far as `api.osf.io` is
    concerned. When a retry rescues a sign-in it says so loudly in the log — "it works if
    you try twice" is a finding, not a fix.
  - **Ruled out by probe, so nobody re-derives it:** the OSF OAuth application and its
    secret are still valid. `client_credentials` with the real secret answers
    `400 invalid_request` (client authenticated, grant refused) while a deliberately wrong
    secret answers `401` — the probe discriminates, so this is a measurement rather than an
    assumption.
- **A real sign-in error page** replaces Auth.js's. It says what is known, what to do next,
  and states outright that the error code is a category rather than a diagnosis.

### Added
- **The project list is cached in your browser, with a Refresh button and the time it was
  fetched.** Reading 443 projects costs five upstream pages and about half a minute, and
  the answer barely changes day to day. The enrichment pass (DOIs, wikis, add-ons — 45
  batches) is cached with it, so neither is repeated on every visit. Four rules the cache
  keeps:
  - **Keyed by OSF user.** It holds the titles of *private* projects; on a shared lab
    machine an unkeyed cache would show one researcher another's work after a sign-out.
  - **Only a complete load is ever stored.** A partial list presented later as the whole
    inventory would mean deciding what to migrate from a list quietly missing projects.
  - **Never silently refreshed**, and the age is always on screen — louder past a week.
  - **Every failure survivable**: quota errors, private modes and anything a previous
    version wrote all degrade to a cache miss, never a broken page.

## 1.10.0 — 2026-08-13

**The inventory now leads somewhere.** Reported by the user, looking at 443 loaded
projects: *"now what do I do? where is the actual transitioning?"*

### Fixed
- **🚨 Nothing in the app linked to `/transition/[guid]`.** The export and the Zenodo
  transfer — everything v1.8.0 and v1.9.0 built — were reachable only by typing the URL.
  The inventory listed every project with a recommendation and then offered no way to act
  on it, and the project title linked to the ordinary browse page instead. The feature was
  deployed, tested, and unreachable. This is the UI form of a rule the project already
  had: *a module imported only by its own test is not shipped*; a page nothing links to is
  not shipped either. Every row now has a button that opens its own transition page,
  labelled as the suggestion beside it — *Back it up →*, *Move it →*, *Take a look →* —
  and "leave it" gets a quiet *Take a copy anyway →*, because leaving a project on OSF is a
  recommendation, not a locked door. A test fails if the last link to the feature is ever
  removed again, and was verified by deleting the link and watching it go red.

### Added
- **A "What to do now" panel.** The inventory answered "what does BetterOSF think of each
  of these" and never "so what do I do", which is the only question someone opening it
  actually has. Three numbered steps — check the facts, work through the ones that need
  something, open a project to export or transfer it — with the counts that make the job
  finite. It also states plainly that there is no bulk run, and why: each project needs its
  own decision about where it should go.
- **Rows show what you have already done.** For an account with hundreds of projects,
  "where did I get to" is the question that makes the list workable. Completed runs are
  badged with the destination and date, and an incomplete run is badged as **incomplete**
  rather than quietly counted as done. A missing history shows no badge at all rather than
  claiming nothing was done.
- **Local exports are recorded too.** Only Zenodo transfers were, so the progress view
  would have silently omitted every download — the more common action of the two. A local
  run stores `env: "none"`, because writing "sandbox" would be a false statement about
  where somebody's data went, and it fails the publish route's environment check closed,
  which is the correct outcome for a download.

## 1.9.1 — 2026-08-13

**Errors that say what happened, and waits that look like waits.** Both reported from
production within an hour of v1.9.0.

### Fixed
- **Every OSF error message in the app was being thrown away.** `osfErrorResponse` returned
  a plain-**text** body while every caller reads errors with `res.json()` — the parse threw,
  the catch swallowed it, and a carefully written "Your OSF connection expired. Reconnect
  OSF and try again." reached the user as **"Could not load your projects (HTTP 401)"**. The
  server had worked out exactly what was wrong and the answer never got out. Six routes were
  affected. Error bodies are now JSON with `error`, `code`, `action`, `detail`, `requestId`
  and `at`, and the client reads the body as text *first* so it can never lose a message
  again — JSON, plain text, or an HTML page from a gateway.
- **`/transition` looked hung for accounts with many projects.** It walked every page of the
  node list in one request before rendering anything: measured on a real 443-project
  account, **5 upstream pages, 27 seconds**, behind one static line of text. It was also
  unsafe — five pages at up to 16s each could exceed the function's 60s ceiling and die with
  a 504. The inventory now fetches one page per request and renders each on arrival, so the
  first hundred projects appear in about six seconds.
- **`getUserNodes` reported a page length as the collection total.** OSF puts the count at
  `links.meta.total`, not top-level `meta` (measured: `{"total":443,"per_page":10}`), so the
  lookup always missed and fell through to `data.length` — a user with 443 public projects
  was shown "100".

### Added
- **A shared error surface** (`ErrorNotice`): what happened, what to do about it, and a
  collapsed *Technical details* panel with status, code, endpoint, timestamp and a request
  id, with a copy button. The id is written to the server log in the same breath, and
  `/admin/logs` already searches log context — so a user quoting `req_ab12cd34` is enough
  for an admin to find the full entry, including the upstream body the browser never sees.
  A test pins that seam, because each half can be correct while the pair is useless.
- **An expired OSF token now offers a Reconnect button**, not just a retry that cannot work.
- **Real progress affordances** (`ProgressBar`, `Spinner`, `Working`): determinate where a
  denominator genuinely exists, indeterminate with a live count where it does not, and
  `prefers-reduced-motion` respected. Wired into the inventory load, the enrichment pass,
  the consent check, the project preflight, the Zenodo connection check and publishing.
- **Enrichment failures are counted and shown.** Failed batches already left rows saying
  "not checked" rather than inventing a value, but nothing said how many — so a partly
  failed pass looked like a complete one.
- **A partly loaded list says so.** If page 3 of 5 fails, the projects on screen are real and
  the banner says the list is incomplete rather than letting it read as everything.

## 1.9.0 — 2026-08-13

**The transfer leg.** v1.8.0 shipped the half that gets data *out* of OSF (a verified
export to disk). This is the half that puts it somewhere it can keep living: a signed-in
researcher can now pick Zenodo as the destination, connect their own Zenodo account, and
have every file transferred with the **same three-way checksum verification** — ending in
a reconciliation verdict and a private **draft** that BetterOSF never publishes on its own.

### Added
- **Zenodo transfer** (`src/lib/transition/run-transfer.ts`). Files go browser → Zenodo
  directly; no research byte touches Vercel at any size. Each file is staged, hashed,
  checked against OSF's own checksums **before** it is uploaded, committed, then verified
  a second time against the checksum Zenodo reports for what it stored. This is the only
  path that sets `destinationExpected: true`, which makes a commit with no parseable
  checksum a **failure** rather than a skipped check.
- **Zenodo OAuth** (`/api/zenodo/oauth/start`, `/callback`, `/session`, `/token`). The
  access token is sealed with AES-256-GCM into an httpOnly cookie bound to the OSF user
  and the Zenodo environment, and handed to the browser only for the duration of a run —
  the same posture as `/api/osf/upload-token`. No refresh token is stored: Zenodo's tokens
  last ~60 days, and an untestable refresh path guarding a deposit credential is worse
  than a two-click reconnect.
- **Splitting large deposits across linked records.** A project over Zenodo's 100-file /
  50 GB per-record limit becomes several records tied together with DataCite
  `IsPartOf` — *not* archives (which would replace hundreds of per-file checksums with one
  checksum of a container OSF never held) and never Zenodo *versions* (which mean
  revisions of the same work). The count is shown in the preflight, before anything starts.
- **A durable ledger, so a run survives a closed tab.** IndexedDB is primary and written
  per file; Neon (`transition_jobs`, `transition_items`) takes coarse batched checkpoints
  roughly every 25 files or 30 seconds, which is what lets a run resume on another device.
  A resumed file is skipped **only** when our stored verification and Zenodo's *current*
  checksum agree — a stored "it was verified" is a memory, not a measurement.
- **Publishing, behind a phrase the server re-derives** (`/api/transition/publish`). The
  file count in the phrase comes from Zenodo's own listing of the draft at the moment of
  publishing, so a draft that changed under an open dialog no longer matches. Consent is
  recorded *before* the act. A run that did not reconcile as `complete` cannot be published
  from BetterOSF at all.
- **A report bundle deposited on every record** — the verification report, the crosswalk
  CSV, the RO-Crate description, the disclaimer, and the wikis and project metadata OSF
  offers no export for. Its own success is reported separately and never folded into the
  data verdict.
- **Screen Wake Lock** during long runs, with the UI saying plainly when the browser does
  not support it rather than implying the run is protected.
- **The licence OSF asserts** is now read (`?embed=license`) and carried into the deposit,
  exactly matched or kept as verbatim custom text — never mapped to a neighbouring licence.
- **Zenodo's resource-type vocabulary** (all 43 ids, copied from the live endpoint) offered
  as an explicit choice. Never inferred from OSF's category; `npm run test:live-zenodo`
  re-checks every id against the service.

### Fixed
- **Export was broken for everyone who signed in through `/transition`.** `ExportRunner`
  asked `/api/osf/upload-token`, which requires `session.osfCanWrite`, while the transition
  gate signs users in with **read-only** scope on purpose. Those users got a 403 the moment
  they pressed Start — on the headline feature of v1.8.0. New consent-gated
  `/api/transition/osf-token` returns the token a read-only session already has, and a test
  fails if any transition surface reaches for the write-scoped route again.
- **A critical regression test was load-flaky.** The 401-consistency probe pays for
  compiling a route's module graph inside the default 5 s budget and timed out under a full
  parallel run while passing in 155 ms alone. Given an explicit 20 s budget: a flaky
  regression test is worse than a slow one, because the next person re-runs it and moves on.

### Found by review, before shipping
Three second-model reviews (Codex and Sonnet, 2026-08-13) found six real defects in the new
code. Each was **reproduced against the unfixed code first**, and each fix has a test that
was watched going from red to green:
- A resumed run reused a stored verification for a file that had been **edited on OSF**
  between attempts — same id, same path, same length, different bytes. The fast path now
  also requires OSF's current checksums to match the ones we hashed last time.
- A Zenodo listing that could not be fetched left `destinationKeys` null and every other
  condition passing, so the run reported **COMPLETE** with the independent check skipped.
  `reconcile()` grew `blockers` — checks that did not *run*, as distinct from checks that
  failed — and refuses to call such a run complete.
- The **crosswalk CSV** printed `verified` for a file that another file had overwritten at
  the destination. Report rows are now keyed by OSF's immutable file id rather than by path
  (the rule the module already stated), and a collided file is reported as `overwritten`.
- A replayed publish request called Zenodo again. The publish is now **claimed in the
  database first**, so a second request is refused by us rather than by behaviour at Zenodo
  we have never measured.
- A publish whose draft had lost files since the run is refused (`draft_shrank`).
- A non-numeric `expiresAt` in the sealed cookie read as "never expires", because
  `NaN <= now` is false.

The publish route's own docstring was also corrected: `job.status` is a client checkpoint,
so "only a complete run may publish" is a safety interlock against an accidental publish,
**not** an authorisation control. Overstating it in a comment is the same defect class the
module exists to prevent.

### Database
`drizzle/0004_transition_jobs_items.sql` and `0005_transition_published_records.sql` were
**applied to production Neon on 2026-08-13** and verified present. Do not re-apply. Both are
additive: two new tables, three indexes, two foreign keys, one column.

### Testing
- `runTransfer` is tested end to end against a fake Zenodo that **hashes the bytes it
  receives** rather than echoing a checksum it was handed, with the real deposit client in
  the loop. The `destinationExpected` guard and the publish guards were each verified by
  breaking the code they guard and watching the tests go red.
- Two jsdom gaps that silently break byte-handling code are now polyfilled in
  `tests/setup.ts` and documented there: `Blob.prototype.stream` is absent, and
  `TextEncoder` returns a foreign-realm `Uint8Array` so `instanceof Uint8Array` is false.

## 1.8.0 — 2026-08-13

**The OSF Transition Toolkit.** On 2026-08-13 the Center for Open Science announced
that OSF Projects is being wound down: no new projects or components from
**2026-11-16**, and every project — public and private — becomes **read-only on
2027-02-19**, with many API write functions deprecated. Public projects stay online
read-only indefinitely; COS has said it anticipates removing private projects later,
with 12 months' notice. Registrations and preprints are unaffected.

OSF offers no wiki export, no cross-project view, and only per-folder "Download as
Zip". This release is BetterOSF's answer to that.

### Added
- **`/transition` — an inventory of every project you can reach**, with a computed
  recommendation per project and the reasons behind it. Loads in two tiers so hundreds
  of projects are readable in seconds, then enriches (DOI, wikis, add-ons, size) in
  batches behind a progress line. A row that has not been checked says so; it never
  shows a blank or a zero that would read as a fact.
- **`/transition/[guid]` — a complete, checksum-verified export** as a BagIt bag with
  RO-Crate metadata: files *plus* wikis, project metadata and contributors. Includes a
  SHA-256 manifest, `Payload-Oxum`, the full report, an `osf-to-destination.csv`
  crosswalk for repairing links in papers and READMEs, and a `DISCLAIMER.txt` that
  travels with the data.
- **OSF readers for everything BetterOSF could not previously see**: wikis (content
  and version history), comments, activity logs, contributors with ORCID, identifiers,
  institutions, add-ons, per-file version history, and node storage.
- **A Zenodo deposit client**, verified end to end against sandbox.zenodo.org, with a
  guarded live round-trip test (`npm run test:live-zenodo` — sandbox only, opt-in,
  never publishes, cleans up after itself).
- **Transition terms and a consent gate.** `src/lib/terms.ts` now has three clause
  groups (general / delete / transition) and eight new transition clauses. Consent is
  recorded per terms version in a new `transition_consents` table; no transition API
  route serves an unconsented caller.

### Changed
- **Sign-in for the transition toolkit asks for READ-ONLY OSF scope.** Export never
  writes to OSF, so requesting write would be over-permissioned.
- **`FileEntry` now carries OSF's `md5`/`sha256`.** They were being parsed away.
  Absence is preserved as `null` — that is what marks a file `unverifiable` instead of
  pretending it was checked.
- **`/terms` renders all three clause groups** with continuous numbering and
  per-clause anchors.

### Fixed
- **`DeleteDialog` selected its clickwrap clauses by heading text**, using a filter
  that silently drops unmatched entries. Rewording a heading would have rendered the
  dialog a clause short while still collecting the typed confirmation — a consent
  record for terms the user never saw. Clauses now have stable ids and `clausesByIds`
  throws on an unknown one.
- **`npm run lint` was already failing on `main`** (4 warnings against
  `--max-warnings 0`, in files unrelated to this work). Fixed rather than suppressed.

### Corrected
- **The earlier internal exit-strategy notes were backwards.**
  They recommended building against figshare first because Zenodo's CORS was believed
  broken. Live probes on 2026-08-13 found the opposite: **Zenodo works browser-direct**
  (`ACAO: *`, `authorization` allowed, `PUT` on both `/api/records` and
  `/api/files/{bucket}/{name}`), while **figshare sends no `Access-Control-Allow-Origin`
  header at all**. Both documents now record the measurement and why the original call
  was wrong — it came from documentation and issue trackers rather than a request.

### Verified by live probe, not assumed
- Waterbutler allows `Range` + `Authorization` from a browser origin and returns 206,
  so downloads are genuinely resumable client-side.
- `api.osf.io` sends **no CORS headers at all**, so metadata must be proxied — which is
  why inventory enrichment is batched (~25× fewer function invocations).
- Zenodo accepts `/` in file keys, so deposits keep OSF's folder structure.
- Zenodo multipart upload is **live**, with per-part URLs that **expire after 14 days**.
- ORCID lives at `external_identity.ORCID`, not `social.orcid` — a 50-user sample found
  zero users with the latter set. Only VERIFIED ORCIDs are asserted.

### Notes
- No research bytes pass through Vercel: browser ↔ Waterbutler and browser ↔ Zenodo,
  both direct. A 200 GB migration costs no server bandwidth.
- The recommendation engine's default is **do nothing**. Public projects stay on OSF at
  the same URL and DOI; mirroring them elsewhere mints a second DOI and splits the
  citation record.

## 1.7.1 — 2026-08-04

Backlog reconciliation: everything on the internal backlog that could be done in-session
was done, and what remains is split into "blocked on the maintainer" vs "deferred by
choice" rather than buried in 300 lines of history.

### Fixed
- **`/api/files/[guid]/folder` mapped an expired OSF token to a 500.** This route is
  called on *every* tree expand, and the tree renders its message verbatim — so a
  signed-in user with an expired token saw "Could not load this folder. Please try
  again later.", advice that can never succeed because retrying does not renew a
  token. New shared `src/lib/osf/error-response.ts` maps 401/403/429/502 honestly
  across the folder, skeleton and all-files routes; unknown errors still 500 so real
  bugs stay loud.

### Changed
- **Citations are no longer fetched during overview render.** Measured **9 → 5 OSF
  calls per overview (44% fewer)**. `CitationExport` now loads from
  `/api/osf/citation/<guid>` on click, so the page paints sooner and is materially
  less likely to trip OSF's rate limit.
- **`/feedback` reachable from the footer**, and the admin menu now links the
  Feedback inbox alongside Logs.
- **"My projects" in the user menu** — a signed-in shortcut to
  `/search?scope=user:me`, which previously required knowing the query string.
- **`drizzle/meta` snapshot resynced.** `drizzle-kit generate` previously emitted a
  `CREATE TABLE email_events` for a table that already exists in production, which
  would have failed if applied; it now reports "No schema changes, nothing to
  migrate".

### Notes
- Two backlog items ("registration file-view breadcrumb", "per-registration expand
  state") turned out to be **already implemented** — the entries were stale. Both are
  now pinned by tests rather than simply ticked off.

## 1.7.0 — 2026-08-04

### Fixed
- **Deep file/folder pages no longer die on an expired OSF session.** OSF returns HTTP 401
  for an expired token, which mapped to `OsfError("unauthorized")` — a code absent from
  every deep-path walk's catch list, so it rethrew into the route error boundary and
  replaced the whole page with "Couldn't load this project". Affected only signed-in
  users; an anonymous request sends no bearer token and can never produce a 401, which is
  why anonymous QA never caught it. Pages now keep their tree and breadcrumb and offer a
  **Reconnect OSF** action (`src/lib/osf/walk-failure.ts`, `osfBackpressureKind`).
- **Empty text files rendered a blank pane** indistinguishable from a crash. A 0-byte file
  produced zero visible characters via Shiki. Text/code files now show name, size, line
  and character counts, and an empty or whitespace-only file says so explicitly.
- **"Upload pending" replaced** with actionable copy: per-file status reads "ready to
  upload" and the batch button reads "Upload 3 files" / "Upload remaining 2".

### Added
- **Informative landing page** — what it does, how it works, where your data goes.
- **Workspace table** with last-opened time, visit count and location; sortable/filterable.
- **Floating version badge** (bottom-right) sourced from `package.json` via
  `src/lib/version.ts`; doubles as the bug-report entry point.
- **Bug reports** — `/feedback` (anonymous allowed), stored in `bug_reports` (Neon EU),
  emailed to `ADMIN_NOTIFY_EMAIL` via SES from `betterosf@scimeto.app`, triaged at
  `/admin/feedback`.
- **Visit statistics** on recents (`lastViewed`, `visits`, `pinnedAt`), all optional so
  entries from older builds render "—" rather than a fabricated 1970 date.

### Changed
- **Removed the Many Labs 2 / RPP example links** from the anonymous homepage. Each costs
  dozens of OSF API calls to open, which put the app's most expensive request one click
  from every first-time visitor.
- **Local dev port moved 3000 → 4747.** `npm run dev` / `npm start` pin it; visual-qa
  gained `--local`. Port 3000 is banned and enforced repo-wide by
  `tests/unit/dev-port.test.ts`.
- `betterosf-cleanup` gained **Phase 4.5**: user-facing copy must match shipped features,
  verified in both directions on every run.

### Security
- **Protocol-relative URL smuggling in bug reports** (found by cross-model review).
  `//evil.example/x` starts with `/` but resolves to a different origin, so an anonymous
  reporter could plant a phishing link that rendered as a trusted clickable link in the
  admin inbox. Now rejected at intake (`//`, `/\`, `\/`, `\\`), absolute URLs are
  host-allowlisted, and the admin UI re-validates independently because rows stored
  before the fix remain in the database.
- Removed the blanket `taskkill //F //IM node.exe` from the pre-approved command list — it
  killed every other project's node processes.

## 1.6.0 — 2026-08-03

### Added
- **File and folder deletion from OSF Storage**, with deliberate multi-stage confirmation.
  Deletion is irreversible — OSF has no trash and no restore path — so the flow is built
  to make an accidental deletion structurally difficult:
  - Folders are expanded first, so you always see a real file count before consenting
  - A **verified backup is captured before any deletion**, and an incomplete backup
    hard-blocks the delete
  - A typed confirmation phrase is required; folders and bulk deletes additionally
    require an acknowledgement checkbox
  - Per-item outcomes are always reported (`deleted` / `already gone` / `failed`),
    never one opaque status
- **Local pre-delete backups** stored in the browser (IndexedDB), with one-click restore
  of a copy. Capped at 20 backups / 500 MB, oldest evicted first, with a 7-day grace floor.
- **Mandatory backup download** above 100 MB, above 100 files, when a folder is involved,
  or when browser storage is unavailable or too full.
- `/terms` — deletion terms, also shown inline in the delete dialog. The typed
  confirmation is recorded as an electronic signature.
- Restore path reuses the existing upload pipeline (`zipToDroppedNodes` → `runUploadPlan`).

### Security
- Registrations cannot be deleted: `resolveDeleteUrl` pins the target to
  `https://api.osf.io/v2/nodes/`. Registration and node Waterbutler URLs are
  origin-identical, so this pin — not the UI `readOnly` prop — is the real boundary.
- OSF Storage **roots cannot be deleted**. The query string is stripped before the path is
  inspected, so a client cannot smuggle `?confirm_delete=1` (which makes Waterbutler
  recursively wipe every file in the provider).
- Deletion runs server-side, not direct-from-browser. Unlike uploads there is no
  body-size benefit to justify exposing the OSF token to a destructive flow.
- Consent is re-validated on the server: the expected phrase is re-derived and a mismatch
  is rejected, so the audit record is evidence rather than a client assertion.
- Per-user delete rate caps (300/min, 2000/day) charged by item count, since signed-in
  requests bypass middleware rate limiting.

### Fixed
- Privacy notice corrected: it previously stated file contents are never cached, which the
  local backup feature makes untrue. Now discloses the IndexedDB backup store explicitly.

### Internal
- `makeIO` extracted from `UploadDialog` to `src/lib/upload/http-io.ts`, shared by uploads
  and restore so both behave identically.
- `logEventAwaited` added for records that must be durable before the next action runs.

## 1.5.1 — 2026-07-18

### Added
- AWS SES transactional email (`eu-west-1`) with interim FROM `betterosf@scimeto.app`
- `email_events` table for send idempotency + bounce/complaint suppression
- SNS webhook at `/api/email/webhook` (TopicArn allowlisted via `SNS_TOPIC_ARN`)
- Daily admin error digest cron (`0 8 * * *` → `/api/cron/admin-error-digest`)
- Admin test send at `/api/email/test` (session admin + recipient allowlist)

### Security
- SNS TopicArn allowlist before subscription confirm / event insert
- Idempotency claims released on SES failure (no burned keys)
- Digest path uses `sendEmail` (suppression + daily idempotency)

## 1.5.0 — 2026-07-17

### Added
- Neon Postgres EU (`betterosf-eu`, `aws-eu-central-1`) for users / bookmarks / prefs / admin logs
- `/api/me/bookmarks`, `/api/me/prefs`, `/admin/logs`
- AWS SES bootstrap scripts under `scripts/aws/`
