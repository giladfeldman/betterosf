// Local backup store for pre-delete snapshots.
//
// WHY IndexedDB and not the existing prefs/localStorage layer:
//   1. localStorage caps around 5 MB and holds strings only — useless for file bytes.
//   2. src/lib/sync/client.ts syncs EVERY `betterosf:*` localStorage key to Postgres.
//      Backups contain the user's actual file content; it must never leave the device.
//      IndexedDB is a separate storage area that sync cannot reach. That isolation is
//      deliberate — do not "unify" this into prefs.
//
// Hand-rolled rather than pulling in idb/dexie: the surface used here is small, and a
// new runtime dependency for one feature is not worth it.

export type BackupItem = {
  kind: "file" | "folder";
  path: string;
  name: string;
  size: number;
  /** SHA-256 of the bytes we actually stored — see capture.ts for why not OSF's hash. */
  sha256: string;
};

export type BackupStatus = "complete" | "incomplete" | "failed";

export type BackupRecord = {
  id: string;
  guid: string;
  projectTitle: string;
  createdAt: number;
  status: BackupStatus;
  items: BackupItem[];
  /** Files we could not retrieve. Non-empty means status !== "complete". */
  missing: { path: string; reason: string }[];
  totalBytes: number;
  blob: Blob;
  /** Filled in after the delete runs, so the drawer can show what this backup covers. */
  deleteSummary?: { deleted: number; alreadyGone: number; failed: number };
};

const DB_NAME = "betterosf-backups";
const DB_VERSION = 1;
const STORE = "backups";

/** Retention: bounded so backups cannot grow without limit. */
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_RECORDS = 20;
/** Never evict anything this new unless it is the only way to make room. */
const EVICTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("guid", "guid", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the backup database."));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Backup store operation failed."));
  });
}

export async function listBackups(): Promise<BackupRecord[]> {
  if (!idbAvailable()) return [];
  const db = await openDb();
  try {
    const all = await tx<BackupRecord[]>(db, "readonly", (s) => s.getAll() as IDBRequest<BackupRecord[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

export async function getBackup(id: string): Promise<BackupRecord | null> {
  if (!idbAvailable()) return null;
  const db = await openDb();
  try {
    const rec = await tx<BackupRecord | undefined>(db, "readonly", (s) => s.get(id) as IDBRequest<BackupRecord | undefined>);
    return rec ?? null;
  } finally {
    db.close();
  }
}

export async function deleteBackup(id: string): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  } finally {
    db.close();
  }
}

/**
 * Evict oldest-first until the store fits the caps.
 *
 * `respectGrace` keeps recent backups safe on a routine save; the retry path calls with
 * false so a genuinely full store can still make room rather than failing outright.
 * Returns the ids removed so the caller can tell the user what went.
 */
async function evictToFit(db: IDBDatabase, incomingBytes: number, respectGrace: boolean): Promise<string[]> {
  const all = (await tx<BackupRecord[]>(db, "readonly", (s) => s.getAll() as IDBRequest<BackupRecord[]>)).sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const now = Date.now();
  const removed: string[] = [];
  let total = all.reduce((sum, r) => sum + r.totalBytes, 0) + incomingBytes;
  let count = all.length + 1;

  for (const rec of all) {
    if (total <= MAX_TOTAL_BYTES && count <= MAX_RECORDS) break;
    if (respectGrace && now - rec.createdAt < EVICTION_GRACE_MS) continue;
    await tx(db, "readwrite", (s) => s.delete(rec.id) as unknown as IDBRequest<undefined>);
    removed.push(rec.id);
    total -= rec.totalBytes;
    count -= 1;
  }
  return removed;
}

export type SaveResult =
  | { ok: true; evicted: string[]; persisted: boolean }
  | { ok: false; reason: "unavailable" | "quota" | "error"; message: string };

/**
 * Persist a backup, requesting durable storage first.
 *
 * A failure here is NOT fatal to the delete flow — it escalates the ZIP download from
 * offered to mandatory (see thresholds.ts). The caller must surface that, because the
 * user's assumption ("BetterOSF kept a copy") would otherwise be silently false.
 */
export async function saveBackup(record: BackupRecord): Promise<SaveResult> {
  if (!idbAvailable()) {
    return { ok: false, reason: "unavailable", message: "This browser cannot store local backups." };
  }

  let persisted = false;
  try {
    if (navigator.storage?.persist) {
      persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
    }
  } catch {
    /* best-effort: a browser refusing persistence is not an error */
  }

  const db = await openDb().catch(() => null);
  if (!db) return { ok: false, reason: "error", message: "Could not open the local backup store." };

  try {
    const evicted = await evictToFit(db, record.totalBytes, true);
    try {
      await tx(db, "readwrite", (s) => s.put(record) as unknown as IDBRequest<IDBValidKey>);
      return { ok: true, evicted, persisted };
    } catch (e) {
      // Quota exceeded: drop the grace period, evict once more, retry once.
      if (isQuotaError(e)) {
        const more = await evictToFit(db, record.totalBytes, false);
        try {
          await tx(db, "readwrite", (s) => s.put(record) as unknown as IDBRequest<IDBValidKey>);
          return { ok: true, evicted: [...evicted, ...more], persisted };
        } catch {
          return {
            ok: false,
            reason: "quota",
            message: "Not enough space in this browser to keep a local backup. Download the ZIP instead.",
          };
        }
      }
      return { ok: false, reason: "error", message: "Could not write the local backup." };
    }
  } finally {
    db.close();
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
}

/**
 * Would `bytes` plausibly fit? Used up front to escalate the ZIP to mandatory BEFORE the
 * user spends time on a capture we expect to fail. Conservative on purpose: 80% headroom,
 * and an unavailable estimate counts as "will not fit".
 */
export async function likelyFits(bytes: number): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.quota == null || est.usage == null) return false;
    return bytes < (est.quota - est.usage) * 0.8;
  } catch {
    return false;
  }
}

export async function attachDeleteSummary(
  id: string,
  summary: { deleted: number; alreadyGone: number; failed: number }
): Promise<void> {
  const rec = await getBackup(id);
  if (!rec) return;
  const db = await openDb();
  try {
    await tx(db, "readwrite", (s) => s.put({ ...rec, deleteSummary: summary }) as unknown as IDBRequest<IDBValidKey>);
  } finally {
    db.close();
  }
}
