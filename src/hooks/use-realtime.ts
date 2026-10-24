import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Subscribes to Postgres changes on a table for one company and invalidates the
 * given query key prefixes when anything changes. RLS still filters events.
 */
export function useRealtimeInvalidate(table: string, companyId: string, keys: ReadonlyArray<readonly unknown[]>, onEvent?: (payload: unknown) => void) {
  const qc = useQueryClient()
  const cb = React.useRef(onEvent)
  cb.current = onEvent
  const keysJson = JSON.stringify(keys)
  React.useEffect(() => {
    if (!companyId) return
    const parsed = JSON.parse(keysJson) as unknown[][]
    const channel = supabase
      .channel(`rt:${table}:${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` }, (payload) => {
        parsed.forEach((k) => void qc.invalidateQueries({ queryKey: k }))
        cb.current?.(payload)
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [table, companyId, keysJson, qc])
}
