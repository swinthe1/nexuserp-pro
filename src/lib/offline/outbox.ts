/**
 * The outbox: work done without internet, kept on the device and sent in order when the
 * connection is back. Every item is one server call that the server accepts only once
 * (each carries its own id), so sending it again after a cut is safe.
 *
 * Items of one "chain" (e.g. one restaurant table) go strictly in order: when one is refused,
 * the ones after it wait, so nothing is applied on top of a step that did not happen.
 */
import * as React from 'react'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { idb } from './idb'

export interface OutboxItem {
  id: string
  company_id: string
  /** who did it: only their own items are sent while they are signed in */
  user_id: string
  /** the server function and its arguments */
  fn: string
  args: Record<string, unknown>
  /** what the person sees in the list, e.g. "Table 4: 3 items" */
  label: string
  /** items with the same chain are sent strictly in order */
  chain?: string
  /** query keys to refresh once it is through */
  invalidate?: unknown[][]
  created_at: string
  attempts: number
  status: 'pending' | 'failed'
  error?: string
}

type State = { items: OutboxItem[]; online: boolean; syncing: boolean; lastSync: string | null }
let state: State = { items: [], online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, lastSync: null }
const listeners = new Set<() => void>()
const doneListeners = new Set<(it: OutboxItem, result: unknown) => void>()
function emit(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()) }

async function reload() {
  try {
    const items = await idb<OutboxItem[]>('outbox', 'readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)
    emit({ items: items.sort((a, b) => a.created_at.localeCompare(b.created_at)) })
  } catch { /* no IndexedDB (private window): the list stays empty */ }
}

// who is signed in, kept from the sign-in events (asking for the session can wait on a token
// renewal that never finishes while offline)
let currentUser: string | null = null
if (typeof window !== 'undefined') supabase.auth.onAuthStateChange((_e, session) => { currentUser = session?.user.id ?? null; if (currentUser && navigator.onLine) void flush() })
const whoAmI = async () => currentUser ?? (await Promise.race([
  supabase.auth.getSession().then((r) => r.data.session?.user.id ?? null),
  new Promise<null>((r) => setTimeout(() => r(null), 3000)),
]))

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
}))

/** Keep a call for later. Resolves once it is safely stored on the device. */
export async function enqueue(it: Omit<OutboxItem, 'id' | 'created_at' | 'attempts' | 'status' | 'user_id'> & { id?: string }) {
  const user = await whoAmI()
  if (!user) throw new Error('Not signed in')
  const item: OutboxItem = { ...it, user_id: user, id: it.id ?? newId(), created_at: new Date().toISOString(), attempts: 0, status: 'pending' }
  await idb('outbox', 'readwrite', (s) => s.put(item))
  await reload()
  if (navigator.onLine) void flush()
  return item
}

export async function discard(id: string) { await idb('outbox', 'readwrite', (s) => s.delete(id)); await reload() }
export async function retry(id: string) {
  const it = state.items.find((x) => x.id === id)
  if (it) { await idb('outbox', 'readwrite', (s) => s.put({ ...it, status: 'pending', error: undefined })); await reload() }
  void flush()
}

const isNetworkError = (e: unknown) => {
  if (!navigator.onLine) return true
  const m = String((e as { message?: string })?.message ?? e)
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(m)
}

let running: Promise<void> | null = null
/** Send what is waiting, in order. Stops at the first network failure (tries again later). */
export function flush(): Promise<void> {
  running ??= (async () => {
    await reload()
    const me = await whoAmI()
    if (!me || !state.items.some((i) => i.status === 'pending' && i.user_id === me)) { running = null; return }
    emit({ syncing: true })
    const blocked = new Set(state.items.filter((i) => i.status === 'failed' && i.chain).map((i) => i.chain!))
    try {
      for (const it of state.items) {
        if (it.status !== 'pending' || it.user_id !== me) continue
        if (it.chain && blocked.has(it.chain)) continue
        const { data, error } = await supabase.rpc(it.fn as never, it.args as never)
        if (error) {
          if (isNetworkError(error)) break
          // a sign-in that ran out while offline: renew it and try again on the next round
          if (error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt expired/i.test(error.message ?? '')) { await supabase.auth.refreshSession().catch(() => undefined); break }
          await idb('outbox', 'readwrite', (s) => s.put({ ...it, attempts: it.attempts + 1, status: 'failed', error: describeError(error) }))
          if (it.chain) blocked.add(it.chain)
          continue
        }
        await idb('outbox', 'readwrite', (s) => s.delete(it.id))
        doneListeners.forEach((l) => l(it, data))
      }
      emit({ lastSync: new Date().toISOString() })
    } catch (e) {
      if (!isNetworkError(e)) console.error('outbox', e)
    } finally {
      await reload()
      emit({ syncing: false })
      running = null
    }
  })()
  return running
}

if (typeof window !== 'undefined') {
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__outbox = { get state() { return state }, flush, get running() { return running } }
  window.addEventListener('online', () => { emit({ online: true }); void flush() })
  window.addEventListener('offline', () => emit({ online: false }))
  setInterval(() => { if (navigator.onLine && state.items.some((i) => i.status === 'pending')) void flush() }, 30_000)
  void reload().then(() => { if (navigator.onLine) void flush() })
}

export function onOutboxDone(fn: (it: OutboxItem, result: unknown) => void) { doneListeners.add(fn); return () => { doneListeners.delete(fn) } }

export function useOutbox(companyId?: string | null) {
  const s = React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state, () => state)
  return React.useMemo(() => ({ ...s, items: companyId ? s.items.filter((i) => i.company_id === companyId) : s.items }), [s, companyId])
}

/** Is something of this chain still on the device (waiting, or refused)? Then new steps of it must queue behind it. */
export const hasPending = (chain: string) => state.items.some((i) => i.chain === chain)

export const isOnline = () => state.online && (typeof navigator === 'undefined' || navigator.onLine)
