import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables } from '@/lib/database.types'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { after, byName, fetchAll, supabase } from '@/lib/supabase'

export const procKeys = {
  all: (c: string) => ['proc', c] as const,
  list: (c: string, what: string) => ['proc', c, 'list', what] as const,
  doc: (c: string, kind: string, id: string) => ['proc', c, 'doc', kind, id] as const,
}

function useInvalidateProcurement() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: procKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['inv', companyId] }),   // receipts, incoming stock, average cost
  ])
}

/* -------------------------------------------------------------- lookups */
export type PurchasableVariant = {
  id: string; sku: string; name: string; product_type: string; uom_code: string
  on_hand: number; available: number; incoming: number; avg_cost: number; reorder_min: number | null; codes?: string | null
}
export function usePurchasableVariants() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, 'purchasable'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: () => fetchAll('sku', (x) => after(supabase.from('v_product_stock')
      .select('id:variant_id, sku, name:variant_name, product_type, uom_code, on_hand, available, incoming, avg_cost, reorder_min, codes')
      .eq('company_id', companyId).eq('is_active', true), 'sku', x).order('sku').limit(1000).returns<PurchasableVariant[]>()),
  })
}

export type VendorRow = { id: string; code: string; name: string; tax_number: string | null; currency_code: string | null; payment_term_id: string | null; email: string | null; phone: string | null; is_active: boolean }
export function useActiveVendors() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, 'vendors'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: () => fetchAll('id', (x) => after(supabase.from('business_partners')
      .select('id, code, name, tax_number, currency_code, payment_term_id, email, phone, is_active')
      .eq('company_id', companyId).eq('is_vendor', true).is('deleted_at', null), 'id', x).order('id').limit(1000).returns<VendorRow[]>()).then(byName),
  })
}

export type PurchasePrice = { unit_price: number | null; currency_code: string | null; source: string | null; vendor_sku: string | null; min_order_qty: number | null; lead_time_days: number | null; tax_code_id: string | null }
export async function fetchPurchasePrice(a: { companyId: string; vendorId: string; variantId: string; quantity: number; currency?: string | null; date?: string }) {
  const { data, error } = await supabase.rpc('get_purchase_price', {
    p_company: a.companyId, p_vendor: a.vendorId, p_variant: a.variantId, p_quantity: a.quantity,
    p_currency: a.currency ?? undefined, p_date: a.date ?? undefined,
  })
  if (error) throw error
  return (data?.[0] ?? null) as PurchasePrice | null
}

/* ------------------------------------------------------------ documents */
export type ProcKind = 'requisitions' | 'orders' | 'bills'
export const PROC_TABLE = { requisitions: 'purchase_requisitions', orders: 'purchase_orders', bills: 'vendor_bills' } as const
export const PROC_LINES = { requisitions: 'purchase_requisition_lines', orders: 'purchase_order_lines', bills: 'vendor_bill_lines' } as const

const LIST_SELECT: Record<ProcKind, string> = {
  requisitions: 'id, number, status, created_at, required_date, estimated_total, justification, warehouse:warehouses(name), requester:profiles!purchase_requisitions_requester_profile_fkey(full_name), lines:purchase_requisition_lines(count)',
  orders: 'id, number, vendor_id, status, billing_status, order_date, expected_date, promised_date, confirmed_at, currency_code, total, total_base, vendor_reference, vendor:business_partners(name), warehouse:warehouses(name), buyer:profiles!purchase_orders_buyer_profile_fkey(full_name), lines:purchase_order_lines(quantity, qty_received, qty_billed)',
  bills: 'id, number, vendor_id, document_type, is_debit_note, status, payment_status, match_status, vendor_invoice_number, bill_date, due_date, currency_code, total, total_base, amount_due, vendor:business_partners(name), order:purchase_orders(number)',
}
const DATE_COL: Record<ProcKind, string> = { requisitions: 'created_at', orders: 'order_date', bills: 'bill_date' }

export function useProcDocuments<T>(kind: ProcKind) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, kind),
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from(PROC_TABLE[kind]).select(LIST_SELECT[kind])
        .eq('company_id', companyId).is('deleted_at', null)
        .order(DATE_COL[kind], { ascending: false }).order('number', { ascending: false }).limit(1000)
      if (error) throw error
      return data as unknown as T[]
    },
  })
}

