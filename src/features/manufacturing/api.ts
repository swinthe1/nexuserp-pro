import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const mfgKeys = { all: (c: string) => ['mfg', c] as const }
function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: mfgKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['inv', companyId] }),
    qc.invalidateQueries({ queryKey: ['fin', companyId] }),
  ]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}

/* ------------------------------------------------------------------ work centers */
export type WorkCenter = Tables<'work_centers'>
export function useWorkCenters() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'work-centers'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('work_centers').select('*').eq('company_id', companyId).is('deleted_at', null).order('code')),
  })
}
export const useSaveWorkCenter = () => {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('work_centers').update(v as never).eq('id', id))
    : unwrap(await supabase.from('work_centers').insert({ ...v, company_id: companyId } as never)))
}
export type LoadRow = { work_center_id: string; code: string; name: string; day: string; planned_minutes: number; capacity_minutes: number; work_orders: number }
export function useWorkCenterLoad(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'load', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('work_center_load', { p_company: companyId, p_from: from, p_to: to })) as LoadRow[],
  })
}

/* ------------------------------------------------------------------ BOMs */
export type BomRow = Tables<'boms'> & { variant: { sku: string; name: string } | null; lines: { count: number }[]; operations: { count: number }[] }
export function useBoms() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'boms'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('boms').select('*, variant:product_variants(sku, name), lines:bom_lines(count), operations:bom_operations(count)')
      .eq('company_id', companyId).is('deleted_at', null).order('code').returns<BomRow[]>()),
  })
}
export type BomDetail = Tables<'boms'> & {
  variant: { id: string; sku: string; name: string } | null
  lines: (Tables<'bom_lines'> & { component: { sku: string; name: string } | null })[]
  operations: (Tables<'bom_operations'> & { work_center: { code: string; name: string } | null })[]
}
export function useBom(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'bom', id],
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('boms')
      .select('*, variant:product_variants(id, sku, name), lines:bom_lines(*, component:product_variants(sku, name)), operations:bom_operations(*, work_center:work_centers(code, name))')
      .eq('id', id!).single().returns<BomDetail>()),
  })
}
export function useSaveBom() {
  const { companyId } = useCompany()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ header, lines, operations }: { header: Record<string, unknown>; lines: Record<string, unknown>[]; operations: Record<string, unknown>[] }) =>
      unwrap(await supabase.rpc('save_document', {
        p_table: 'boms', p_header: { ...header, company_id: companyId } as unknown as Json,
        p_children: { bom_lines: lines, bom_operations: operations } as unknown as Json,
      })) as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
export type ExplodeRow = { depth: number; path: string; line_id: string; bom_id: string; variant_id: string; sku: string; name: string; uom: string | null
  qty_per: number; quantity: number; scrap_pct: number; sub_bom_id: string | null; unit_cost: number; ext_cost: number; on_hand: number; available: number; tracking: string }
export function useBomExplode(bomId: string | undefined, qty: number | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'explode', bomId, qty],
    enabled: !!bomId && !!qty && qty > 0,
    queryFn: async () => unwrap(await supabase.rpc('bom_explode', { p_bom: bomId!, p_qty: qty })) as ExplodeRow[],
  })
}
export type BomCost = { quantity: number; material: number; labor: number; overhead: number; total: number; unit: number
  operations: { sequence: number; name: string; work_center: string; minutes: number; labor: number; overhead: number }[] }
export function useBomCost(bomId: string | undefined, qty: number | undefined, rollup = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'bom-cost', bomId, qty, rollup],
    enabled: !!bomId && !!qty && qty > 0,
    queryFn: async () => unwrap(await supabase.rpc('bom_cost', { p_bom: bomId!, p_qty: qty, p_rollup: rollup })) as unknown as BomCost,
  })
}
export function useWhereUsed(variantId: string | undefined) {
  return useQuery({
    queryKey: ['mfg', 'where-used', variantId],
    enabled: !!variantId,
    queryFn: async () => unwrap(await supabase.rpc('bom_where_used', { p_variant: variantId! })) as
      { bom_id: string; bom_code: string; variant_id: string; sku: string; name: string; quantity: number; bom_quantity: number }[],
  })
}

/* ------------------------------------------------------------------ work orders */
export type WorkOrderRow = Tables<'work_orders'> & { variant: { sku: string; name: string } | null; warehouse: { code: string } | null
  parent: { number: string } | null; sales_order: { number: string } | null }
