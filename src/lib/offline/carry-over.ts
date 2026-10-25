/**
 * The browser databases had another name before (the program was called NexusERP). On first open
 * under the new name, whatever the old one still holds — above all sales and documents waiting to be
 * sent — is copied over, then the old database is removed. Nothing is lost if it fails half way:
 * the old one is removed only after the copy is written.
 */
export async function carryOver(oldName: string, target: IDBDatabase, stores: string[]): Promise<void> {
  try {
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases()
      if (!list.some((d) => d.name === oldName)) return
    }
    const old = await new Promise<IDBDatabase | null>((resolve) => {
      let fresh = false
      const req = indexedDB.open(oldName)
      req.onupgradeneeded = () => { fresh = true }
      req.onsuccess = () => {
        if (fresh) { req.result.close(); indexedDB.deleteDatabase(oldName); resolve(null) } else resolve(req.result)
      }
      req.onerror = () => resolve(null)
    })
    if (!old) return
    for (const name of stores) {
      if (!old.objectStoreNames.contains(name) || !target.objectStoreNames.contains(name)) continue
      const rows = await new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve, reject) => {
        const out: { key: IDBValidKey; value: unknown }[] = []
        const cur = old.transaction(name, 'readonly').objectStore(name).openCursor()
        cur.onsuccess = () => { const c = cur.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue() } else resolve(out) }
        cur.onerror = () => reject(cur.error)
      })
      if (!rows.length) continue
      await new Promise<void>((resolve, reject) => {
        const t = target.transaction(name, 'readwrite')
        const s = t.objectStore(name)
        for (const r of rows) { if (s.keyPath == null) s.put(r.value, r.key); else s.put(r.value) }
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      })
    }
    old.close()
    indexedDB.deleteDatabase(oldName)
  } catch {
    /* the old data stays where it was; the next start tries again */
  }
}
