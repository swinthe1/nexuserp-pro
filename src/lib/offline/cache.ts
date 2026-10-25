/**
 * Keeps what was read on this device, so a screen opened before the connection dropped still shows
 * its last data offline (read-only). Saved per person; removed when they sign out.
 */
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { kv } from './idb'

const MAX_AGE = 7 * 24 * 3600_000
const keyFor = (userId: string) => `query-cache:${userId}`
// big, short-lived or not useful offline
const SKIP = new Set(['my-context', 'search', 'agent-log', 'images'])

interface Saved { at: number; version: string; state: unknown }
const VERSION = '1'

export async function restoreQueryCache(client: QueryClient, userId: string) {
  const saved = await kv.get<Saved>(keyFor(userId))
  if (!saved || saved.version !== VERSION || Date.now() - saved.at > MAX_AGE) return false
  try { hydrate(client, saved.state as never) } catch { return false }
  return true
}

export function persistQueryCache(client: QueryClient, userId: string) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    timer = null
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && !SKIP.has(String(q.queryKey[0])) && !SKIP.has(String(q.queryKey[2] ?? '')),
      shouldDehydrateMutation: () => false,
    })
    void kv.set(keyFor(userId), { at: Date.now(), version: VERSION, state } satisfies Saved)
  }
  const unsub = client.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return
    if (!timer) timer = setTimeout(save, 4000)
  })
  const onHide = () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); save() } }
  document.addEventListener('visibilitychange', onHide)
  return () => { unsub(); document.removeEventListener('visibilitychange', onHide); if (timer) clearTimeout(timer) }
}

export const forgetQueryCache = (userId: string) => kv.del(keyFor(userId))
