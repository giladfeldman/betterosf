# Licence check + destinations beyond Zenodo — design (2026-10-29)

Status: design, not built. Every "measured" fact below was probed on 2026-10-29; re-probe
before building on it.

Sources:
- Quintana thread (Siepe, Heck, Quintana): https://bsky.app/profile/dsquintana.bsky.social/post/3myyj4gpua22n
  - preprint "Open research materials need explicit reuse licenses": https://osf.io/preprints/psyarxiv/4rjg3_v1
  - their apps: https://dsquintana.shinyapps.io/osf-license-check/ (public projects only),
    https://github.com/bsiepe/osf-licenses-extension (`check_osf_licenses.R`, MIT)
- Lakens, "Which data repository should you use?": https://daniellakens.blogspot.com/2026/08/which-data-repository-should-you-use.html
- ResearchBox API page: https://researchbox.org/api

## 1. Why the licence check is urgent

Thread's point: when OSF goes read-only on **2027-02-19**, the licence freezes with it. An
unlicensed frozen project can only be reused by emailing its author. Their preprint finds only
27% of papers with OSF materials are licensed; Siepe & Heck lost about half of the
experience-sampling datasets they found because they were unlicensed.

So the check is worth most **before** the freeze, while the licence can still be set on OSF.

## 2. Licence check — ready to build

### What BetterOSF already has (checked in code)
- `getNodeLicense(guid)` in `src/lib/osf/project-extras.ts` reads one node's licence via
  `?embed=license`; null = OSF asserts no licence.
- `crosswalk.ts` already treats the OSF names `"No license"` and `"Other"` as not-a-licence
  (`NON_LICENCE_NAMES`), and the Zenodo transfer already says "choose one before publishing".
- Sign-in already asks for `osf.full_write` (`src/lib/auth/osf-provider.ts`), so setting a
  licence needs no new permission.

### Measured 2026-10-29
- The list endpoint takes the same embed: `GET /v2/nodes/?embed=license` returned the licence
  name per node in one call (`awt3q` → "CC-By Attribution 4.0 International", `mfqzx` →
  "CC0 1.0 Universal", `7t8nm` → none). So the signed-in user's projects can be checked at
  **one OSF call per page of up to 100 projects** (`/v2/users/me/nodes/?embed=license`), not one
  per project. Cheap, proxied through our server like every OSF metadata call (no CORS on
  `api.osf.io`).
- `GET /v2/licenses/` lists OSF's licence vocabulary (ids needed for setting one).

### What it does (one page: "Licence check", linked from the transition dashboard)
1. Lists every project and component the user can see (public and private), with: title,
   public/private, licence (verbatim OSF name), copyright holder/year, and a status:
   - **Licensed** — a real licence is set.
   - **No licence** — nothing set, or `"No license"`.
   - **"Other" — check it** — free text, may or may not be a reuse licence.
   - **Couldn't check** — the lookup failed (never shown as "No licence").
2. Counts at the top: "12 of 20 projects have no licence. You have until 19 Feb 2027 to fix
   this on OSF."
