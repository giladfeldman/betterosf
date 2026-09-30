# Deletion is irreversible - full text (moved verbatim from CLAUDE.md)

## 🚨 Deletion is irreversible — rules that bind every session (v1.6.0)

**OSF has no trash and no restore path.** A bug in the delete path permanently destroys
someone's research data. These are not style preferences:

- **Never gate a destructive affordance on `readOnly` / `canUploadHere` alone.** Those are
  true for signed-out visitors — they only exclude registrations. Delete uses
  `canDeleteHere = canUploadHere && canWrite`, where `canWrite` comes from
  `/api/osf/write-status` and **defaults to `false`** (fails closed). Getting this wrong
  leaked 28 Delete buttons to anonymous users on 2026-08-03.
- **Registration immutability rests on the `listingUrl` pin**
  (`https://api.osf.io/v2/nodes/`) inside `resolveDeleteUrl` — NOT on `readOnly`, which is
  only a React prop. Registration and node Waterbutler URLs are identical in shape.
- **In `resolveDeleteUrl`, the query string is stripped BEFORE the root check.** Waterbutler's
  `?confirm_delete=1` does not delete a root — it recursively deletes every file in the
  provider. Reordering those two steps is a critical bug.
- **Pre-delete backups must stay client-side and verifiable** (`src/lib/backup/capture.ts`).
  Do not route them through `/api/zip/[guid]/selection`: that route returns 200 before
  assembling the archive, so a partial backup is indistinguishable from a complete one.
- **Copy is part of the contract**: "kept in this browser" (never "saved" — IndexedDB is
  evictable), "restore a copy" (never "undo" — new file ids, broken links).

**The live destructive test** (`npm run test:destructive`) creates its own throwaway OSF
project and is guarded by five interlocks. It takes **no project argument by design** —
never add a `--guid` flag, and never wire it into `/ship`, CI, or `npm test`. Requires
`BETTEROSF_DESTRUCTIVE_TEST=i-understand` + `OSF_TEST_TOKEN` from a **throwaway account**.
