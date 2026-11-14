/**
 * This device's own DrisPRO licence. A browser or a phone makes an id and a secret of its own, asks DrisPRO for a
 * pairing code and shows it; DrisPRO's Super Admin approves the code for the client. From then on every request
 * carries the device's id and key (x-drispro-device, x-drispro-device-key), and the device renews its 30-day lease
 * whenever it reaches DrisPRO. The Windows program has its own licence and gives it to the page (deviceAuth).
 * The licences live in the DrisPRO cloud, also for a local server (which gets a copy of them).
 */
import { CLOUD } from '@/lib/cloud'
import { desktop } from '@/lib/desktop'

const KEY = 'drispro.device'
const PAIRING = 'drispro.device.pairing'

export type DeviceCreds = { id: string; secret: string }
export type Pairing = { id: string; secret: string; code: string; expires_at: string }
export type PairState = { status: 'waiting' | 'expired' | 'unknown' | 'active' | 'pending' | 'blocked'; code?: string; label?: string; name?: string; company?: string }

const isLocal = typeof window !== 'undefined' && !!(window as unknown as { __DRISPRO__?: unknown }).__DRISPRO__
const api = isLocal || !import.meta.env.VITE_SUPABASE_URL ? CLOUD : { url: String(import.meta.env.VITE_SUPABASE_URL), key: String(import.meta.env.VITE_SUPABASE_ANON_KEY) }

function read<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null } catch { return null }
}
function write(k: string, v: unknown) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window: no licence kept */ }
}

/** the licence this device sends with every request (none: it has not been approved yet) */
export function deviceCreds(): DeviceCreds | null {
  try { const d = desktop?.deviceAuth?.(); if (d?.id && d.secret) return d } catch { /* an older program */ }
  const c = read<DeviceCreds>(KEY)
  return c?.id && c.secret ? c : null
}

/** the device headers for a request (empty without a licence) */
export function deviceHeaders(): Record<string, string> {
  const c = deviceCreds()
  return c ? { 'x-drispro-device': c.id, 'x-drispro-device-key': c.secret } : {}
}

/** a phone or tablet is a phone; anything else is a computer of the administration */
export const deviceKind = (): 'mobile' | 'office' =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'office'

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const r = await fetch(`${api.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: api.key, Authorization: `Bearer ${api.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await r.text()
  let json: unknown = null; try { json = JSON.parse(text) } catch { /* not json */ }
  if (!r.ok) throw new Error((json as { message?: string } | null)?.message || text.slice(0, 200) || `HTTP ${r.status}`)
  return json as T
}

function secret(): string {
  const b = new Uint8Array(32); crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** the pairing this device is waiting on (a new one when there is none or it ran out) */
export async function startPairing(name?: string): Promise<Pairing> {
  const open = read<Pairing>(PAIRING)
  if (open && new Date(open.expires_at).getTime() > Date.now() + 60_000) return open
  const s = secret()
  const r = await rpc<{ id: string; code: string; expires_at: string }>('device_pair_start', { p: {
    secret: s, kind: deviceKind(), name: name || undefined, user_agent: navigator.userAgent.slice(0, 300), platform: navigator.platform || undefined,
    server: typeof location !== 'undefined' ? location.origin : undefined } })
  const p = { id: r.id, secret: s, code: r.code, expires_at: r.expires_at }
  write(PAIRING, p)
  return p
}

/** asks whether the code was approved; when it was, the device keeps its licence */
export async function checkPairing(p: Pairing): Promise<PairState> {
  const r = await rpc<PairState & { id?: string }>('device_pair_status', { p_id: p.id, p_secret: p.secret })
  if (r.status === 'active') { write(KEY, { id: p.id, secret: p.secret }); write(PAIRING, null) }
  if (r.status === 'expired' || r.status === 'unknown') write(PAIRING, null)
  return r
}

/** renews the lease (30 days) now and then; a device DrisPRO no longer knows forgets its licence */
export async function renewLease(): Promise<void> {
  if (desktop?.deviceAuth) return   // the Windows program renews its own
  const c = read<DeviceCreds>(KEY)
  if (!c) return
  const last = Number(read<number>(`${KEY}.renewed`) ?? 0)
  if (Date.now() - last < 6 * 3600_000) return
  try {
    const r = await rpc<{ status: string }>('device_ping', { p_device: c.id, p_secret: c.secret, p: { user_agent: navigator.userAgent.slice(0, 300) } })
    if (r.status === 'unknown') write(KEY, null)
    else write(`${KEY}.renewed`, Date.now())
  } catch { /* no internet: the lease runs on */ }
}

/** the error the API gives a request from a device without licence */
export const isDeviceLicenceError = (e: unknown): boolean => /no DrisPRO licence/.test(String((e as { message?: string } | null)?.message ?? e))