const DETAIL_SELECT: Record<ProcKind, string> = {
  requisitions: '*, lines:purchase_requisition_lines(*), requester:profiles!purchase_requisitions_requester_profile_fkey(full_name), decider:profiles!purchase_requisitions_decider_profile_fkey(full_name), orders:purchase_orders(id, number, status, vendor:business_partners(name))',
  orders: '*, lines:purchase_order_lines(*), vendor:business_partners(id, name, email, phone), requisition:purchase_requisitions(id, number), receipts:goods_receipts(id, number, status, receipt_date, total_value), bills:vendor_bills(id, number, status, document_type, vendor_invoice_number, total, match_status)',
  bills: '*, lines:vendor_bill_lines(*), vendor:business_partners(id, name), order:purchase_orders(id, number, status, currency_code)',
}

export function useProcDocument<T>(kind: ProcKind, id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.doc(companyId, kind, id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from(PROC_TABLE[kind]).select(DETAIL_SELECT[kind]).eq('id', id!).single()
      if (error) throw error
      const row = data as unknown as Record<string, unknown>
      // credit notes: composite self-references can't be embedded, so fetch the original bill separately
      if (kind === 'bills' && row.original_bill_id) {
        row.original = (await supabase.from('vendor_bills').select('id, number').eq('id', row.original_bill_id as string).maybeSingle()).data
      }
      if (kind === 'bills') {
        row.credits = (await supabase.from('vendor_bills').select('id, number, status, total, is_debit_note').eq('original_bill_id', id!).is('deleted_at', null)).data ?? []
      }
      return row as unknown as T
    },
  })
}

export function useSaveProcDocument(kind: ProcKind) {
  const { companyId } = useCompany()
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async ({ header, lines }: { header: Record<string, unknown>; lines: Record<string, unknown>[] }) =>
      unwrap(await supabase.rpc('save_document', {
        p_table: PROC_TABLE[kind],
        p_header: { ...header, company_id: companyId } as unknown as Json,
        p_children: { [PROC_LINES[kind]]: lines } as unknown as Json,
      })) as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useSetProcStatus(kind: ProcKind) {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: string; extra?: Record<string, unknown> }) =>
      unwrap(await supabase.from(PROC_TABLE[kind]).update({ status, ...extra } as never).eq('id', id)),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useDeleteProcDocument(kind: ProcKind) {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(PROC_TABLE[kind]).delete().eq('id', id)),
    onSuccess: () => { toast.success(t('Draft deleted')); void invalidate() },
    onError: (e) => toast.error(describeError(e)),
  })
}

function useRpcAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidateProcurement()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}
type Orders = { orders: string[] }
export const useSubmitRequisition = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('submit_requisition', { p_id: id })) as string)
export const useDecideRequisition = () => useRpcAction(async (a: { id: string; decision: 'approved' | 'rejected'; reason?: string }) =>
  unwrap(await supabase.rpc('decide_requisition', { p_id: a.id, p_decision: a.decision, p_reason: a.reason || undefined })))
export const useOrderRequisition = () => useRpcAction(async (a: { id: string; vendorId?: string | null }) =>
  unwrap(await supabase.rpc('create_po_from_requisition', { p_id: a.id, p_vendor: a.vendorId ?? undefined })) as unknown as Orders)
export const useSubmitPurchaseOrder = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('submit_purchase_order', { p_id: id })) as string)
export const useReceiveOrder = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_receipt_from_po', { p_po: id })) as string)
export const useBillOrder = () => useRpcAction(async (a: { id: string; vendorInvoice: string; date?: string }) =>
  unwrap(await supabase.rpc('create_bill_from_po', { p_po: a.id, p_vendor_invoice_number: a.vendorInvoice, p_bill_date: a.date })) as string)
export const usePostBill = () => useRpcAction(async (a: { id: string; overrideReason?: string }) =>
  unwrap(await supabase.rpc('post_vendor_bill', { p_id: a.id, p_override_reason: a.overrideReason || undefined })) as unknown as
  { status: string; match_status: string; capitalized_variance: number; expensed_variance: number })
