import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { persistQueryCache, restoreQueryCache } from '@/lib/offline/cache'
import { onOutboxDone } from '@/lib/offline/outbox'

/** Keeps the last data on this device for offline reading, and refreshes screens when queued work goes through. */
export function OfflineSync() {
  const { user } = useAuth()
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!user) return
    let stop: (() => void) | undefined
    let cancelled = false
    void restoreQueryCache(qc, user.id).finally(() => { if (!cancelled) stop = persistQueryCache(qc, user.id) })
    return () => { cancelled = true; stop?.() }
  }, [qc, user])
  React.useEffect(() => onOutboxDone((it) => { for (const k of it.invalidate ?? []) void qc.invalidateQueries({ queryKey: k }) }), [qc])
  return null
}