3. Components are checked separately — a component does not inherit its parent's licence on
   OSF (same rule as Siepe's script, which lists children).
4. **Fix it here** (anyone with write permission, before the freeze): pick a licence, enter copyright holder and
   year, apply to one project or to a ticked set. Writes `PATCH /v2/nodes/{id}/` with
   `relationships.license` + `attributes.node_license`, then re-reads to confirm. Shows
   "Set on OSF — confirmed" only after the re-read matches.
5. After 2027-02-19 the fix button disappears; the check still runs, and the export/transfer
   flow asks for a licence at the destination instead (already the case for Zenodo).

Licence picker: short plain-language help for the common choices (CC BY 4.0, CC0 1.0 for
data; MIT for code), plus a link to the preprint's tips. BetterOSF never pre-selects one
(see open question Q1).

### Tests before it ships
- Unit: status mapping for all five states, incl. `"No license"`, `"Other"`, failed lookup.
- Unit: the PATCH body; the read-back verdict refuses "confirmed" on a mismatch.
- Live, opt-in, throwaway OSF account only (same rule as `test:destructive`): set a licence on
  a throwaway project and read it back. **Not yet run** — the PATCH shape is from the OSF API
  docs, not tested.

## 3. Destinations beyond Zenodo

Lakens' criteria: longevity, API, metadata, anonymous peer review, ease of use, GDPR. His
deciding point for EU psychologists is GDPR: Zenodo (CERN) will not sign a data-processing
agreement, so **pseudonymised data should not go to Zenodo**; he points to DataverseNL or an
institutional repository. Anonymised data and code can go to Zenodo, Harvard Dataverse or
ResearchBox. Point-and-click users: ResearchBox or PsychArchives.

| Destination | Upload by software? (measured) | Good for | Limits | Fit for BetterOSF |
|---|---|---|---|---|
| **Zenodo** (built) | yes, browser-direct | anonymised data, code, materials; DOI | flat (no folders); not GDPR-compliant for pseudonymised data | already done |
| **Harvard Dataverse** | **yes** — CORS allows `POST`/`PUT` + `X-Dataverse-key` from any site (v6.12.1) | anonymised data; tabular data searchable; anonymous review link; folders kept | user pastes an API token (no OAuth); file size limit not measured | **good** — same browser-direct design as Zenodo |
| **AUSSDA** (Austria) | yes — same CORS as Harvard | Austrian social-science data | curated; deposit rules not checked | possible via the same Dataverse code |
| **DataverseNL** | **no** — preflight returns 200 with no CORS headers | pseudonymised data under GDPR (Lakens' pick) | browser upload blocked | guided hand-off only (ZIP + instructions) |
| Other Dataverses (e.g. `dataverse.unimi.it`) | varies — unimi allows only `gdcc.github.io` | — | per-instance | probe per instance; never offer generically |
| **GitHub** | yes — `api.github.com` allows CORS for `PUT /contents`, `POST /user/repos`; the OAuth token exchange has no CORS (needs our server) | **code**; link to Zenodo for DOI snapshots | 100 MiB per file hard limit, repos ideally < 1 GB; no DOI by itself | poor for data; for code, a ZIP + `LICENSE` + `CITATION.cff` + Zenodo-GitHub link is enough |
| **ResearchBox** | **no upload API** (see §4) | point-and-click users; paper-centred boxes | manual upload only | guided hand-off only |
| PsychArchives | not checked (Lakens: API undocumented) | anonymised psychology data | anonymised only | guided hand-off only |

## 4. ResearchBox — answered

**Download only.** The API page lists one endpoint (`POST https://researchbox.org/api_call.php`)
with exactly four `action` values: `list_files`, `box_meta`, `download_files`, `search`. No
upload, create or write action, and no mention of one being planned. Calls need a bearer token
from a ResearchBox login. So BetterOSF can only prepare a package for the user to upload by
hand. (Our own `curl` of the page hit a Cloudflare bot check; the page was read through a
fetch tool twice, both times listing the same four actions.)

## 5. Recommendation — "Where should this go?" guide + destination-ready package

Easiest thing that helps everyone, whatever destination:

1. **Three questions** on the transition page, taken from Lakens:
   - Does it contain pseudonymised (re-identifiable) personal data? → yes: DataverseNL or your
     institutional repository, not Zenodo.
   - Is it mainly code? → GitHub + Zenodo link (or Zenodo directly).
   - Do you prefer point-and-click? → ResearchBox / Harvard Dataverse; otherwise Zenodo.
   Answer shown as a recommendation with Lakens' reason, plus "Zenodo — automatic" where it fits.
2. **Package for that destination**, built from the existing verified ZIP export (no new
   upload code, no server bandwidth):
   - every package: the files, `LICENSE.txt` (from the licence check), `README.md` with the
     OSF citation and DOI/URL, and the existing manifest with checksums;
   - Dataverse: one ZIP the Dataverse web upload unpacks keeping folder paths (documented:
     unpacked "depending on the configuration", up to 1,000 files by default; larger ZIPs
     upload unpacked-as-is — the guide says so);
   - GitHub: adds `CITATION.cff`, `.zenodo.json`, and warns about files over 100 MiB;
   - ResearchBox / PsychArchives / institutional: the plain package.
3. **Step-by-step instructions** per destination, with a "paste your new DOI here" box that
   writes it into the report so the OSF → new home link is recorded.

Why this one: it covers every destination including the two that cannot be uploaded to by
software (DataverseNL, ResearchBox), reuses the export that already reconciles checksums, and
adds no hosting cost.

**Later, if users ask for it:** direct upload to Harvard Dataverse (CORS measured working), by
reusing the Zenodo browser-direct transfer with a Dataverse target. Medium effort; needs a
token-paste flow and a live test on `demo.dataverse.org` first.

## 6. Maintainer decisions (2026-10-29)
- Q1: CC BY 4.0 preselected in the licence picker.
- Q2: Bulk apply allowed.
- Q3: Licence check first, then the destination guide.

## 7. What was built (2026-10-29, unreleased)
- `/tools/licence-check` — `src/lib/licence/check.ts`, `src/lib/osf/licences.ts`,
  `src/app/api/licences/{route,apply/route}.ts`, `src/components/licence/LicenceCheck.tsx`.
  Not behind the transition gate (the transition terms promise export changes nothing on
  OSF; this edits). Read scope to check; write scope requested at the point of use.
  - Permission: WRITE is enough (OSF source `website/project/licenses/__init__.py`), so the
    page offers the fix wherever `current_user_permissions` includes "write". The §2 plan
    said admins only; the source says otherwise.
  - Registrations are not listed: `/users/me/nodes/` returns projects and components only.
  - Bulk apply runs in batches of 10 nodes per request, one node at a time, each read back.
- Destination guide — `src/lib/transition/destination-guide.ts`,
  `src/components/transition/DestinationGuide.tsx`, on `/transition/[guid]`.
- Export ZIP gains `LICENSE.txt` (licence name, copyright line, OSF's stored licence text).
- Components: OSF reports a parent's licence for a component with none of its own
  (`AbstractNode.license` walks up the parents), so a component may show "Licensed" by
  inheritance. §2 point 3 above assumed no inheritance; the OSF source says otherwise.
- Cross-model check (Sonnet, 2026-10-29) found: LICENSE.txt never wired into the real export,
  "confirmed" ignoring holder/year, a missing-embed case read as "No licence", comma-splitting
  of holders. All four fixed and test-pinned. `CITATION.cff` and
  `.zenodo.json` from §5 were NOT built — kept the change small; the GitHub steps rely on
  Zenodo's own GitHub integration instead.
- **Tested live 2026-10-29** on a throwaway OSF account (`OSF_TEST_TOKEN`),
  using the real `check.ts` functions: a new private project read as "No licence";
  PATCH CC BY 4.0 -> 200, read-back confirmed; PATCH MIT with two holders (one containing a
  comma) + year -> 200, read-back confirmed with both holders intact; MIT without year ->
  OSF 400 "year must be specified for this license" (and `validateApply` blocks it first);
  a new component with no licence of its own lists as "MIT License" -> inheritance
  confirmed live; the `/users/me/nodes/?embed=license` listing returned both rows correctly.
  Both test nodes deleted (204). The page and API routes themselves were not driven while signed in.
