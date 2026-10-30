import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useLocations, type LocationRow } from '@/features/inventory/api'
import { t } from '@/i18n'
import { ensureScanCatalog, findOffline, itemOffline, useScanCatalog } from '@/lib/offline/catalog'
import { newId } from '@/lib/offline/outbox'
import { isNetError, useOfflineStep } from '@/lib/offline/step'

export const wmsKeys = { all: (c: string) => ['wms', c] as const }

function useInvalidateWms() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: wmsKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['inv', companyId] }),
    qc.invalidateQueries({ queryKey: ['sales', companyId] }),
  ]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>, silent = false) {
  const invalidate = useInvalidateWms()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => { if (!silent) toast.error(describeError(e)) } })
}

/* ------------------------------------------------------------------ scanning */
export type Resolved =
  | { kind: 'location'; location: LocationRow }
  | { kind: 'variant'; variantId: string; sku: string; name: string; qty: number; tracking: string }
  | { kind: 'lot'; lotId: string; lotNumber: string; variantId: string; expiry: string | null }
  | { kind: 'unknown'; code: string }

/** One resolver for every scan screen: bin label → product barcode/SKU → lot number */
export function useResolveCode() {
  const { companyId } = useCompany()
  const locations = useLocations()
  useScanCatalog()
  return React.useCallback(async (code: string): Promise<Resolved> => {
    const c = code.trim()
    const up = c.toUpperCase()
    const loc = (locations.data ?? []).find((l) => l.warehouse_id && (l.barcode === c || l.code.toUpperCase() === up))
    if (loc) return { kind: 'location', location: loc }
    // without internet: the device's copy of the items
    const offline = async (): Promise<Resolved> => {
      await ensureScanCatalog(companyId!)
      const f = findOffline(companyId!, c)
      if (f?.kind === 'variant') return { kind: 'variant', variantId: f.item.variant_id, sku: f.item.sku, name: f.item.name, qty: f.qty, tracking: f.item.tracking }
      if (f?.kind === 'lot') return { kind: 'lot', lotId: f.lot.id, lotNumber: f.lot.lot_number, variantId: f.lot.variant_id, expiry: f.lot.expiry_date }
      return { kind: 'unknown', code: c }
    }
    if (!navigator.onLine) return offline()
    const { data: hit, error: hitError } = await supabase.rpc('find_variant_by_code', { p_company: companyId, p_code: c })
    if (hitError && isNetError(hitError)) return offline()
    const h = hit?.[0]
    if (h?.variant_id) return { kind: 'variant', variantId: h.variant_id, sku: h.sku ?? '', name: h.name ?? '', qty: Number(h.units_per_scan) || 1, tracking: h.tracking ?? 'none' }
    const { data: lot } = await supabase.from('lots').select('id, lot_number, variant_id, expiry_date').eq('company_id', companyId).eq('lot_number', c).is('deleted_at', null).limit(1)
    if (lot?.[0]) return { kind: 'lot', lotId: lot[0].id, lotNumber: lot[0].lot_number, variantId: lot[0].variant_id, expiry: lot[0].expiry_date }
    return { kind: 'unknown', code: c }
  }, [companyId, locations.data])
}

/* ------------------------------------------------------------------ overview */
export interface WmsOverview {
  receipts_open: number; putaway_lines: number; to_pick: number; picking: number; to_ship: number; shipped_today: number
  counts_open: number; in_receiving: number; expiring_30: number; expired: number
}
export function useWmsOverview(warehouseId: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'overview', warehouseId],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await supabase.rpc('wms_overview', { p_company: companyId, p_warehouse: warehouseId ?? undefined })) as unknown as WmsOverview,
  })
}

/* ------------------------------------------------------------------ receiving */
export type OpenReceipt = { id: string; number: string; receipt_date: string; vendor: { name: string } | null; po: { number: string } | null
  warehouse: { code: string; name: string } | null; lines: { quantity: number }[]; vendor_delivery_note: string | null }