export const useVendorCredit = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_vendor_credit', { p_bill: id })) as string)
export const useVendorDebit = () => useRpcAction(async ({ id, number }: { id: string; number: string }) => unwrap(await supabase.rpc('create_vendor_debit', { p_bill: id, p_number: number })) as string)

export interface MatchLine { line_no: number; status: string; qty_variance: number | null; price_variance: number | null; expected_qty?: number | null; po_net_price?: number | null }
export interface MatchResult { status: string; qty_tolerance_pct?: number; price_tolerance_pct?: number; lines: MatchLine[] }
export function useMatchBill() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('match_vendor_bill', { p_id: id })) as unknown as MatchResult,
    onSuccess: () => void qc.invalidateQueries({ queryKey: procKeys.all(companyId) }),
    onError: (e) => toast.error(describeError(e)),
  })
}

/* --------------------------------------------------------- replenishment */
export type SuggestionRow = Tables<'replenishment_suggestions'> & {
  variant: { sku: string; name: string } | null
  warehouse: { name: string } | null
  source: { name: string } | null
  vendor: { name: string } | null
  rule: { min_qty: number; max_qty: number; multiple_qty: number } | null
  order: { number: string; status: string } | null
  transfer: { number: string; status: string } | null
}
export function useSuggestions() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, 'suggestions'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('replenishment_suggestions')
      .select('*, variant:product_variants(sku, name), warehouse:warehouses!replenishment_suggestions_company_id_warehouse_id_fkey(name), source:warehouses!replenishment_suggestions_company_id_source_warehouse_id_fkey(name), vendor:business_partners(name), rule:replenishment_rules(min_qty, max_qty, multiple_qty), order:purchase_orders(number, status), transfer:stock_transfers(number, status)')
      .eq('company_id', companyId).order('generated_at', { ascending: false }).limit(500).returns<SuggestionRow[]>()),
  })
}
export const useGenerateReplenishment = () => {
  const { companyId } = useCompany()
  return useRpcAction(async (warehouseId?: string | null) =>
    unwrap(await supabase.rpc('generate_replenishment', { p_company: companyId, p_warehouse: warehouseId ?? undefined })) as number)
}
export const useOrderSuggestions = () => useRpcAction(async (ids: string[]) =>
  unwrap(await supabase.rpc('create_pos_from_suggestions', { p_ids: ids })) as unknown as Orders)
export function useUpdateSuggestion() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async ({ ids, values }: { ids: string[]; values: Record<string, unknown> }) =>
      unwrap(await supabase.from('replenishment_suggestions').update(values as never).in('id', ids)),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

/* --------------------------------------------------------- vendor prices */
export type VendorProductRow = Tables<'vendor_products'> & { vendor: { name: string } | null; variant: { sku: string; name: string } | null }
export function useVendorProducts(vendorId?: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, `vendor-products-${vendorId ?? 'all'}`),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('vendor_products').select('*, vendor:business_partners(name), variant:product_variants(sku, name)')
        .eq('company_id', companyId).is('deleted_at', null)
      if (vendorId) q = q.eq('vendor_id', vendorId)
      return unwrap(await q.order('created_at', { ascending: false }).returns<VendorProductRow[]>())
    },
  })
}
export function useSaveVendorProduct() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
      ? unwrap(await supabase.from('vendor_products').update(v as never).eq('id', id))
      : unwrap(await supabase.from('vendor_products').insert({ ...v, company_id: companyId } as never)),
    onSuccess: () => void invalidate(),
  })
}
export function useDeleteVendorProduct() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('vendor_products').delete().eq('id', id)),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

/* --------------------------------------------------------------- vendor */
export function useVendorActivity(vendorId: string | undefined) {
  const { companyId, can } = useCompany()
  return useQuery({
    queryKey: procKeys.doc(companyId, 'vendor-activity', vendorId ?? ''),
    enabled: !!companyId && !!vendorId,
    queryFn: async () => {
      const [orders, bills] = await Promise.all([
        supabase.from('purchase_orders').select('id, number, status, billing_status, order_date, expected_date, total, currency_code')
          .eq('vendor_id', vendorId!).is('deleted_at', null).order('order_date', { ascending: false }).limit(20),
        can('invoicing.read')
          ? supabase.from('vendor_bills').select('id, number, document_type, status, payment_status, vendor_invoice_number, bill_date, due_date, total, amount_due, currency_code')
            .eq('vendor_id', vendorId!).is('deleted_at', null).order('bill_date', { ascending: false }).limit(20)
          : Promise.resolve({ data: [], error: null }),
      ])
      return { orders: unwrap(orders), bills: unwrap(bills as { data: Tables<'vendor_bills'>[] | null; error: null }) ?? [] }
    },
  })
}

