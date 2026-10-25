/** A tiny IndexedDB wrapper for the offline cache and the outbox (one database, two stores). */
const DB_NAME = 'nexus-offline'
let dbp: Promise<IDBDatabase> | null = null

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbp = null; reject(req.error) }
  })
  return dbp
}

export function idb<T>(store: 'kv' | 'outbox', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r ? r.result : (undefined as T))
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

export const kv = {
  get: <T>(key: string) => idb<T | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined),
  set: (key: string, value: unknown) => idb('kv', 'readwrite', (s) => s.put(value, key)).catch(() => undefined),
  del: (key: string) => idb('kv', 'readwrite', (s) => s.delete(key)).catch(() => undefined),
}