export function useOpenReceipts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'receipts-open'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('goods_receipts')
      .select('id, number, receipt_date, vendor_delivery_note, vendor:business_partners(name), po:purchase_orders(number), warehouse:warehouses(code, name), lines:goods_receipt_lines(quantity)')
      .eq('company_id', companyId).eq('status', 'draft').is('deleted_at', null).order('receipt_date').returns<OpenReceipt[]>()),
  })
}
export type ReceiptLine = { id: string; po_line_id: string | null; variant_id: string; lot_id: string | null; location_id: string; quantity: number
  unit_price: number | null; unit_cost: number | null
  variant: { sku: string; name: string; product: { tracking: string; track_expiry: boolean } | null } | null
  lot: { lot_number: string; expiry_date: string | null } | null; location: { code: string } | null }
export function useReceiptForScan(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'receipt', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const r = unwrap(await supabase.from('goods_receipts')
        .select('id, number, status, receipt_date, warehouse_id, vendor_id, vendor_delivery_note, vendor:business_partners(name), po:purchase_orders(number)')
        .eq('id', id!).single().returns<{ id: string; number: string; status: string; receipt_date: string; warehouse_id: string; vendor_id: string | null
          vendor_delivery_note: string | null; vendor: { name: string } | null; po: { number: string } | null }>())
      const lines = unwrap(await supabase.from('goods_receipt_lines')
        .select('id, po_line_id, variant_id, lot_id, location_id, quantity, unit_price, unit_cost, variant:product_variants(sku, name, product:products(tracking, track_expiry)), lot:lots(lot_number, expiry_date), location:warehouse_locations(code)')
        .eq('receipt_id', id!).order('created_at').returns<ReceiptLine[]>())
      return { ...r, lines }
    },
  })
}
export const useEnsureLot = () => useAction(async (a: { variant: string; lot: string; expiry?: string | null; vendor?: string | null }) =>
  unwrap(await supabase.rpc('ensure_lot', { p_variant: a.variant, p_lot_number: a.lot, p_expiry: a.expiry ?? undefined, p_vendor: a.vendor ?? undefined })) as string, true)

/** Writes what was counted at the dock onto the receipt lines (splitting lines per lot), then posts it */
export type DockCount = { lineId: string | null; variantId: string; poLineId: string | null; lotId: string | null; qty: number; unitCost?: number | null }
export function useFinishReceipt() {
  const { companyId } = useCompany()
  return useAction(async ({ receiptId, counts, lines, defaultLocation }: { receiptId: string; counts: DockCount[]; lines: ReceiptLine[]; defaultLocation: string }) => {
    const used = new Set<string>()
    for (const c of counts.filter((x) => x.qty > 0)) {
      const existing = c.lineId && !used.has(c.lineId) ? lines.find((l) => l.id === c.lineId) : undefined
      if (existing) {
        used.add(existing.id)
        unwrap(await supabase.from('goods_receipt_lines').update({ quantity: c.qty, lot_id: c.lotId }).eq('id', existing.id))
      } else {
        const tmpl = lines.find((l) => l.variant_id === c.variantId && l.po_line_id === c.poLineId)
        unwrap(await supabase.from('goods_receipt_lines').insert({
          company_id: companyId, receipt_id: receiptId, variant_id: c.variantId, po_line_id: c.poLineId, lot_id: c.lotId,
          location_id: tmpl?.location_id ?? defaultLocation, quantity: c.qty, unit_price: tmpl?.unit_price ?? null, unit_cost: tmpl?.unit_cost ?? c.unitCost ?? null,
        } as never))
      }
    }
    const untouched = lines.filter((l) => !used.has(l.id)).map((l) => l.id)
    if (untouched.length) unwrap(await supabase.from('goods_receipt_lines').delete().in('id', untouched))
    return unwrap(await supabase.rpc('post_goods_receipt', { p_id: receiptId })) as unknown as { status: string; lines: number; total_value: number }
  })
}

/* ------------------------------------------------------------------ tasks */
export type TaskRow = { id: string; number: string; status: string; task_type: string; reference: string | null; created_at: string; started_at: string | null
  completed_at: string | null; warehouse: { code: string; name: string } | null; lines: { quantity: number; quantity_done: number }[] }
