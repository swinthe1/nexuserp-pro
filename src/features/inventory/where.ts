import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { t, td } from '@/i18n'
import { formatQty } from '@/lib/utils'

/** one unit (store or warehouse) for one item */
export interface UnitStock {
  id: string; code: string; name: string; type: 'warehouse' | 'store' | 'production'
  on_hand: number; reserved: number; available: number; outgoing: number; incoming: number
  min_qty: number | null; max_qty: number | null; sold_30: number; spare: number
  /** none = the unit does not carry it; out = nothing free; low = at or under its minimum */
  status: 'none' | 'out' | 'low' | 'ok'
  here: boolean; mine: boolean
  docs: { id: string; number: string; status: string; is_request: boolean; qty: number; from: string }[]
}
export interface WhereSuggestion {
  to: string; to_name: string
  /** transfer: take it from another unit · coming: enough is already on its way · buy: nobody can spare it */
  kind: 'transfer' | 'coming' | 'buy'
  from?: string; from_name?: string; from_available?: number; from_spare?: number
  qty: number | null; need?: number | null; rest?: number; incoming: number
  /** rule: up to the unit's maximum · sales: two weeks of sales · spare: half of what the other unit can spare */
  basis: 'rule' | 'sales' | 'spare'
  vendor_name?: string | null
}
export interface WhereResult {
  found: boolean
  matches?: { variant_id: string; sku: string; name: string }[]
  item?: { variant_id: string; product_id: string; sku: string; name: string; product_type: string; price: number; unit: string | null; barcode: string | null; class?: string | null }
  here?: string | null
  units?: UnitStock[]
  suggestions?: WhereSuggestion[]
  can_request?: boolean
}

const num = (v: unknown) => (v == null ? null : Number(v))
function clean(r: WhereResult): WhereResult {
  if (!r.found) return r
  return {
    ...r,
    units: (r.units ?? []).map((u) => ({ ...u, on_hand: Number(u.on_hand), reserved: Number(u.reserved), available: Number(u.available), outgoing: Number(u.outgoing),
      incoming: Number(u.incoming), min_qty: num(u.min_qty), max_qty: num(u.max_qty), sold_30: Number(u.sold_30), spare: Number(u.spare),
      docs: (u.docs ?? []).map((d) => ({ ...d, qty: Number(d.qty) })) })),
    suggestions: (r.suggestions ?? []).map((s) => ({ ...s, qty: num(s.qty), need: num(s.need), rest: Number(s.rest ?? 0), incoming: Number(s.incoming ?? 0),
      from_available: num(s.from_available) ?? undefined, from_spare: num(s.from_spare) ?? undefined })),
  }
}

export const whereKey = (c: string, v: string | null | undefined, here: string | null | undefined) => ['inv', c, 'where', v ?? '', here ?? ''] as const

/** look up a scanned or typed code (or a name) */
export function useFindWhere() {
  const { companyId } = useCompany()
  return async (code: string, here: string | null) =>
    clean(unwrap(await supabase.rpc('item_where', { p_company: companyId, p_code: code, p_here: here ?? undefined })) as unknown as WhereResult)
}

/** one item across every unit, kept fresh */
export function useItemWhere(variantId: string | null | undefined, here?: string | null, opts?: { enabled?: boolean }) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: whereKey(companyId, variantId, here),
    enabled: !!companyId && !!variantId && (opts?.enabled ?? true),
    staleTime: 15_000,
    queryFn: async () => clean(unwrap(await supabase.rpc('item_where', { p_company: companyId, p_variant: variantId!, p_here: here ?? undefined })) as unknown as WhereResult),
  })
}

/** ask another unit for it: a transfer request (joins the open one between the same two units) */
export function useItemRequest() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { variant: string; from: string; to: string; qty: number; note?: string }) =>
      unwrap(await supabase.rpc('item_request', { p_company: companyId, p_variant: a.variant, p_from: a.from, p_to: a.to, p_qty: a.qty, p_note: a.note || undefined })) as unknown as
        { id: string; number: string; merged: boolean },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inv', companyId, 'where'] })
      void qc.invalidateQueries({ queryKey: ['inv', companyId, 'docs', 'transfers'] })
    },
  })
}

/** a short line for the till when an item runs out here: which units still have it */
export async function whereElsewhere(companyId: string, variantId: string, here: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('item_where', { p_company: companyId, p_variant: variantId, p_here: here ?? undefined })
  if (error || !data) return null
  const others = (((data as unknown as WhereResult).units) ?? []).filter((u) => u.id !== here && Number(u.available) > 0)
    .sort((a, b) => Number(b.available) - Number(a.available)).slice(0, 2)
  if (!others.length) return t('no other unit has it')
  return t('has it: {list}', { list: others.map((u) => `${td(u.name)} ${formatQty(Number(u.available))}`).join(', ') })
}
