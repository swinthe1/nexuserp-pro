/**
 * The till's clock, set by the server's ("Sinkronizimi i kohës": every fiscal coupon carries the real date and time
 * to the second). The difference to the server is measured when the till opens and every 30 minutes, and kept
 * on the device, so a sale made offline still gets the right time.
 *
 * Without the server the device clock can still be moved. Two things are done about it:
 *  - moved while the till is open: the steady clock (which no one can set) shows by how much the wall clock jumped,
 *    and the difference is corrected by that much. A jump forward is corrected only on Windows, where the steady
 *    clock keeps counting while the computer sleeps; elsewhere a sleep looks the same as a clock moved forward.
 *  - moved back while the till was closed: the time never goes before the last time the till has seen.
 * A clock moved forward while the till is closed and offline cannot be known; it is measured when the server answers.
 */
import * as React from 'react'
import { supabase } from '@/lib/supabase'

const KEY = 'drispro.clock.offset'
/** further off than this and the cashier is told to fix the device's clock */
export const CLOCK_WARN_MS = 2 * 60_000

const SEEN = 'drispro.clock.seen'
/** what the till did about a clock moved without the server; kept for the log */
export type ClockGuess = { jump_seconds: number; corrected: boolean; while: 'open' | 'closed' }

let offset = (() => { try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 } })()
let startGuess: ClockGuess | null = null
function keep() { try { localStorage.setItem(KEY, String(offset)) } catch { /* ignore */ } }
function seen() { try { localStorage.setItem(SEEN, String(Date.now() + offset)) } catch { /* ignore */ } }
// the clock was moved back while the till was closed: the time does not go before the last one seen
;(() => {
  try {
    const last = Number(localStorage.getItem(SEEN)) || 0
    const back = last - (Date.now() + offset)
    if (last && back > 5000) { offset += back; keep(); startGuess = { jump_seconds: -Math.round(back / 1000), corrected: true, while: 'closed' } }
  } catch { /* ignore */ }
})()
let wall = Date.now(), steady = performance.now()
const steadyThroughSleep = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** the time now, by the server's clock */
export function clockNow(): Date {
  // a clock moved in the seconds since the last check is already seen here, so no sale gets the wrong time
  const jump = (Date.now() - wall) - (performance.now() - steady)
  const fix = Math.abs(jump) > 5000 && (jump < 0 || steadyThroughSleep) ? jump : 0
  return new Date(Date.now() - fix + offset)
}
export function clockOffset() { return offset }

/** measures the difference to the server; null when the server cannot be reached */
export async function syncClock(): Promise<number | null> {
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  const t1 = Date.now()
  if (error || !data || t1 - t0 > 10_000) return null
  const server = new Date(data as unknown as string).getTime()
  if (!Number.isFinite(server)) return null
  offset = Math.round(server - (t0 + t1) / 2)
  keep(); seen()
  return offset
}

/** keeps the clock set while the till is open; gives the difference (ms) when it is big enough to tell the cashier */
export function useClockCheck(onOff?: (ms: number, guess?: ClockGuess) => void) {
  const [off, setOff] = React.useState(() => (Math.abs(offset) > CLOCK_WARN_MS ? offset : 0))
  const cb = React.useRef(onOff)
  cb.current = onOff
  React.useEffect(() => {
    let alive = true
    const run = async () => {
      const o = await syncClock().catch(() => null)
      if (!alive) return
      if (o === null) { if (startGuess) { cb.current?.(offset, startGuess); startGuess = null }; return }
      startGuess = null
      const big = Math.abs(o) > CLOCK_WARN_MS
      setOff(big ? o : 0)
      if (big) cb.current?.(o)
    }
    void run()
    const id = setInterval(run, 30 * 60_000)
    window.addEventListener('online', run)
    // the device's clock moved by hand (or the device slept): the wall clock and the steady one no longer agree,
    // so the difference to the server is measured again at once, not at the next half hour
    wall = Date.now(); steady = performance.now()
    let busy = false
    const watch = setInterval(async () => {
      if (busy) return
      const w = Date.now(), p = performance.now()
      const jump = (w - wall) - (p - steady)
      wall = w; steady = p
      if (Math.abs(jump) <= 5000) { seen(); return }
      busy = true
      try {
        // the wall clock jumped, the steady one says by how much: corrected at once, so a sale made while the
        // server is being asked already has the right time; the server's answer, when there is one, replaces it
        const corrected = jump < 0 || steadyThroughSleep
        if (corrected) { offset -= Math.round(jump); keep(); seen() }
        const o = await syncClock().catch(() => null)
        if (!alive) return
        if (o !== null) { const big = Math.abs(o) > CLOCK_WARN_MS; setOff(big ? o : 0); if (big) cb.current?.(o); return }
        setOff(Math.abs(offset) > CLOCK_WARN_MS ? offset : 0)
        cb.current?.(offset, { jump_seconds: Math.round(jump / 1000), corrected, while: 'open' })
      } finally { busy = false }
    }, 5000)
    return () => { alive = false; clearInterval(id); clearInterval(watch); window.removeEventListener('online', run) }
  }, [])
  return off
}
