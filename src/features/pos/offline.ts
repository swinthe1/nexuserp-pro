/**
 * Offline store for the till: IndexedDB for the catalog cache and the queue of sales waiting to sync.
 * A sale is written to the queue BEFORE anything else happens, so a lost connection, a closed tab or a
 * crash never loses it. The server accepts each sale once (client_uuid), so replays are safe.
 */
import * as React from 'react'
import { supabase } from '@/lib/supabase'
import { clockNow } from './clock'
import { describeError } from '@/lib/errors'
import { carryOver } from '@/lib/offline/carry-over'

const DB_NAME = 'drispro-pos'
let dbp: Promise<IDBDatabase> | null = null
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'client_uuid' })
      // the till's items, one row each ("<till>|<variant>"): a sale or a new price writes only its rows
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items')
    }
    // another tab still has the old version open: it closes, so this one can upgrade
    req.onblocked = () => undefined
    req.onsuccess = () => {
      // a newer version of the program opens it in another tab: this one lets go and opens it again when needed
      req.result.onversionchange = () => { req.result.close(); dbp = null }
      void carryOver('nexus' + '-pos', req.result, ['kv', 'queue']).then(() => resolve(req.result)) }
    req.onerror = () => reject(req.error)
  })
  return dbp
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}
export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
export const kvSet = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key))

/* ------------------------------------------------------------------ the till's items */
const itemRange = (till: string) => IDBKeyRange.bound(`${till}|`, `${till}|￿`)
/** every item kept for this till */
export const itemsAll = <T>(till: string) => tx<T[]>('items', 'readonly', (s) => s.getAll(itemRange(till)) as IDBRequest<T[]>)
/** writes these rows and takes those off; with replace, the till's other rows go too (a full read) */
export function itemsWrite<T extends { variant_id: string }>(till: string, put: readonly T[], del: readonly string[] = [], replace = false): Promise<void> {
  if (!put.length && !del.length && !replace) return Promise.resolve()
  return db().then((d) => new Promise<void>((resolve, reject) => {
    const t = d.transaction('items', 'readwrite')
    const s = t.objectStore('items')
    if (replace) s.delete(itemRange(till))
    for (const id of del) s.delete(`${till}|${id}`)
    for (const it of put) s.put(it, `${till}|${it.variant_id}`)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

/* ------------------------------------------------------------------ queue */
export interface QueuedSale {
  client_uuid: string
  register_id: string
  company_id: string
  device_ref: string
  created_at: string
  total: number
  payload: Record<string, unknown>
  attempts: number
  status: 'pending' | 'failed'
  error?: string
  number?: string
}

type Listener = () => void
const listeners = new Set<Listener>()
let snapshot: { items: QueuedSale[]; online: boolean; syncing: boolean; lastSync: string | null } = {
  items: [], online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, lastSync: null,
}
function emit(patch: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...patch }; listeners.forEach((l) => l()) }
async function reload() { emit({ items: (await tx<QueuedSale[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<QueuedSale[]>)).sort((a, b) => a.created_at.localeCompare(b.created_at)) }) }

export async function enqueue(sale: QueuedSale) {
  // the browser is asked never to clear this till's storage by itself (sales waiting to be sent live there)
  try { void navigator.storage?.persist?.() } catch { /* an older browser */ }
  await tx('queue', 'readwrite', (s) => s.put(sale))
  await reload()
  void syncNow()
}
/** what this till sold and has not yet sent, per item: the stock the server reports does not count it yet */
export function pendingQty(registerId: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const it of snapshot.items) {
    if (it.register_id !== registerId || it.status !== 'pending') continue
    const p = it.payload as { is_refund?: boolean; lines?: { variant_id: string; quantity: number }[] }
    const sign = p.is_refund ? -1 : 1
    for (const l of p.lines ?? []) out.set(l.variant_id, (out.get(l.variant_id) ?? 0) + sign * Number(l.quantity || 0))
  }
  return out
}
/** a sale that carries a signed fiscal coupon is never thrown away: ATK must get it (Kërkesat, neni 25.5: no deleting, only corrections that can be audited) */
export const isFiscal = (it: QueuedSale) => !!(it.payload as { fiscal?: unknown }).fiscal
export async function discard(clientUuid: string) {
  const it = snapshot.items.find((i) => i.client_uuid === clientUuid)
  if (it && isFiscal(it)) throw new Error('A sale with a fiscal coupon cannot be discarded')
  await tx('queue', 'readwrite', (s) => s.delete(clientUuid)); await reload()
}
export async function retry(clientUuid: string) {
  const it = snapshot.items.find((i) => i.client_uuid === clientUuid)
  if (it) { await tx('queue', 'readwrite', (s) => s.put({ ...it, status: 'pending', error: undefined })); await reload(); void syncNow() }
}

const isNetworkError = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e)
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET|timeout|abort/i.test(m)
}