export function useTasks(type: 'putaway' | 'pick' | 'move', includeDone = false) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'tasks', type, includeDone],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('warehouse_tasks')
        .select('id, number, status, task_type, reference, created_at, started_at, completed_at, warehouse:warehouses(code, name), lines:warehouse_task_lines(quantity, quantity_done)')
        .eq('company_id', companyId).eq('task_type', type).is('deleted_at', null)
      q = includeDone ? q.gte('created_at', new Date(Date.now() - 14 * 864e5).toISOString()) : q.in('status', ['open', 'in_progress'])
      return unwrap(await q.order('created_at', { ascending: false }).limit(200).returns<TaskRow[]>())
    },
  })
}
export type TaskLine = { id: string; sequence: number; variant_id: string; lot_id: string | null; from_location_id: string | null; to_location_id: string | null
  done_location_id: string | null; quantity: number; quantity_done: number; done_at: string | null; source_doc_id: string | null; source_line_id: string | null
  variant: { sku: string; name: string; product: { tracking: string } | null } | null; lot: { lot_number: string; expiry_date: string | null } | null
  from: { code: string } | null; to: { code: string } | null; done_loc: { code: string } | null }
export type TaskDetail = Omit<TaskRow, 'lines'> & { warehouse_id: string; lines: TaskLine[] }
export function useTask(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'task', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const t = unwrap(await supabase.from('warehouse_tasks')
        .select('id, number, status, task_type, reference, created_at, started_at, completed_at, warehouse_id, warehouse:warehouses(code, name)')
        .eq('id', id!).single().returns<Omit<TaskDetail, 'lines'>>())
      const lines = unwrap(await supabase.from('warehouse_task_lines')
        .select('id, sequence, variant_id, lot_id, from_location_id, to_location_id, done_location_id, quantity, quantity_done, done_at, source_doc_id, source_line_id, variant:product_variants(sku, name, product:products(tracking)), lot:lots(lot_number, expiry_date), from:warehouse_locations!warehouse_task_lines_company_id_from_location_id_fkey(code), to:warehouse_locations!warehouse_task_lines_company_id_to_location_id_fkey(code), done_loc:warehouse_locations!warehouse_task_lines_company_id_done_location_id_fkey(code)')
        .eq('task_id', id!).order('sequence').returns<TaskLine[]>())
      return { ...t, lines } as TaskDetail
    },
  })
}
export function useSuggestPutaway(variantId: string | undefined, warehouseId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'suggest', variantId, warehouseId],
    enabled: !!variantId && !!warehouseId,
    queryFn: async () => unwrap(await supabase.rpc('suggest_putaway', { p_variant: variantId!, p_warehouse: warehouseId!, p_limit: 4 })),
  })
}
export const useConfirmTaskLine = () => useAction(async (a: { line: string; qty: number; to?: string | null; lot?: string | null }) =>
  unwrap(await supabase.rpc('confirm_task_line', { p_line: a.line, p_qty: a.qty, p_to: a.to ?? undefined, p_lot: a.lot ?? undefined })) as unknown as
    { task_status: string; line_done: boolean; location: string }, true)
export const useCreatePutaway = () => useAction(async (location: string) => unwrap(await supabase.rpc('create_putaway_task', { p_location: location })) as string)
export const useCancelTask = () => useAction(async (id: string) => unwrap(await supabase.rpc('cancel_task', { p_task: id })))

/* ------------------------------------------------------------------ picking & shipping */
export type DeliveryRow = { id: string; number: string; status: string; scheduled_date: string; picked_at: string | null; warehouse_id: string
  partner: { name: string } | null; order: { number: string } | null; warehouse: { code: string } | null
  lines: { quantity: number }[]; tracking_number: string | null; carrier_name: string | null; package_count: number | null; done_at: string | null }
