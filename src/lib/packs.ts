/** Packaging units: an item bought or sold by the box (box = 24 pieces). Quantities stay in pieces; the pack is how they are counted. */
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type Pack = { id: string; product_id: string; name: string; factor: number; barcode: string | null; is_default: boolean; variants: string[] }

export function usePacks() {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['packs', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => (unwrap(await supabase.rpc('product_packs_all', { p_company: companyId! })) ?? []) as unknown as Pack[],
  })
  const byVariant = React.useMemo(() => {
    const m = new Map<string, Pack[]>()
    for (const k of q.data ?? []) for (const v of k.variants) m.set(v, [...(m.get(v) ?? []), k])
    return m
  }, [q.data])
  const byId = React.useMemo(() => new Map((q.data ?? []).map((k) => [k.id, k])), [q.data])
  return { packs: q.data ?? [], byVariant, byId, isLoading: q.isLoading }
}

const trim = (n: number) => String(Math.round(n * 10000) / 10000)

/** "2 Kuti × 24 + 3" — the same text the server prints */
export function packText(qty: number, pack: Pick<Pack, 'name' | 'factor'> | null | undefined) {
  if (!pack || pack.factor === 1 || Math.abs(qty) < pack.factor) return null
  const q = Math.abs(qty)
  const n = Math.trunc(q / pack.factor)
  const rest = Math.round((q - n * pack.factor) * 10000) / 10000
  return `${n} ${pack.name} × ${trim(pack.factor)}${rest > 0 ? ` + ${trim(rest)}` : ''}`
}

/** the pack whose size matches a scanned barcode's pieces per scan */
export const packForScan = (packs: Pack[] | undefined, perScan: number) => perScan > 1 ? packs?.find((k) => k.factor === perScan) ?? null : null
