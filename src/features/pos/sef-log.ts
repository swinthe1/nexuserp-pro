/**
 * What the till itself sees for ATK's log (Kërkesat specifike, neni 25.15): when it was opened, when the internet
 * dropped and came back (with how long and how many coupons were waiting), when its clock was off.
 * Kept on the device first, like a sale, then sent; the server keeps each step once (see atk_log_events).
 * The sends to ATK, their errors and the changes to the SEF are logged by the server itself.
 */
import { supabase } from '@/lib/supabase'
import { clockNow } from './clock'
import { kvGet, kvSet } from './offline'

type SefEvent = { id: string; register_id: string; kind: 'started' | 'offline' | 'online' | 'clock'; at: string; details?: Record<string, unknown> }
const KEY = 'seflog'
const SINCE = 'sef.offline_since'

let chain: Promise<unknown> = Promise.resolve()
export function logSef(registerId: string, kind: SefEvent['kind'], details?: Record<string, unknown>) {
  const e: SefEvent = { id: crypto.randomUUID(), register_id: registerId, kind, at: clockNow().toISOString(), details }
  chain = chain.then(async () => { await kvSet(KEY, [...((await kvGet<SefEvent[]>(KEY)) ?? []), e].slice(-2000)) }).catch(() => undefined)
  return chain.then(() => { if (navigator.onLine) void flushSef() })
}

let flushing: Promise<void> | null = null
export function flushSef(): Promise<void> {
  flushing ??= (async () => {
    try {
      await chain
      const all = (await kvGet<SefEvent[]>(KEY)) ?? []
      if (!all.length) return
      const { error } = await supabase.rpc('atk_log_events', { p_events: all as never })
      if (error) return
      const sent = new Set(all.map((e) => e.id))
      chain = chain.then(async () => { await kvSet(KEY, ((await kvGet<SefEvent[]>(KEY)) ?? []).filter((e) => !sent.has(e.id))) }).catch(() => undefined)
      await chain
    } catch { /* tried again later */ } finally { flushing = null }
  })()
  return flushing
}

const lastStart: Record<string, number> = {}
/**
 * Watches the connection while a till is open. Call once when the till opens; returns the function that stops it.
 * `waiting` says how many sales are still on the device when the connection comes back.
 */
export function watchSef(registerId: string, waiting: () => number) {
  const offline = async () => {
    if (await kvGet<string>(SINCE)) return
    const at = clockNow().toISOString()
    await kvSet(SINCE, at)
    void logSef(registerId, 'offline')
  }
  const online = async () => {
    const since = await kvGet<string>(SINCE)
    if (!since) { void flushSef(); return }
    await kvSet(SINCE, null)
    const secs = Math.max(0, Math.round((clockNow().getTime() - new Date(since).getTime()) / 1000))
    void logSef(registerId, 'online', { offline_since: since, offline_seconds: secs, waiting: waiting() })
  }
  // once per opening (a page shown twice in a row is one opening)
  if (lastStart[registerId] === undefined || Date.now() - lastStart[registerId]! > 10_000) {
    lastStart[registerId] = Date.now()
    void logSef(registerId, 'started', { device: navigator.userAgent.slice(0, 160), online: navigator.onLine })
  }
  // closed while offline: the interruption ends now, when it is open and online again
  void (navigator.onLine ? online() : offline())
  window.addEventListener('offline', offline)
  window.addEventListener('online', online)
  const id = setInterval(() => { if (navigator.onLine) void flushSef() }, 60_000)
  return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); clearInterval(id) }
}
