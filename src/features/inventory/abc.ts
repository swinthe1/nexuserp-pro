import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { t } from '@/i18n'

export type Abc = 'A' | 'B' | 'C'
export type Xyz = 'X' | 'Y' | 'Z'
export interface AbcSettings { basis: 'value' | 'qty'; months: number; a: number; b: number; x: number; y: number; count_a: number; count_b: number; count_c: number }
export interface AbcSummary {
  cells: { abc: Abc; xyz: Xyz; items: number; value: number; share: number; stock_value: number }[]
  items: number; value: number; stock_value: number
  dead: { items: number; stock_value: number }
  computed_at: string | null
  settings: AbcSettings
}
export interface AbcRow {
  variant_id: string; abc: Abc; xyz: Xyz; value: number; qty: number; share: number; cum_share: number; months_sold: number
  cv: number | null; weeks: number; rank: number; on_hand: number; stock_value: number
  variant: { sku: string; name: string; product_id: string } | null
}

const keys = { all: (c: string) => ['inv', c, 'abc'] as const }
const n = (v: unknown) => Number(v ?? 0)

export function useAbcSummary(warehouse: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...keys.all(companyId), 'summary', warehouse ?? ''],
    enabled: !!companyId,
    queryFn: async () => {
      const r = unwrap(await supabase.rpc('abc_summary', { p_company: companyId, p_warehouse: warehouse ?? undefined })) as unknown as AbcSummary
      return { ...r, value: n(r.value), stock_value: n(r.stock_value), dead: { items: n(r.dead?.items), stock_value: n(r.dead?.stock_value) },
        cells: (r.cells ?? []).map((c) => ({ ...c, items: n(c.items), value: n(c.value), share: n(c.share), stock_value: n(c.stock_value) })) }
    },
  })
}

export function useAbcItems(warehouse: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...keys.all(companyId), 'items', warehouse ?? ''],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('item_classes')
        .select('variant_id, abc, xyz, value, qty, share, cum_share, months_sold, cv, weeks, rank, on_hand, stock_value, variant:product_variants(sku, name, product_id)')
        .eq('company_id', companyId).order('rank').range(0, 4999)
      q = warehouse ? q.eq('warehouse_id', warehouse) : q.is('warehouse_id', null)
      return (unwrap(await q) as unknown as AbcRow[]).map((r) => ({ ...r, value: n(r.value), qty: n(r.qty), share: n(r.share), cum_share: n(r.cum_share),
        cv: r.cv == null ? null : n(r.cv), on_hand: n(r.on_hand), stock_value: n(r.stock_value) }))
    },
  })
}

export function useAbcRun() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('abc_run', { p_company: companyId })),
    onSuccess: () => { toast.success(t('Items classified again')); void qc.invalidateQueries({ queryKey: keys.all(companyId) }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useAbcSettingsSave() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: AbcSettings) => unwrap(await supabase.rpc('abc_settings_save', { p_company: companyId, p_cfg: s as never })),
    onSuccess: () => { toast.success(t('Rules saved; items classified again')); void qc.invalidateQueries({ queryKey: keys.all(companyId) }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

/* --------------------------------------------------------------- counting by class */
export interface CountPlanRow { warehouse_id: string; name: string; code: string; due: number; classes: Partial<Record<Abc, { items: number; due: number }>> | null }
export function useCountPlan() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['wms', companyId, 'count-plan'],
    enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('count_plan', { p_company: companyId })) ?? []) as unknown as CountPlanRow[],
  })
}
export function useCreateCountDue() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { warehouse: string; limit?: number; blind?: boolean }) =>
      unwrap(await supabase.rpc('create_count_due', { p_warehouse: a.warehouse, p_limit: a.limit ?? 80, p_blind: a.blind ?? true })) as string,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wms', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}