const DELIVERY_SELECT = 'id, number, status, scheduled_date, picked_at, warehouse_id, tracking_number, carrier_name, package_count, done_at, partner:business_partners(name), order:sales_orders(number), warehouse:warehouses(code), lines:delivery_lines(quantity)'
export function useOutboundDeliveries(statuses: string[]) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'deliveries', statuses.join()],
    enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('deliveries').select(DELIVERY_SELECT).eq('company_id', companyId).in('status', statuses)
        .eq('delivery_type', 'outbound').is('deleted_at', null).order('scheduled_date').returns<DeliveryRow[]>())
      const open = unwrap(await supabase.from('warehouse_task_lines').select('source_doc_id, task:warehouse_tasks!inner(number, status, task_type)')
        .eq('company_id', companyId).eq('task.task_type', 'pick').in('task.status', ['open', 'in_progress'])
        .returns<{ source_doc_id: string; task: { number: string } }[]>())
      const onList = new Map(open.map((o) => [o.source_doc_id, o.task.number]))
      return rows.map((r) => ({ ...r, pick_list: onList.get(r.id) ?? null }))
    },
  })
}
export function useShippedToday() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'shipped'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('deliveries').select(DELIVERY_SELECT).eq('company_id', companyId).eq('status', 'done')
      .gte('done_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('done_at', { ascending: false }).limit(50).returns<DeliveryRow[]>()),
  })
}
export const useCreatePickList = () => useAction(async (ids: string[]) => unwrap(await supabase.rpc('create_pick_list', { p_deliveries: ids })) as string)
export const useConfirmPick = () => useAction(async (a: { line: string; qty: number; location?: string | null; lot?: string | null }) =>
  unwrap(await supabase.rpc('confirm_pick', { p_line: a.line, p_qty: a.qty, p_location: a.location ?? undefined, p_lot: a.lot ?? undefined })), true)
export const useCompletePickList = () => useAction(async (id: string) =>
  unwrap(await supabase.rpc('complete_pick_list', { p_task: id })) as unknown as { ready: number; short_lines: number; nothing_picked: number })
export const useConfirmShipment = () => useAction(async (a: { id: string; carrier?: string; tracking?: string; packages?: number | null; weight?: number | null }) =>
  unwrap(await supabase.rpc('confirm_shipment', { p_delivery: a.id, p_carrier: a.carrier ?? undefined, p_tracking: a.tracking ?? undefined,
    p_packages: a.packages ?? undefined, p_weight: a.weight ?? undefined })) as unknown as { number: string; cost: number })
export function useDeliveryLines(id: string | undefined) {
  return useQuery({
    queryKey: ['wms', 'delivery-lines', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('delivery_lines')
      .select('id, quantity, variant:product_variants(sku, name), lot:lots(lot_number, expiry_date), location:warehouse_locations(code)')
      .eq('delivery_id', id!).order('created_at')
      .returns<{ id: string; quantity: number; variant: { sku: string; name: string } | null; lot: { lot_number: string; expiry_date: string | null } | null; location: { code: string } | null }[]>()),
  })
}

/* ------------------------------------------------------------------ moves & bin contents */
export type BinStock = { id: string; variant_id: string; lot_id: string | null; on_hand: number; reserved: number
  variant: { sku: string; name: string } | null; lot: { lot_number: string; expiry_date: string | null } | null }
export function useBinStock(locationId: string | null | undefined) {
  return useQuery({
    queryKey: ['wms', 'bin', locationId],
    enabled: !!locationId,
    queryFn: async () => unwrap(await supabase.from('stock_levels')
      .select('id, variant_id, lot_id, on_hand, reserved, variant:product_variants(sku, name), lot:lots(lot_number, expiry_date)')
      .eq('location_id', locationId!).neq('on_hand', 0).returns<BinStock[]>()),
  })
}
export const useMoveStock = () => useAction(async (a: { from: string; to: string; items: { variant_id: string; lot_id: string | null; quantity: number }[] }) =>
  unwrap(await supabase.rpc('move_stock', { p_from: a.from, p_to: a.to, p_items: a.items as unknown as Json })) as string)

/* ------------------------------------------------------------------ cycle counts */
export type CountRow = { id: string; number: string; status: string; count_date: string; scope: string; blind_count: boolean; posted_at: string | null
  adjustment_id: string | null; warehouse: { code: string; name: string } | null; lines: { counted_qty: number | null }[] }
export function useCounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'counts'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('cycle_counts')
      .select('id, number, status, count_date, scope, blind_count, posted_at, adjustment_id, warehouse:warehouses(code, name), lines:cycle_count_lines(counted_qty)')
      .eq('company_id', companyId).is('deleted_at', null).order('created_at', { ascending: false }).limit(100).returns<CountRow[]>()),
  })
}
export type CountLine = { id: string; variant_id: string; location_id: string; lot_id: string | null; system_qty: number; counted_qty: number | null
  variance: number | null; counted_at: string | null; recount: boolean; first_counted_qty: number | null
  variant: { sku: string; name: string; product: { tracking: string } | null } | null; location: { code: string } | null; lot: { lot_number: string } | null }
