import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { saveDocumentOffline } from '@/lib/offline/step'
import type { Json, Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { after, byName, fetchAll, fetchPages, supabase } from '@/lib/supabase'
import { t } from '@/i18n'
import { todayISO } from '@/lib/utils'

export const salesKeys = {
  all: (c: string) => ['sales', c] as const,
  list: (c: string, what: string) => ['sales', c, 'list', what] as const,
  doc: (c: string, kind: string, id: string) => ['sales', c, 'doc', kind, id] as const,
}

function useInvalidateSales() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: salesKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['inv', companyId] }),   // reservations & deliveries change stock
  ])
}

/* -------------------------------------------------------------- lookups */
export function useCustomers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'customers'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: () => fetchAll('id', (x) => after(supabase.from('business_partners')
      .select('id, code, name, tax_number, currency_code, price_list_id, payment_term_id, default_discount_pct, credit_limit, salesperson_id, email, phone')
      .eq('company_id', companyId).eq('is_customer', true).eq('is_active', true).is('deleted_at', null), 'id', x).order('id').limit(1000)).then(byName),
  })
}

export function useStages() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'stages'),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('crm_pipeline_stages').select('*').eq('company_id', companyId).is('deleted_at', null).order('sort_order')),
  })
}

export function usePaymentTerms() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'payment-terms'),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('payment_terms').select('id, code, name, due_days').eq('company_id', companyId).eq('is_active', true).is('deleted_at', null).order('due_days')),
  })
}

export function usePriceLists() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'price-lists'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('price_lists')
      .select('*, items:price_list_items(count)').eq('company_id', companyId).eq('list_type', 'sales').is('deleted_at', null).order('name')),
  })
}

/** Members of the company, for owner / salesperson pickers */
export function useMembers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'members'),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const members = unwrap(await supabase.from('company_members').select('user_id').eq('company_id', companyId).eq('status', 'active').not('user_id', 'is', null))
      const ids = members.map((m) => m.user_id!).filter(Boolean)
      if (!ids.length) return []
      return unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', ids).order('full_name'))
    },
  })
}

/** Sellable variants (stockable + services) for document lines */
export type SellableVariant = { id: string; sku: string; name: string; product_type: string; uom_code: string; sales_price: number; available: number; codes?: string | null; category_id?: string | null }
export function useSellableVariants() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'sellable'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: () => fetchAll('sku', (x) => after(supabase.from('v_product_stock')
      .select('id:variant_id, sku, name:variant_name, product_type, uom_code, sales_price, available, codes, category_id')
      .eq('company_id', companyId).eq('is_active', true), 'sku', x).order('sku').limit(1000).returns<SellableVariant[]>()),
  })
}

export async function fetchPrice(args: { companyId: string; partnerId?: string | null; variantId: string; quantity: number; date?: string; priceListId?: string | null; currency?: string | null }) {
  const { data, error } = await supabase.rpc('get_price', {
    p_company: args.companyId, p_partner: (args.partnerId ?? null) as string, p_variant: args.variantId, p_quantity: args.quantity,
    p_date: args.date ?? todayISO(), p_price_list: args.priceListId ?? undefined, p_currency: args.currency ?? undefined,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/* ---------------------------------------------------------------- CRM */
export type LeadRow = Tables<'leads'> & { owner: { full_name: string | null } | null }
export function useLeads() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'leads'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('leads').select('*, owner:profiles!leads_owner_profile_fkey(full_name)')
      .eq('company_id', companyId).is('deleted_at', null).order('created_at', { ascending: false }).returns<LeadRow[]>()),
  })
}

export type OpportunityRow = Tables<'opportunities'> & {
  partner: { id: string; name: string } | null
  owner: { full_name: string | null } | null
}
export function useOpportunities() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'opportunities'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('opportunities')
      .select('*, partner:business_partners(id, name), owner:profiles!opportunities_owner_profile_fkey(full_name)')
      .eq('company_id', companyId).is('deleted_at', null).order('expected_close_date', { nullsFirst: false }).returns<OpportunityRow[]>()),
  })
}