/* ------------------------------------------------------------- overview */
export interface ProcurementOverview {
  spend: number; bill_count: number; received_value: number; orders_count: number; orders_value: number
  open_po_value: number; late_count: number; to_bill_value: number; pending_po_approvals: number
  pending_requisitions: number; approved_requisitions: number; match_exceptions: number
  ap_open: number; ap_due_7: number; ap_overdue: number; ap_overdue_count: number
  on_time_pct: number | null; avg_lead_days: number | null
  spend_by_month: { month: string; spend: number }[]
  top_vendors: { id: string; name: string; spend: number; on_time_pct: number | null; lead_days: number | null }[]
  top_products: { sku: string; name: string; quantity: number; spend: number }[]
}
export function useProcurementOverview(from: string, to: string, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...procKeys.all(companyId), 'overview', from, to],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('procurement_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as ProcurementOverview,
  })
}

export const useCreateTransfers = () => useRpcAction(async (ids: string[]) =>
  unwrap(await supabase.rpc('create_transfers_from_suggestions', { p_ids: ids })) as unknown as { id: string; number: string }[])
export const useCreateWorkOrders = () => useRpcAction(async (ids: string[]) =>
  unwrap(await supabase.rpc('create_wos_from_suggestions', { p_ids: ids })) as unknown as { id: string; number: string }[])

export type RunAction = 'suggest' | 'draft_po' | 'submit_po'
export interface RunResult {
  id: string; suggestions: number
  purchase_orders: { id: string; number: string; status: string; vendor: string; total: number }[]
  transfers: { id: string; number: string }[]
  skipped: { sku: string; reason: string }[]
}
export const useRunReplenishment = () => {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useRpcAction(async (action: RunAction) => {
    const r = unwrap(await supabase.rpc('run_replenishment', { p_company: companyId, p_action: action })) as unknown as RunResult
    void qc.invalidateQueries({ queryKey: procKeys.list(companyId, 'runs') })
    return r
  })
}

export type RunRow = Tables<'replenishment_runs'> & { by: { full_name: string | null; email: string | null } | null }
export function useReplenishmentRuns() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, 'runs'),
    enabled: !!companyId,
    queryFn: async () => {
      const runs = unwrap(await supabase.from('replenishment_runs').select('*').eq('company_id', companyId)
        .order('run_at', { ascending: false }).limit(20))
      const ids = [...new Set(runs.map((r) => r.run_by).filter(Boolean))] as string[]
      const people = ids.length ? unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) : []
      return runs.map((r) => ({ ...r, by: people.find((p) => p.id === r.run_by) ?? null })) as RunRow[]
    },
  })
}

export interface AutomationSettings { auto_replenish_enabled: boolean; auto_replenish_action: RunAction; auto_replenish_hour: number; replenish_from_units: boolean }
export function useAutomationSettings() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: procKeys.list(companyId, 'automation'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings').select('auto_replenish_enabled, auto_replenish_action, auto_replenish_hour, replenish_from_units')
      .eq('company_id', companyId).maybeSingle()) as AutomationSettings,
  })
}
export function useSaveAutomation() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: Partial<AutomationSettings>) => unwrap(await supabase.rpc('set_replenishment_automation' as never, {
      p_company: companyId, p_enabled: v.auto_replenish_enabled ?? null, p_action: v.auto_replenish_action ?? null, p_hour: v.auto_replenish_hour ?? null,
      p_from_units: v.replenish_from_units ?? null,
    } as never)),
    onSuccess: () => {
      toast.success(t('Automatic replenishment saved'))
      void qc.invalidateQueries({ queryKey: procKeys.list(companyId, 'automation') })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}