const WO_LIST = '*, variant:product_variants(sku, name), warehouse:warehouses(code), sales_order:sales_orders(number)'
export function useWorkOrders() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'work-orders'],
    enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('work_orders').select(WO_LIST).eq('company_id', companyId).is('deleted_at', null)
        .order('planned_start', { ascending: false }).limit(1000).returns<Omit<WorkOrderRow, 'parent'>[]>())
      // parent numbers come from the same list (self-references cannot be embedded)
      const byId = new Map(rows.map((r) => [r.id, r.number]))
      return rows.map((r) => ({ ...r, parent: r.parent_work_order_id ? { number: byId.get(r.parent_work_order_id) ?? '' } : null })) as WorkOrderRow[]
    },
  })
}
export type WorkOrderDetail = Tables<'work_orders'> & {
  variant: { id: string; sku: string; name: string } | null
  bom: { id: string; code: string; quantity: number } | null
  warehouse: { code: string; name: string } | null
  component_location: { code: string } | null
  output_location: { code: string } | null
  output_lot: { id: string; lot_number: string; expiry_date: string | null } | null
  sales_order: { id: string; number: string } | null
  responsible: { full_name: string | null } | null
  operations: (Tables<'work_order_operations'> & { work_center: { code: string; name: string; cost_per_hour: number; overhead_per_hour: number } | null })[]
  outputs: (Tables<'production_outputs'> & { lot: { lot_number: string; expiry_date: string | null } | null })[]
  consumptions: (Tables<'work_order_consumptions'> & { variant: { sku: string; name: string } | null; lot: { lot_number: string } | null })[]
  parent: { id: string; number: string; status: string } | null
  children: { id: string; number: string; status: string; quantity_planned: number; quantity_produced: number; variant: { sku: string } | null }[]
}
// typed as string so the select parser does not have to expand it
const WO_DETAIL: string = `*, variant:product_variants(id, sku, name), bom:boms(id, code, quantity), warehouse:warehouses(code, name),
          component_location:warehouse_locations!work_orders_company_id_component_location_id_fkey(code),
          output_location:warehouse_locations!work_orders_company_id_output_location_id_fkey(code),
          output_lot:lots!work_orders_output_lot_fkey(id, lot_number, expiry_date), sales_order:sales_orders(id, number),
          responsible:profiles!work_orders_responsible_profile_fkey(full_name),
          operations:work_order_operations(*, work_center:work_centers(code, name, cost_per_hour, overhead_per_hour)),
          outputs:production_outputs(*, lot:lots(lot_number, expiry_date)),
          consumptions:work_order_consumptions(*, variant:product_variants(sku, name), lot:lots(lot_number))`
export function useWorkOrder(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'work-order', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const w = unwrap(await supabase.from('work_orders').select(WO_DETAIL)
        .eq('id', id!).single().returns<Omit<WorkOrderDetail, 'parent' | 'children'>>())
      const [parent, children] = await Promise.all([
        w.parent_work_order_id ? supabase.from('work_orders').select('id, number, status').eq('id', w.parent_work_order_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('work_orders').select('id, number, status, quantity_planned, quantity_produced, variant:product_variants(sku)').eq('parent_work_order_id', w.id).is('deleted_at', null).order('number'),
      ])
      return { ...w, parent: parent.data ?? null, children: (children.data ?? []) as WorkOrderDetail['children'] } as WorkOrderDetail
    },
  })
}
export type MaterialRow = { material_id: string; variant_id: string; sku: string; name: string; uom: string | null; tracking: string; required: number; consumed: number
  remaining: number; available_at_location: number; available_in_warehouse: number; shortage: number; sub_bom_id: string | null; unit_cost: number; child_work_order: string | null }
export function useMaterials(woId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'materials', woId],
    enabled: !!woId,
    queryFn: async () => unwrap(await supabase.rpc('material_availability', { p_wo: woId! })) as MaterialRow[],
  })
}
export function useLotsAt(variantId: string | undefined, locationId: string | undefined) {
  return useQuery({
    queryKey: ['mfg', 'lots-at', variantId, locationId],
    enabled: !!variantId && !!locationId,
    queryFn: async () => unwrap(await supabase.from('stock_levels').select('lot_id, on_hand, reserved, lot:lots(lot_number, expiry_date)')
      .eq('variant_id', variantId!).eq('location_id', locationId!).gt('on_hand', 0).not('lot_id', 'is', null)
      .returns<{ lot_id: string; on_hand: number; reserved: number; lot: { lot_number: string; expiry_date: string | null } | null }[]>()),
  })
}
export const useCreateWorkOrder = () => useAction(async (p: Record<string, unknown>) => unwrap(await supabase.rpc('create_work_order', { p: p as Json })) as string)
export const useReleaseWorkOrder = () => useAction(async (id: string) => unwrap(await supabase.rpc('release_work_order', { p_wo: id })) as unknown as { shortages: { sku: string; name: string; shortage: number }[] })
export const useConsume = () => useAction(async (a: { id: string; items?: { material_id: string; quantity: number; lot_id?: string | null }[] | null }) =>
  unwrap(await supabase.rpc('consume_materials', { p_wo: a.id, p_items: (a.items ?? undefined) as Json | undefined })) as unknown as { lines: number; value: number })