export function useSaveRecord(table: 'leads' | 'opportunities' | 'business_partners' | 'partner_prices' | 'partner_contacts' | 'partner_addresses') {
  const { companyId } = useCompany()
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async ({ id, ...values }: Record<string, unknown> & { id?: string }) => {
      if (id) return unwrap(await supabase.from(table).update(values as never).eq('id', id).select('id').single())
      return unwrap(await supabase.from(table).insert({ ...values, company_id: companyId } as never).select('id').single())
    },
    onSuccess: () => void invalidate(),
  })
}

export function useDeleteRecord(table: 'leads' | 'opportunities' | 'business_partners' | 'partner_prices' | 'partner_contacts' | 'partner_addresses' | 'price_lists') {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(table).delete().eq('id', id)),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

/** Drag a card to another stage: optimistic, rolled back if the server refuses (e.g. reopening a won deal) */
export function useMoveOpportunity() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const key = salesKeys.list(companyId, 'opportunities')
  return useMutation({
    mutationFn: async ({ id, stageId, lostReason }: { id: string; stageId: string; lostReason?: string }) =>
      unwrap(await supabase.from('opportunities').update({ stage_id: stageId, ...(lostReason ? { lost_reason: lostReason } : {}) }).eq('id', id)),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<OpportunityRow[]>(key)
      qc.setQueryData<OpportunityRow[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, stage_id: stageId } : r)))
      return { prev }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); toast.error(describeError(e)) },
    onSettled: () => void qc.invalidateQueries({ queryKey: salesKeys.all(companyId) }),
  })
}

export function useConvertLead() {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async (v: { leadId: string; partnerId?: string | null; name?: string; value?: number | null }) =>
      unwrap(await supabase.rpc('convert_lead', {
        p_lead: v.leadId, p_partner: v.partnerId ?? undefined, p_opportunity_name: v.name || undefined, p_expected_value: v.value ?? undefined,
      })) as { partner_id: string; opportunity_id: string },
    onSuccess: () => void invalidate(),
  })
}

/* ------------------------------------------------------------ documents */
export type SalesKind = 'quotes' | 'orders' | 'invoices' | 'deliveries'
export const SALES_TABLE = {
  quotes: 'sales_quotes', orders: 'sales_orders', invoices: 'sales_invoices', deliveries: 'deliveries',
} as const
export const SALES_LINES = {
  quotes: 'sales_quote_lines', orders: 'sales_order_lines', invoices: 'sales_invoice_lines', deliveries: 'delivery_lines',
} as const

const LIST_SELECT: Record<SalesKind, string> = {
  quotes: 'id, number, status, quote_date, valid_until, currency_code, total, total_base, partner:business_partners(name), salesperson:profiles!sales_quotes_salesperson_profile_fkey(full_name)',
  orders: 'id, number, status, invoice_status, order_date, requested_date, currency_code, total, total_base, channel, partner:business_partners(name), salesperson:profiles!sales_orders_salesperson_profile_fkey(full_name), lines:sales_order_lines(quantity, qty_delivered, qty_reserved)',
  invoices: 'id, number, document_type, is_debit_note, status, payment_status, fiscal_status, invoice_date, due_date, currency_code, exchange_rate, total, tax_total, total_base, amount_due, partner:business_partners(name), order:sales_orders(number)',
  deliveries: 'id, number, status, scheduled_date, done_at, total_cost, partner:business_partners(name), order:sales_orders(number), warehouse:warehouses(name), lines:delivery_lines(quantity)',
}
const DATE_COL: Record<SalesKind, string> = { quotes: 'quote_date', orders: 'order_date', invoices: 'invoice_date', deliveries: 'scheduled_date' }

export function useSalesDocuments<T>(kind: SalesKind) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, kind),
    enabled: !!companyId,
    queryFn: async () => {
      // every document, 1 000 at a time, newest first
      return await fetchPages((from, to) => supabase.from(SALES_TABLE[kind]).select(LIST_SELECT[kind])
        .eq('company_id', companyId!).is('deleted_at', null)
        .order(DATE_COL[kind], { ascending: false }).order('number', { ascending: false }).order('id').range(from, to)) as unknown as T[]
    },
  })
}

