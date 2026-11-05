import type { TillPromo } from './promotions'
import type { AtkTill } from './atk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { after, byName, fetchAll, supabase } from '@/lib/supabase'
import { flushTillLog, kvGet, kvSet } from './offline'
import type { TillLoyalty } from '@/features/loyalty/api'

export const posKeys = { all: (c: string) => ['pos', c] as const }
function useInvalidatePos() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([qc.invalidateQueries({ queryKey: posKeys.all(companyId) }), qc.invalidateQueries({ queryKey: ['fin', companyId] })]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidatePos()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}

/* ------------------------------------------------------------------ registers & sessions */
export type Register = Tables<'pos_registers'> & { warehouse: { name: string } | null; location: { code: string } | null; cash: { name: string } | null
  sessions: { id: string; number: string; status: string; opened_at: string; opening_cash: number; opened_by: string }[] }
export function useRegisters() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'registers'],
    enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('pos_registers')
        .select('*, warehouse:warehouses(name), location:warehouse_locations(code), cash:bank_accounts(name), sessions:pos_sessions(id, number, status, opened_at, opening_cash, opened_by)')
        .eq('company_id', companyId).is('deleted_at', null).order('code').returns<Register[]>())
      return rows.map((r) => ({ ...r, sessions: r.sessions.filter((s) => s.status !== 'closed') }))
    },
  })
}
export function useSaveRegister() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('pos_registers').update(v as never).eq('id', id))
    : unwrap(await supabase.from('pos_registers').insert({ ...v, company_id: companyId } as never)))
}
export type SessionRow = Tables<'pos_sessions'> & { register: { code: string; name: string } | null; opener: { full_name: string | null } | null
  z: { id: string; number: string; gross_sales: number; refunds_total: number; cash_difference: number | null; order_count: number }[] }
export function useSessions() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'sessions'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('pos_sessions')
      .select('*, register:pos_registers(code, name), opener:profiles!pos_sessions_opened_by_profile_fkey(full_name), z:z_reports(id, number, gross_sales, refunds_total, cash_difference, order_count)')
      .eq('company_id', companyId).is('deleted_at', null).order('opened_at', { ascending: false }).limit(200).returns<SessionRow[]>()),
  })
}
export type ZReport = Tables<'z_reports'> & { register: { code: string; name: string; receipt_header: string | null } | null
  session: { number: string; opened_at: string; closed_at: string | null; journal_entry_id: string | null; cash_journal_entry_id: string | null } | null }
export function useSessionDetail(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'session', id],
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const s = unwrap(await supabase.from('pos_sessions').select('*, register:pos_registers(code, name)').eq('id', id!).single()
        .returns<Tables<'pos_sessions'> & { register: { code: string; name: string } | null }>())
      const z = unwrap(await supabase.from('z_reports')
        .select('*, register:pos_registers(code, name, receipt_header), session:pos_sessions(number, opened_at, closed_at, journal_entry_id, cash_journal_entry_id)')
        .eq('session_id', id!).maybeSingle().returns<ZReport | null>())
      const orders = unwrap(await supabase.from('pos_orders').select('id, number, device_ref, order_at, total, is_refund, offline_created, status, partner:business_partners(name), payments:pos_payments(method, amount)')
        .eq('session_id', id!).order('order_at', { ascending: false })
        .returns<{ id: string; number: string; device_ref: string | null; order_at: string; total: number; is_refund: boolean; offline_created: boolean; status: string
          partner: { name: string } | null; payments: { method: string; amount: number }[] }[]>())
      return { session: s, z, orders }
    },
  })
}
export function useSessionSummary(id: string | undefined) {
  return useQuery({
    queryKey: ['pos', 'summary', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('pos_session_summary', { p_session: id! })) as unknown as {
      orders: number; refunds: number; gross: number; refunded: number; net: number; tax: number; payments: Record<string, number>
      change: number; cash_in: number; cash_out: number; expected_cash: number },
  })
}
export const useOpenSession = () => useAction(async (a: { register: string; cash: number }) =>
  unwrap(await supabase.rpc('open_pos_session', { p_register: a.register, p_opening_cash: a.cash })) as string)