let running: Promise<void> | null = null
/** Pushes pending sales oldest first; stops at the first network failure and tries again later */
export function syncNow(): Promise<void> {
  running ??= (async () => {
    emit({ syncing: true })
    try {
      await reload()
      for (const it of snapshot.items.filter((i) => i.status === 'pending')) {
        try {
          // a server that went quiet is not waited for long: the sale stays in the queue and goes on the next round
          const { data, error } = await supabase.rpc('pos_submit_order', { p: it.payload as never }).abortSignal(AbortSignal.timeout(20_000))
          if (error) throw error
          await tx('queue', 'readwrite', (s) => s.delete(it.client_uuid))
          emit({ online: true, lastSync: new Date().toISOString() })
          onSynced.forEach((f) => f({ ...it, number: (data as { number?: string })?.number }))
        } catch (e) {
          if (isNetworkError(e)) { emit({ online: false }); break }
          const msg = describeError(e)
          // the session was closed while this sale waited: move it to the register's open session if there is one
          if (/SESSION_CLOSED/.test(msg)) {
            const { data: open } = await supabase.from('pos_sessions').select('id').eq('register_id', it.register_id).eq('status', 'open').maybeSingle()
            if (open && open.id !== it.payload.session_id) {
              // it remembers the shift it was sold in, so the two counts can be explained
              const from = (it.payload as { moved_from_session_id?: string }).moved_from_session_id ?? it.payload.session_id
              await tx('queue', 'readwrite', (s) => s.put({ ...it, payload: { ...it.payload, session_id: open.id, moved_from_session_id: from }, attempts: it.attempts + 1 }))
              continue
            }
          }
          await tx('queue', 'readwrite', (s) => s.put({ ...it, status: 'failed', error: msg, attempts: it.attempts + 1 }))
          // a signed fiscal coupon the server refused: its trace goes to the SEF log on the server, so it is known even if this device is lost
          const fiscal = (it.payload as { fiscal?: Record<string, unknown> | null }).fiscal
          if (fiscal) void supabase.rpc('atk_report_stuck' as never, { p_register: it.register_id, p_fiscal: fiscal, p_error: msg } as never).then(() => undefined, () => undefined)
        }
      }
      if (snapshot.online) await flushTillLog().catch(() => undefined)
    } finally {
      await reload()
      emit({ syncing: false })
      running = null
    }
  })()
  return running
}