const DETAIL_SELECT: Record<SalesKind, string> = {
  quotes: '*, lines:sales_quote_lines(*), opportunity:opportunities(id, name), orders:sales_orders(id, number, status)',
  orders: '*, lines:sales_order_lines(*), quote:sales_quotes(id, number), deliveries(id, number, status, scheduled_date, total_cost), invoices:sales_invoices(id, number, status, document_type, total, deleted_at)',
  invoices: '*, lines:sales_invoice_lines(*), order:sales_orders(id, number)',
  deliveries: '*, lines:delivery_lines(*), order:sales_orders(id, number, status), partner:business_partners(name)',
}

export function useSalesDocument<T>(kind: SalesKind, id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.doc(companyId, kind, id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from(SALES_TABLE[kind]).select(DETAIL_SELECT[kind]).eq('id', id!).single()
      if (error) throw error
      const row = data as unknown as Record<string, unknown>
      // credit notes: PostgREST can't embed this composite self-reference, so fetch the original separately
      if (kind === 'invoices' && row.original_invoice_id) {
        const orig = await supabase.from('sales_invoices').select('id, number').eq('id', row.original_invoice_id as string).maybeSingle()
        row.original = orig.data
      }
      if (kind === 'invoices' && row.status === 'posted') {
        const fr = await supabase.from('fiscalization_records').select('status, iic, fic, error_message')
          .eq('source_doc_id', id!).order('created_at', { ascending: false }).limit(1)
        row.fiscal = fr.data ?? []
      }
      return row as unknown as T
    },
  })
}

/** Save a draft. Quotes, orders and invoices can also be saved without internet (sent when the connection is back). */
export function useSaveSalesDocument(kind: SalesKind) {
  const { companyId } = useCompany()
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async ({ header, lines, label }: { header: Record<string, unknown>; lines: Record<string, unknown>[]; label?: string }) => {
      if (kind !== 'deliveries') {
        return saveDocumentOffline({ companyId: companyId!, table: SALES_TABLE[kind], header, children: { [SALES_LINES[kind]]: lines }, label: label ?? t('Draft'),
          invalidate: [['sales', companyId]] })
      }
      return unwrap(await supabase.rpc('save_document', {
        p_table: SALES_TABLE[kind],
        p_header: { ...header, company_id: companyId } as unknown as Json,
        p_children: { [SALES_LINES[kind]]: lines } as unknown as Json,
      })) as string
    },
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useSetStatus(kind: SalesKind) {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: string; extra?: Record<string, unknown> }) =>
      unwrap(await supabase.from(SALES_TABLE[kind]).update({ status, ...extra } as never).eq('id', id)),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useDeleteSalesDocument(kind: SalesKind) {
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(SALES_TABLE[kind]).delete().eq('id', id)),
    onSuccess: () => { toast.success(t('Draft deleted')); void invalidate() },
    onError: (e) => toast.error(describeError(e)),
  })
}

/** Every document action RPC, with consistent invalidation and error toasts */
function useRpcAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidateSales()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}
export const useConvertQuote = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('convert_quote_to_order', { p_quote: id })))
export const useConfirmOrder = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('confirm_sales_order', { p_id: id })))
export const useReserveOrder = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('reserve_sales_order', { p_id: id })))
export const useCreateDelivery = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_delivery_from_order', { p_order: id })))
export const usePostDelivery = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('post_delivery', { p_id: id })) as { cost: number; lines: number })
export const useCreateInvoice = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_invoice_from_order', { p_order: id })))
export const usePostInvoice = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('post_sales_invoice', { p_id: id })) as { total: number; fiscal_status: string })
export const useCreditNote = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_credit_note', { p_invoice: id })))
export const useDebitNote = () => useRpcAction(async (id: string) => unwrap(await supabase.rpc('create_debit_note', { p_invoice: id })) as string)

export function useOrderAvailability(orderId: string | undefined, enabled: boolean) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...salesKeys.doc(companyId, 'orders', orderId ?? ''), 'availability'],
    enabled: !!orderId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('sales_order_availability', { p_id: orderId! })),
  })
}