export function useCount(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'count', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const c = unwrap(await supabase.from('cycle_counts')
        .select('id, number, status, count_date, scope, blind_count, posted_at, adjustment_id, warehouse_id, warehouse:warehouses(code, name)')
        .eq('id', id!).single().returns<Omit<CountRow, 'lines'> & { warehouse_id: string }>())
      const lines = unwrap(await supabase.from('cycle_count_lines')
        .select('id, variant_id, location_id, lot_id, system_qty, counted_qty, variance, counted_at, recount, first_counted_qty, variant:product_variants(sku, name, product:products(tracking)), location:warehouse_locations(code), lot:lots(lot_number)')
        .eq('cycle_count_id', id!).returns<CountLine[]>())
      lines.sort((a, b) => (a.location?.code ?? '').localeCompare(b.location?.code ?? '') || (a.variant?.sku ?? '').localeCompare(b.variant?.sku ?? ''))
      return { ...c, lines }
    },
  })
}
export const useCreateCount = () => useAction(async (a: { warehouse: string; locations?: string[] | null; category?: string | null; blind: boolean }) =>
  unwrap(await supabase.rpc('create_cycle_count', { p_warehouse: a.warehouse, p_locations: a.locations?.length ? a.locations : undefined,
    p_category: a.category ?? undefined, p_blind: a.blind })) as string)
/** Count an item; without internet it is kept on the device and sent later (once, even if sent twice). */
export function useCountItem() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useOfflineStep((a: { count: string; variant: string; location: string; qty: number; lot?: string | null; set?: boolean }) => {
    const op = newId()
    const countKey = [...wmsKeys.all(companyId), 'count', a.count]
    return {
      chain: `count:${a.count}`, fn: 'offline_call',
      args: { p_op: op, p_fn: 'count_item', p_args: { p_count: a.count, p_variant: a.variant, p_location: a.location, p_qty: a.qty, p_lot: a.lot ?? null, p_set: a.set ?? false } },
      label: t('Count: {item} {qty}', { item: itemOffline(companyId ?? '', a.variant)?.sku ?? '', qty: a.set ? `= ${a.qty}` : `+${a.qty}` }),
      invalidate: [[...wmsKeys.all(companyId)]],
      online: (d) => d as { line_id: string; counted_qty: number; system_qty: number | null },
      local: () => {
        let out = { line_id: op, counted_qty: a.qty, system_qty: null as number | null }
        qc.setQueryData<{ lines: CountLine[] } & Record<string, unknown>>(countKey, (c) => {
          if (!c) return c
          const i = c.lines.findIndex((l) => l.variant_id === a.variant && l.location_id === a.location && (l.lot_id ?? null) === (a.lot ?? null))
          if (i >= 0) {
            const l = c.lines[i]!
            const q = Math.max(0, a.set ? a.qty : Number(l.counted_qty ?? 0) + a.qty)
            out = { line_id: l.id, counted_qty: q, system_qty: null }
            const lines = [...c.lines]; lines[i] = { ...l, counted_qty: q, counted_at: new Date().toISOString() }
            return { ...c, lines }
          }
          const it = itemOffline(companyId ?? '', a.variant)
          const loc = c.lines.find((l) => l.location_id === a.location)?.location ?? null
          return { ...c, lines: [...c.lines, { id: op, variant_id: a.variant, location_id: a.location, lot_id: a.lot ?? null, system_qty: 0, counted_qty: Math.max(0, a.qty), variance: null, recount: false, first_counted_qty: null,
            counted_at: new Date().toISOString(), variant: it ? { sku: it.sku, name: it.name, product: { tracking: it.tracking } } : null, location: loc, lot: null }] }
        })
        return out
      },
    }
  }, { quiet: true })
}
export const useSubmitCount = () => useAction(async (a: { id: string; zero: boolean }) => unwrap(await supabase.rpc('submit_cycle_count', { p_id: a.id, p_zero_uncounted: a.zero })))
export const usePostCount = () => useAction(async (id: string) =>
  unwrap(await supabase.rpc('post_cycle_count', { p_id: id })) as unknown as { adjustment_id: string | null; adjustment_status: string; lines: number; value: number | null })

