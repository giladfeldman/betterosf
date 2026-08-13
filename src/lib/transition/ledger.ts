/**
 * The durable ledger for a transfer run: IndexedDB primary, Neon as a coarse checkpoint.
 *
 * A transfer can run for hours, and a tab can close for reasons the tab does not get to
 * vote on. Without a ledger, that means starting over — re-downloading gigabytes to
 * re-upload files already sitting at the destination.
 *
 * The split is deliberate and it is a cost decision as much as a design one:
 *
 *   - **IndexedDB is primary.** It is where the run actually is, it costs nothing, and it
 *     is written on every file.
 *   - **Neon takes batches**, roughly every 25 files or 30 seconds, driven by the runner.
 *     It exists so a run can be picked up on another device and so the evidence survives a
 *     browser that clears its storage. The standing "no paid tiers, no meaningful Vercel
 *     usage" rule is why it is not per-file.
 *
 * A server checkpoint that fails must never stop a transfer that is working, so every
 * remote call here is best-effort — but the failure is COUNTED and readable, not
 * swallowed. `syncFailures` is what the UI reads to say "your run is fine, but it isn't
 * saved on the server" rather than pretending both happened.
 */

import type {
  TransferItemSnapshot,
  TransferJobSnapshot,
  TransferLedger,
} from "./run-transfer";

const DB_NAME = "betterosf-transition-ledger";
const DB_VERSION = 1;
const JOBS_STORE = "jobs";
const ITEMS_STORE = "items";

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        db.createObjectStore(JOBS_STORE, { keyPath: "jobId" });
      }
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        // Keyed by [jobId, osfFileId] — by OSF's immutable file id, never by path, the
        // same binding rule the verifier enforces.
        const items = db.createObjectStore(ITEMS_STORE, { keyPath: ["jobId", "osfFileId"] });
        items.createIndex("jobId", "jobId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the local ledger."));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
  });
}

export async function putLocalJob(job: TransferJobSnapshot): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(JOBS_STORE, "readwrite");
    tx.objectStore(JOBS_STORE).put(job);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function getLocalJob(jobId: string): Promise<TransferJobSnapshot | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(JOBS_STORE, "readonly");
    const row = await promisify<TransferJobSnapshot | undefined>(
      tx.objectStore(JOBS_STORE).get(jobId) as IDBRequest<TransferJobSnapshot | undefined>,
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

/** Every run this browser knows about, newest first. */
export async function listLocalJobs(): Promise<TransferJobSnapshot[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(JOBS_STORE, "readonly");
    const rows = await promisify<TransferJobSnapshot[]>(
      tx.objectStore(JOBS_STORE).getAll() as IDBRequest<TransferJobSnapshot[]>,
    );
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function putLocalItems(jobId: string, items: TransferItemSnapshot[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(ITEMS_STORE, "readwrite");
    const store = tx.objectStore(ITEMS_STORE);
    for (const item of items) store.put({ ...item, jobId });
    await done(tx);
  } finally {
    db.close();
  }
}

export async function getLocalItems(jobId: string): Promise<TransferItemSnapshot[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(ITEMS_STORE, "readonly");
    const index = tx.objectStore(ITEMS_STORE).index("jobId");
    return await promisify<TransferItemSnapshot[]>(
      index.getAll(jobId) as IDBRequest<TransferItemSnapshot[]>,
    );
  } finally {
    db.close();
  }
}

/** Forget a run's local state. Nothing at the destination is touched. */
export async function deleteLocalJob(jobId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([JOBS_STORE, ITEMS_STORE], "readwrite");
    tx.objectStore(JOBS_STORE).delete(jobId);
    const cursorReq = tx.objectStore(ITEMS_STORE).index("jobId").openKeyCursor(jobId);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      tx.objectStore(ITEMS_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
    await done(tx);
  } finally {
    db.close();
  }
}

/**
 * Merge a server copy of a run's items with the local one.
 *
 * The rule is "whichever says more": a `failed` row from either side outranks a missing
 * one, and a row with a destination checksum outranks one without. Preferring one side
 * wholesale would either discard a resumed device's evidence or overwrite fresher local
 * results with a stale checkpoint.
 *
 * Pure, so the choice is testable without a browser or a database.
 */
export function mergeItems(
  local: TransferItemSnapshot[],
  remote: TransferItemSnapshot[],
): TransferItemSnapshot[] {
  const byId = new Map<string, TransferItemSnapshot>();
  for (const item of remote) byId.set(item.osfFileId, item);
  for (const item of local) {
    const existing = byId.get(item.osfFileId);
    if (!existing || score(item) >= score(existing)) byId.set(item.osfFileId, item);
  }
  return [...byId.values()];
}

function score(item: TransferItemSnapshot): number {
  // A row that carries the destination's checksum is strictly more informative than one
  // that does not, whatever state it claims.
  return (item.remoteMd5 ? 2 : 0) + (item.state === "failed" ? 0 : 1);
}

export type BrowserLedger = TransferLedger & {
  /** How many server checkpoints failed. Non-zero means "running, but not saved remotely". */
  syncFailures(): number;
};

/**
 * The ledger the UI hands to `runTransfer`.
 *
 * `loadItems` reads IndexedDB and the server and merges them, which is what makes a
 * resume work on a device that has never seen this run.
 */
export function createBrowserLedger(options: { syncToServer?: boolean } = {}): BrowserLedger {
  const syncToServer = options.syncToServer ?? true;
  let failures = 0;

  return {
    syncFailures: () => failures,

    async saveJob(job) {
      if (indexedDbAvailable()) {
        await putLocalJob(job).catch(() => {
          failures += 1;
        });
      }
      if (!syncToServer) return;
      try {
        const res = await fetch("/api/transition/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            guid: job.guid,
            destination: job.destination,
            env: job.env,
            status: job.status,
            records: job.records,
            fileCount: job.fileCount,
            bytesTotal: job.bytesTotal,
          }),
        });
        if (!res.ok) failures += 1;
      } catch {
        failures += 1;
      }
    },

    async saveItems(jobId, items) {
      if (indexedDbAvailable()) {
        await putLocalItems(jobId, items).catch(() => {
          failures += 1;
        });
      }
      if (!syncToServer) return;
      try {
        const res = await fetch(`/api/transition/jobs/${encodeURIComponent(jobId)}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) failures += 1;
      } catch {
        failures += 1;
      }
    },

    async loadItems(jobId) {
      const local = indexedDbAvailable() ? await getLocalItems(jobId).catch(() => []) : [];
      if (!syncToServer) return local;
      try {
        const res = await fetch(`/api/transition/jobs/${encodeURIComponent(jobId)}/items`, {
          cache: "no-store",
        });
        if (!res.ok) return local;
        const body: { items?: TransferItemSnapshot[] } = await res.json();
        return mergeItems(local, body.items ?? []);
      } catch {
        return local;
      }
    },
  };
}
