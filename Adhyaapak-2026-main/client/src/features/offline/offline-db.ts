/**
 * Small promise wrapper over IndexedDB. IndexedDB holds only two things: lesson packs the teacher chose to
 * download (no student names, no answer keys shown to students) and the queue of operations waiting to sync.
 * The central PostgreSQL database stays the source of truth (CLAUDE.md §9, §13).
 */
const DB_NAME = "adhyaapak-offline";
const DB_VERSION = 1;
export const STORES = { packs: "packs", queue: "queue" } as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

let opening: Promise<IDBDatabase> | undefined;

export function openOfflineDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store data for offline use."));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.packs)) db.createObjectStore(STORES.packs, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.queue)) db.createObjectStore(STORES.queue, { keyPath: "operation.idempotencyKey" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open offline storage."));
    req.onblocked = () => reject(new Error("Offline storage is busy. Close other tabs of this app and try again."));
  });
  opening = attempt;
  attempt.catch(() => {
    opening = undefined; // allow a retry after a failure
  });
  return attempt;
}

/** Closes the connection and forgets it. Tests use this to start from a clean database. */
export async function resetOfflineDbConnection(): Promise<void> {
  if (!opening) return;
  const db = await opening.catch(() => undefined);
  db?.close();
  opening = undefined;
}

function request<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openOfflineDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        // Resolve only when the transaction has committed, so a "saved" answer really is saved.
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error("Saving to offline storage was cancelled."));
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => request<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbAll = <T>(store: StoreName) => request<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
export const idbPut = (store: StoreName, value: unknown) => request(store, "readwrite", (s) => s.put(value)).then(() => undefined);
export const idbAdd = (store: StoreName, value: unknown) => request(store, "readwrite", (s) => s.add(value)).then(() => undefined);
export const idbDelete = (store: StoreName, key: string) => request(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