/* ------------------------------------------------------------------ lots */
export type LotRow = { id: string; lot_number: string; lot_type: string; expiry_date: string | null; manufacture_date: string | null; created_at: string
  variant: { id: string; sku: string; name: string } | null; vendor: { name: string } | null; levels: { on_hand: number }[] }
export function useLotsList() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'lots'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('lots')
      .select('id, lot_number, lot_type, expiry_date, manufacture_date, created_at, variant:product_variants(id, sku, name), vendor:business_partners(name), levels:stock_levels(on_hand)')
      .eq('company_id', companyId).is('deleted_at', null).order('expiry_date', { nullsFirst: false }).limit(1000).returns<LotRow[]>()),
  })
}
export type LotTrace = {
  lot: { id: string; lot_number: string; lot_type: string; expiry_date: string | null; manufacture_date: string | null; sku: string; variant_name: string
    variant_id: string; vendor_name: string | null; tracking: string; notes: string | null }
  stock: { location_id: string; location: string; warehouse: string; on_hand: number; reserved: number }[]
  movements: { id: string; movement_date: string; movement_type: string; quantity: number; unit_cost: number; reference: string | null
    source_doc_type: string | null; source_doc_id: string | null; from_code: string; from_type: string; to_code: string; to_type: string
    partner_name: string | null; partner_id: string | null }[]
  received: number; shipped: number
  customers: { partner_id: string | null; name: string; quantity: number; last_date: string }[]
}
export function useLotTrace(id: string | undefined) {
  return useQuery({
    queryKey: ['wms', 'lot-trace', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('lot_trace', { p_lot: id! })) as unknown as LotTrace,
  })
}

/** Where documents open in the app */
export const DOC_HREF: Record<string, string> = {
  goods_receipt: '/inventory/receipts/', delivery: '/sales/deliveries/', stock_adjustment: '/inventory/adjustments/', stock_transfer: '/inventory/transfers/',
  warehouse_task: '/wms/tasks/', work_order: '/manufacturing/orders/',
}

/* ------------------------------------------------------------------ before confirming a count: differences with their value */
export type CountReviewLine = { id: string; variant_id: string; sku: string; name: string; location: string; lot: string | null; expected: number; counted: number
  first_counted: number | null; recount: boolean; delta: number; pct: number | null; unit_cost: number; value: number }
export type CountReview = { lines: CountReviewLine[]; counted: number; not_counted: number; differences: number; gains: number; losses: number; net: number; counted_value: number }
export function useCountReview(id: string | undefined, enabled: boolean) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'count-review', id],
    enabled: !!id && enabled,
    queryFn: async () => unwrap(await supabase.rpc('count_review', { p_id: id! })) as unknown as CountReview,
  })
}
export const useCountRecount = () => useAction(async (a: { id: string; minValue?: number | null; minPct?: number | null; lines?: string[] }) =>
  unwrap(await supabase.rpc('count_recount', { p_id: a.id, p_min_value: a.minValue ?? undefined, p_min_pct: a.minPct ?? undefined, p_lines: a.lines ?? undefined })) as number)
export type CountImportResult = { rows: number; ok: number; errors: { row: number; code: string | null; reason: string }[] }
export const useCountImport = () => useAction(async (a: { id: string; rows: { code: string; location?: string; qty: string; lot?: string }[]; add: boolean }) =>
  unwrap(await supabase.rpc('count_import', { p_id: a.id, p_rows: a.rows as never, p_add: a.add })) as unknown as CountImportResult)

export type ShrinkRow = { reason: string; warehouse_id: string | null; warehouse: string | null; variant_id: string; sku: string; name: string; category: string | null
  qty_lost: number; qty_found: number; value_lost: number; value_found: number; adjustments: number }
export function useShrinkage(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...wmsKeys.all(companyId), 'shrinkage', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('shrinkage_report', { p_company: companyId, p_from: from, p_to: to })) as unknown as ShrinkRow[],
  })
}