export const useReturnMaterials = () => useAction(async (a: { id: string; items: { material_id: string; quantity: number }[] }) =>
  unwrap(await supabase.rpc('return_materials', { p_wo: a.id, p_items: a.items as unknown as Json })) as unknown as { value: number })
export const useRecordOperation = () => useAction(async (a: { op: string; minutes: number; finish: boolean }) =>
  unwrap(await supabase.rpc('record_operation', { p_op: a.op, p_minutes: a.minutes, p_finish: a.finish })) as unknown as { labor: number; overhead: number })
export const useProduce = () => useAction(async (a: { id: string; qty: number; lot?: string | null; expiry?: string | null; scrap?: number; backflush: boolean }) =>
  unwrap(await supabase.rpc('produce', { p_wo: a.id, p_qty: a.qty, p_lot_number: a.lot ?? undefined, p_expiry: a.expiry ?? undefined, p_scrap: a.scrap ?? 0, p_backflush: a.backflush })) as unknown as
  { unit_cost: number; value: number; completed: boolean })
export const useCompleteWorkOrder = () => useAction(async (id: string) => unwrap(await supabase.rpc('complete_work_order', { p_wo: id })))
export const useCloseWorkOrder = () => useAction(async (id: string) => unwrap(await supabase.rpc('close_work_order', { p_wo: id })) as unknown as { variance: number })
export const useCancelWorkOrder = () => useAction(async (id: string) => unwrap(await supabase.rpc('cancel_work_order', { p_wo: id })))
export const useBackToDraft = () => useAction(async (id: string) => unwrap(await supabase.from('work_orders').update({ status: 'draft' }).eq('id', id)))
export const useUpdateWorkOrder = () => useAction(async ({ id, ...v }: Record<string, unknown> & { id: string }) => unwrap(await supabase.from('work_orders').update(v as never).eq('id', id)))

/* ------------------------------------------------------------------ planning & overview */
export type PlanRow = { variant_id: string; sku: string; name: string; bom_id: string; bom_code: string; bom_quantity: number; on_hand: number; reserved: number
  sales_demand: number; component_demand: number; min_qty: number; max_qty: number; in_production: number; projected: number; suggested: number; unit_cost: number; lead_minutes: number }
export function usePlan() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'plan'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('production_plan', { p_company: companyId })) as PlanRow[],
  })
}
export interface MfgOverview {
  draft: number; released: number; in_progress: number; completed: number; late: number; produced_value: number; produced_orders: number; wip: number
  variance: number; planned_cost: number; actual_cost: number; to_make: number; by_day: { day: string; value: number }[]
  top: { sku: string; name: string; quantity: number; value: number }[]
}
export function useMfgOverview(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'overview', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('manufacturing_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as MfgOverview,
  })
}

/* ------------------------------------------------------------------ traceability */
export type GenealogyRow = { depth: number; lot_id: string; lot_number: string; variant_id: string; sku: string; name: string; expiry_date: string | null
  vendor: string | null; quantity: number; work_order_id: string; work_order: string; via_lot_id: string }
export function useGenealogy(lotId: string | undefined, direction: 'up' | 'down') {
  return useQuery({
    queryKey: ['mfg', 'genealogy', lotId, direction],
    enabled: !!lotId,
    queryFn: async () => unwrap(await supabase.rpc('lot_genealogy_tree', { p_lot: lotId!, p_direction: direction })) as GenealogyRow[],
  })
}

/** Products that have a BOM, for the new-work-order picker */
export function useManufacturable() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...mfgKeys.all(companyId), 'manufacturable'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('boms').select('id, code, version, quantity, is_default, bom_type, variant:product_variants(id, sku, name)')
      .eq('company_id', companyId).eq('is_active', true).eq('bom_type', 'manufacture').is('deleted_at', null).order('code')
      .returns<{ id: string; code: string; version: number; quantity: number; is_default: boolean; bom_type: string; variant: { id: string; sku: string; name: string } | null }[]>()),
  })
}