export const useCashMove = () => useAction(async (a: { session: string; type: 'cash_in' | 'cash_out'; amount: number; reason: string }) =>
  unwrap(await supabase.rpc('pos_cash_move', { p_session: a.session, p_type: a.type, p_amount: a.amount, p_reason: a.reason })))
/* ------------------------------------------------------------------ paying from the drawer */
export type Payees = { payouts: 'off' | 'manager' | 'anyone'; vendors: { id: string; code: string | null; name: string; tax_number: string | null; open: number }[]
  accounts: { id: string; code: string; name: string }[] }
export type OpenBill = { id: string; number: string; vendor_invoice_number: string | null; bill_date: string; due_date: string | null; total: number; open: number }
export function usePayees(register: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['pos', 'payees', register], enabled: !!register && enabled, staleTime: 30_000,
    queryFn: async () => unwrap(await supabase.rpc('pos_payees', { p_register: register! })) as unknown as Payees })
}
export function useVendorBills(register: string | undefined, vendor: string | null) {
  return useQuery({ queryKey: ['pos', 'vendor-bills', register, vendor], enabled: !!register && !!vendor,
    queryFn: async () => unwrap(await supabase.rpc('pos_vendor_bills', { p_register: register!, p_vendor: vendor! })) as unknown as OpenBill[] })
}
export type PayOut = { kind: 'supplier' | 'expense'; amount: number; partner_id?: string | null; bills?: { id: string; amount: number }[]
  account_id?: string | null; note?: string | null; document_no?: string | null; approval?: string | null }
export function usePayOut() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: async (a: { session: string; p: PayOut }) =>
      unwrap(await supabase.rpc('pos_pay_out', { p_session: a.session, p: a.p as never })) as unknown as { id: string; number?: string; allocated?: number; advance?: number },
    // the till's lists, the supplier's card and the books
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['pos'] }), qc.invalidateQueries({ queryKey: ['fin', companyId] })]),
    onError: (e) => toast.error(describeError(e)),
  })
}
export type SessionPayout = { id: string; kind: 'cash' | 'supplier' | 'expense'; movement_type: 'cash_in' | 'cash_out'; amount: number; reason: string
  partner: string | null; payment: string | null; account: string | null; document_no: string | null; at: string; by: string | null; approved_by: string | null }
export function useSessionPayouts(id: string | undefined) {
  return useQuery({ queryKey: ['pos', 'payouts', id], enabled: !!id,
    queryFn: async () => {
      const r = await supabase.rpc('pos_session_payouts', { p_session: id! })
      if (r.error?.code === 'PGRST202') return [] as SessionPayout[]   // a server not updated yet
      return unwrap(r) as unknown as SessionPayout[]
    } })
}

/** closing: the count (by note and coin when it was counted that way) and the manager's confirmation, if one was asked */
export const useCloseSession = () => useAction(async (a: { session: string; counted: number; notes?: string; notesCoins?: Record<string, number> | null; approval?: string | null }) => {
  await flushTillLog().catch(() => undefined)
  const r = await supabase.rpc('pos_close', { p_session: a.session, p: { counted: a.counted, notes: a.notes ?? null, notes_coins: a.notesCoins ?? null, approval: a.approval ?? null } })
  // a server not updated yet has only the older closing
  if (r.error?.code === 'PGRST202') return unwrap(await supabase.rpc('close_pos_session', { p_session: a.session, p_counted_cash: a.counted, p_notes: a.notes })) as string
  return unwrap(r) as string
})

/** the manager types their PIN on the cashier's screen */
export async function posApprove(register: string, member: string, pin: string, purpose: 'void' | 'close' | 'payout' | 'refund') {
  return unwrap(await supabase.rpc('pos_approve', { p_register: register, p_member: member, p_pin: pin, p_purpose: purpose })) as unknown as { approval?: string; name?: string; error?: string }
}

