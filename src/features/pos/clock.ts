/**
 * The till's clock, set by the server's ("Sinkronizimi i kohës": every fiscal coupon carries the real date and time
 * to the second). The difference to the server is measured when the till opens and every 30 minutes, and kept
 * on the device, so a sale made offline still gets the right time.
 */
import * as React from 'react'
import { supabase } from '@/lib/supabase'

const KEY = 'drispro.clock.offset'
/** further off than this and the cashier is told to fix the device's clock */
export const CLOCK_WARN_MS = 2 * 60_000

let offset = (() => { try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 } })()

/** the time now, by the server's clock */
export function clockNow(): Date { return new Date(Date.now() + offset) }
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
  try { localStorage.setItem(KEY, String(offset)) } catch { /* ignore */ }
  return offset
}

/** keeps the clock set while the till is open; gives the difference (ms) when it is big enough to tell the cashier */
export function useClockCheck(onOff?: (ms: number) => void) {
  const [off, setOff] = React.useState(() => (Math.abs(offset) > CLOCK_WARN_MS ? offset : 0))
  const cb = React.useRef(onOff)
  cb.current = onOff
  React.useEffect(() => {
    let alive = true
    const run = async () => {
      const o = await syncClock().catch(() => null)
      if (!alive || o === null) return
      const big = Math.abs(o) > CLOCK_WARN_MS
      setOff(big ? o : 0)
      if (big) cb.current?.(o)
    }
    void run()
    const id = setInterval(run, 30 * 60_000)
    window.addEventListener('online', run)
    // the device's clock moved by hand (or the device slept): the wall clock and the steady one no longer agree,
    // so the difference to the server is measured again at once, not at the next half hour
    let wall = Date.now(), steady = performance.now()
    const watch = setInterval(() => {
      const w = Date.now(), p = performance.now()
      const jump = (w - wall) - (p - steady)
      wall = w; steady = p
      if (Math.abs(jump) > 5000) void run()
    }, 5000)
    return () => { alive = false; clearInterval(id); clearInterval(watch); window.removeEventListener('online', run) }
  }, [])
  return off
}