/* ------------------------------------------------------------- overview */
export interface SalesOverview {
  revenue: number; invoice_count: number; till_revenue?: number; till_receipts?: number; cogs: number; orders_count: number; orders_value: number
  quotes_sent: number; quotes_converted: number; won: number; lost: number; backlog: number
  overdue_count: number; overdue_amount: number
  pipeline: { name: string; probability: number; count: number; value: number; weighted: number }[]
  revenue_by_month: { month: string; revenue: number; till?: number }[]
  top_customers: { id: string; name: string; revenue: number }[]
  top_products: { sku: string; name: string; quantity: number; revenue: number }[]
  by_salesperson: { name: string; revenue: number; invoices: number }[]
}
export function useSalesOverview(from: string, to: string, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...salesKeys.all(companyId), 'overview', from, to],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('sales_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as SalesOverview,
  })
}

/* ------------------------------------------------------- partners & prices */
export function usePartners() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.list(companyId, 'partners'),
    enabled: !!companyId,
    queryFn: () => fetchAll('id', (x) => after(supabase.from('business_partners')
      .select('id, code, name, kind, is_customer, is_vendor, tax_number, email, phone, credit_limit, is_active, tags, price_list:price_lists(name), salesperson:profiles!business_partners_salesperson_profile_fkey(full_name)')
      .eq('company_id', companyId).is('deleted_at', null), 'id', x).order('id').limit(1000)).then(byName),
  })
}

export type PartnerDetail = Tables<'business_partners'> & {
  contacts: Tables<'partner_contacts'>[]
  addresses: Tables<'partner_addresses'>[]
  prices: (Tables<'partner_prices'> & { variant: { sku: string; name: string } })[]
}
export function usePartner(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.doc(companyId, 'partner', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const p = unwrap(await supabase.from('business_partners')
        .select('*, contacts:partner_contacts(*), addresses:partner_addresses(*), prices:partner_prices(*, variant:product_variants(sku, name))')
        .eq('id', id!).single().returns<PartnerDetail>())
      return { ...p, contacts: p.contacts.filter((c) => !c.deleted_at), addresses: p.addresses.filter((a) => !a.deleted_at), prices: p.prices.filter((x) => !x.deleted_at) }
    },
  })
}

export function usePartnerActivity(partnerId: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.doc(companyId, 'partner-docs', partnerId ?? ''),
    enabled: !!companyId && !!partnerId,
    queryFn: async () => {
      const [orders, invoices, opps] = await Promise.all([
        supabase.from('sales_orders').select('id, number, status, order_date, total, currency_code').eq('partner_id', partnerId!).is('deleted_at', null).order('order_date', { ascending: false }).limit(20),
        supabase.from('sales_invoices').select('id, number, document_type, status, payment_status, invoice_date, due_date, total, amount_due, currency_code').eq('partner_id', partnerId!).is('deleted_at', null).order('invoice_date', { ascending: false }).limit(20),
        supabase.from('opportunities').select('id, name, status, expected_value, currency_code').eq('partner_id', partnerId!).is('deleted_at', null).limit(20),
      ])
      return { orders: unwrap(orders), invoices: unwrap(invoices), opportunities: unwrap(opps) }
    },
  })
}

export function usePriceList(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: salesKeys.doc(companyId, 'price-list', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const pl = unwrap(await supabase.from('price_lists').select('*, items:price_list_items(*)').eq('id', id!).single())
      return { ...pl, items: (pl.items as Tables<'price_list_items'>[]).filter((i) => !i.deleted_at) }
    },
  })
}

export function useSavePriceList() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateSales()
  return useMutation({
    mutationFn: async ({ header, items }: { header: Record<string, unknown>; items: Record<string, unknown>[] }) =>
      unwrap(await supabase.rpc('save_document', {
        p_table: 'price_lists',
        p_header: { ...header, company_id: companyId } as unknown as Json,
        p_children: { price_list_items: items } as unknown as Json,
      })) as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