/* ------------------------------------------------------------------ the till's log (voids) */
export type TillLogEntry = {
  id: string; session_id: string; kind: 'void_line' | 'void_qty' | 'void_sale'
  variant_id?: string | null; description?: string | null; quantity?: number | null; amount?: number; at: string; approval?: string | null; offline?: boolean
}
const LOG_KEY = 'tilllog'
let logChain: Promise<unknown> = Promise.resolve()
/** kept on the device first, like a sale, then sent; a step sent twice is kept once by the server */
export function logTill(entries: TillLogEntry[]) {
  if (!entries.length) return Promise.resolve()
  logChain = logChain.then(async () => {
    const cur = (await kvGet<TillLogEntry[]>(LOG_KEY)) ?? []
    await kvSet(LOG_KEY, [...cur, ...entries])
  }).catch(() => undefined)
  return logChain.then(() => { void flushTillLog().catch(() => undefined) })
}
let flushing: Promise<void> | null = null
export function flushTillLog(): Promise<void> {
  flushing ??= (async () => {
    try {
      await logChain
      const all = (await kvGet<TillLogEntry[]>(LOG_KEY)) ?? []
      if (!all.length) return
      const sent = new Set<string>()
      for (const sid of [...new Set(all.map((e) => e.session_id))]) {
        const items = all.filter((e) => e.session_id === sid).map(({ session_id: _s, ...e }) => e)
        const { error } = await supabase.rpc('pos_log', { p_session: sid, p_items: items as never })
        if (error) {
          if (isNetworkError(error)) break
          // a session the server does not know any more: nothing more can be done with these
          if (!/Session not found/.test(error.message)) continue
        }
        items.forEach((e) => sent.add(e.id))
      }
      if (sent.size) {
        logChain = logChain.then(async () => {
          const now = (await kvGet<TillLogEntry[]>(LOG_KEY)) ?? []
          await kvSet(LOG_KEY, now.filter((e) => !sent.has(e.id)))
        }).catch(() => undefined)
        await logChain
      }
    } finally { flushing = null }
  })()
  return flushing
}

/** the server answered again after a time without it: the till sends what waited and fetches what changed */
const onBack = new Set<() => void>()
export function useOnServerBack(fn: () => void) {
  React.useEffect(() => { onBack.add(fn); return () => { onBack.delete(fn) } }, [fn])
}

/**
 * Every 10 seconds the till asks the server whether it is there (a tiny call, given 3 seconds).
 * So a server switched off or a cable pulled is known before the next sale, the sale is kept on the
 * till at once and its coupon prints marked offline, without waiting for an answer that will not come.
 */
async function heartbeat() {
  if (!navigator.onLine) { if (snapshot.online) emit({ online: false }); return }
  let up = true
  try {
    const { error } = await supabase.rpc('pos_ping').abortSignal(AbortSignal.timeout(3000))
    // any answer from the server counts (an older server without the call answers "not found")
    if (error && isNetworkError(error)) up = false
  } catch (e) { up = !isNetworkError(e) }
  if (up && !snapshot.online) { emit({ online: true }); void syncNow(); onBack.forEach((f) => f()) }
  else if (!up && snapshot.online) emit({ online: false })
}

const onSynced = new Set<(it: QueuedSale) => void>()
export function useOnSynced(fn: (it: QueuedSale) => void) {
  React.useEffect(() => { onSynced.add(fn); return () => { onSynced.delete(fn) } }, [fn])
}

let started = false
function start() {
  if (started || typeof window === 'undefined') return
  started = true
  void reload()
  window.addEventListener('online', () => { void heartbeat() })
  window.addEventListener('offline', () => emit({ online: false }))
  void heartbeat()
  setInterval(() => void heartbeat(), 10_000)
  // what waits is sent every few seconds while the server answers
  setInterval(() => { if (snapshot.items.some((i) => i.status === 'pending') && snapshot.online) void syncNow(); else if (snapshot.online) void flushTillLog().catch(() => undefined) }, 5_000)
}

export function useSyncState() {
  start()
  return React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => snapshot)
}

/** Local receipt numbers keep counting while offline: T1-241024-0007 */
export async function nextDeviceRef(registerCode: string) {
  const day = clockNow()
  const d = `${String(day.getFullYear()).slice(2)}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  const key = `seq:${registerCode}:${d}`
  const n = ((await kvGet<number>(key)) ?? 0) + 1
  await kvSet(key, n)
  return `${registerCode}-${d}-${String(n).padStart(4, '0')}`
}