/** what the shift's count and its voids were (the Z report and the shift's page) */
export type SessionControls = {
  count: { notes_coins: Record<string, number> | null; counted: number; difference: number; counted_by: string | null; witnessed_by: string | null } | null
  voids: { count: number; amount: number; unconfirmed: number
    lines: { kind: 'void_line' | 'void_qty' | 'void_sale'; description: string | null; quantity: number | null; amount: number; at: string; cashier: string | null; approved_by: string | null; offline: boolean }[] }
}
export async function sessionControls(id: string) {
  return unwrap(await supabase.rpc('pos_session_controls', { p_session: id })) as unknown as SessionControls
}
export function useSessionControls(id: string | undefined) {
  return useQuery({ queryKey: ['pos', 'controls', id], enabled: !!id, queryFn: () => sessionControls(id!) })
}

/* ------------------------------------------------------------------ till data (cached for offline) */
export type TillOptions = {
  /** closing counts by note and coin */
  count_notes: boolean
  /** taking an item off a sale, lowering a quantity or clearing a sale needs a manager's PIN */
  void_approval?: boolean
  /** when the closing count is confirmed by a manager: never, when the drawer is off by more than the tolerance, always */
  close_witness?: 'never' | 'difference' | 'always'
  tolerance?: number
  /** the store managers who can confirm with their PIN */
  managers?: { member_id: string; name: string }[]
  /** who may pay a supplier or an expense from the drawer */
  payouts?: 'off' | 'manager' | 'anyone'
  /** the managers are told of every item taken off */
  void_notify?: boolean
  /** the highest value of one receipt (null = no limit) */
  receipt_max?: number | null
}
export type CatalogItem = { variant_id: string; sku: string; name: string; category: string | null; barcodes: { code: string; qty: number }[]
  price: number; tax_code_id: string | null; tax_rate: number; tracking: string; on_hand: number; product_type: string
  /** the unit it is sold in (a server not updated yet sends none) */
  uom?: string | null }
export type TillData = {
  register: Pick<Register, 'id' | 'code' | 'name' | 'company_id' | 'receipt_header' | 'receipt_footer' | 'default_customer_id' | 'location_id' | 'warehouse_id' | 'paper_mm'>
  session: { id: string; number: string; opened_at: string; opening_cash: number } | null
  catalog: CatalogItem[]
  customers: { id: string; name: string; code: string | null; tax_number: string | null; kind?: 'company' | 'individual' }[]
  /** the law's daily cash limits (null = none) and whether cash above them is refused */
  cashLimits?: { business: number | null; individual: number | null; block: boolean } | null
  /** the company's choices for the till */
  options?: TillOptions
  company: { name: string; legal_name: string | null; tax_number: string | null; base_currency: string; address: string | null }
  /** loyalty cards and their rules, kept so discount cards work offline */
  loyalty?: TillLoyalty
  /** promotions running on this till (kept for offline) */
  promotions?: TillPromo[]
  /** Kosovo: this till's ATK numbers, so it signs its coupons without internet */
  atk?: AtkTill
  loadedAt: string
}
/** Loads the till from the server when online and keeps a copy on the device; falls back to the copy offline */
export function useTill(registerId: string | undefined) {
  const [state, setState] = React.useState<{ data: TillData | null; offline: boolean; loading: boolean; error: string | null }>({ data: null, offline: false, loading: true, error: null })
  const load = React.useCallback(async () => {
    if (!registerId) return
    const key = `till:${registerId}`
    const cached = await kvGet<TillData>(key).catch(() => undefined)
    if (cached) setState({ data: cached, offline: !navigator.onLine, loading: false, error: null })
    try {
      const reg = unwrap(await supabase.from('pos_registers').select('*').eq('id', registerId).single())
      const [ses, cat, cus, co, loy, lim, promo, opt, atk] = await Promise.all([
        supabase.from('pos_sessions').select('id, number, opened_at, opening_cash').eq('register_id', registerId).eq('status', 'open').maybeSingle(),
        // a supermarket has thousands of items: read them all, 1 000 at a time (the server gives no more in one call)
        fetchAll('variant_id', (a) => after(supabase.rpc('pos_catalog', { p_register: registerId }), 'variant_id', a).order('variant_id').limit(1000)).then((data) => ({ data, error: null })),
        fetchAll('id', (a) => after(supabase.from('business_partners').select('id, name, code, tax_number, kind').eq('company_id', reg.company_id).eq('is_customer', true).is('deleted_at', null), 'id', a).order('id').limit(1000))
          .then((data) => ({ data: byName(data) })),
        supabase.from('companies').select('name, legal_name, tax_number, base_currency, address_line1, city').eq('id', reg.company_id).single(),
        supabase.rpc('pos_loyalty_data', { p_register: registerId }),
        supabase.rpc('pos_cash_limits', { p_register: registerId }),
        supabase.rpc('pos_promotions', { p_register: registerId }),
        supabase.rpc('pos_till_options', { p_register: registerId }),
        supabase.rpc('atk_till', { p_register: registerId }),
      ])
      if (cat.error) throw cat.error
      const data: TillData = {
        register: reg as TillData['register'], session: ses.data ?? null,
        catalog: (cat.data ?? []).map((c) => ({ ...c, price: Number(c.price), tax_rate: Number(c.tax_rate), on_hand: Number(c.on_hand), barcodes: (c.barcodes ?? []) as CatalogItem['barcodes'] })) as CatalogItem[],
        customers: (cus.data ?? []) as TillData['customers'],
        company: { name: co.data?.name ?? '', legal_name: co.data?.legal_name ?? null, tax_number: co.data?.tax_number ?? null, base_currency: co.data?.base_currency ?? 'ALL', address: [co.data?.address_line1, co.data?.city].filter(Boolean).join(', ') || null },
        loyalty: loy.error ? cached?.loyalty : (loy.data as unknown as TillLoyalty),
        cashLimits: lim.error ? cached?.cashLimits ?? null : (lim.data as unknown as TillData['cashLimits']),
        promotions: promo.error ? cached?.promotions ?? [] : (promo.data as unknown as TillPromo[]),
        options: opt.error ? cached?.options ?? { count_notes: true } : (opt.data as unknown as TillData['options']),
        atk: atk.error ? cached?.atk : (atk.data as unknown as AtkTill),
        loadedAt: new Date().toISOString(),
      }
      await kvSet(key, data).catch(() => undefined)
      setState({ data, offline: false, loading: false, error: null })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, offline: true, error: s.data ? null : describeError(e) }))
    }
  }, [registerId])
  React.useEffect(() => { void load() }, [load])
  const patch = React.useCallback((fn: (d: TillData) => TillData) => {
    setState((s) => {
      if (!s.data) return s
      const next = fn(s.data)
      void kvSet(`till:${registerId}`, next).catch(() => undefined)
      return { ...s, data: next }
    })
  }, [registerId])
  return { ...state, reload: load, patch }
}

export type ReceiptLookup = { id: string; number: string; device_ref: string | null; order_at: string; total: number; is_refund: boolean
  /** the ATK coupon of the sale (Kosovo), needed for a return */
  atk_coupon: string | null
  lines: { variant_id: string; description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number; tax_rate: number }[]
  refunds: { lines: { variant_id: string; quantity: number }[] }[] }
export async function lookupReceipt(companyId: string, code: string): Promise<ReceiptLookup | null> {
  const c = code.trim().replace(/[,()]/g, '')
  const rows = unwrap(await supabase.from('pos_orders')
    .select('id, number, device_ref, order_at, total, is_refund, atk_coupon:atk->>coupon_id, lines:pos_order_lines(variant_id, description, quantity, unit_price, discount_pct, line_total, tax_rate)')
    .eq('company_id', companyId).or(`number.eq.${c},device_ref.eq.${c}`).eq('status', 'paid').limit(1))
  const o = rows[0]
  if (!o) return null
  // earlier refunds of this receipt (fetched separately: the self-reference cannot be embedded)
  const refunds = unwrap(await supabase.from('pos_orders').select('lines:pos_order_lines(variant_id, quantity)')
    .eq('company_id', companyId).eq('refund_of_id', o.id).eq('status', 'paid'))
  return { ...(o as unknown as Omit<ReceiptLookup, 'refunds'>), refunds: refunds as unknown as ReceiptLookup['refunds'] }
}
