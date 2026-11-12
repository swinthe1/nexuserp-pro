import type { TillPromo } from './promotions'
import type { AtkTill } from './atk'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { after, byName, fetchAll, fetchPages, supabase } from '@/lib/supabase'
import { flushTillLog, itemsAll, itemsWrite, kvGet, kvSet, pendingQty } from './offline'
import { t } from '@/i18n'
import { num } from '@/lib/utils'
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
      const orders = unwrap(await supabase.from('pos_orders').select('id, number, device_ref, order_at, total, is_refund, offline_created, status, coupon_type:atk->>type, cancel_reason:atk->>reason, partner:business_partners(name), payments:pos_payments(method, amount)')
        .eq('session_id', id!).order('order_at', { ascending: false })
        .returns<{ id: string; number: string; device_ref: string | null; order_at: string; total: number; is_refund: boolean; offline_created: boolean; status: string
          /** ATK's coupon type: 0 sale, 1 return, 2 cancellation (with its reason) */
          coupon_type: string | null; cancel_reason: string | null
          partner: { name: string } | null; payments: { method: string; amount: number }[] }[]>())
      return { session: s, z, orders }
    },
  })
}
export function useSessionSummary(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId!), 'summary', id],
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
/** gift vouchers: what is left on one (null: no such code) */
export type VoucherInfo = { id: string; code: string; amount: number; balance: number; valid_until: string | null; status: 'active' | 'used' | 'void' | 'expired' }
export async function checkVoucher(register: string, code: string) {
  return unwrap(await supabase.rpc('pos_voucher_check', { p_register: register, p_code: code })) as unknown as VoucherInfo | null
}
/** the banks whose card terminal may take a payment at this till (kept on the device, so the till knows them offline too) */
export async function cardBanks(register: string): Promise<string[]> {
  const key = `drispro.till.banks.${register}`
  try {
    const list = unwrap(await supabase.rpc('till_card_banks', { p_register: register })) as unknown as string[]
    try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* private window */ }
    return list
  } catch (e) {
    try { const s = localStorage.getItem(key); if (s) return JSON.parse(s) as string[] } catch { /* nothing kept */ }
    throw e
  }
}
export async function sellVoucher(session: string, p: { amount: number; method: 'cash' | 'card'; valid_until?: string | null; note?: string | null; client_uuid: string }) {
  return unwrap(await supabase.rpc('pos_voucher_sell', { p_session: session, p: p as never })) as unknown as { id: string; code: string; amount: number; valid_until: string; duplicate: boolean }
}
/** a customer's credit at the till: the limit, what they owe now (shifts still open included), what is left */
export type CustomerCredit = { name: string; limit: number | null; owes: number; available: number }
export function useCustomerCredit(register: string | undefined, partner: string | null | undefined) {
  return useQuery({ queryKey: ['pos', 'credit', register, partner], enabled: !!register && !!partner, staleTime: 0,
    queryFn: async () => unwrap(await supabase.rpc('pos_customer_credit', { p_register: register!, p_partner: partner! })) as unknown as CustomerCredit | null })
}
export type Voucher = { id: string; code: string; amount: number; balance: number; valid_until: string | null; status: 'active' | 'used' | 'void'
  sold_method: 'cash' | 'card' | null; note: string | null; void_reason: string | null; created_at: string; session: { number: string } | null }
export function useVouchers() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: [...posKeys.all(companyId!), 'vouchers'], enabled: !!companyId,
    queryFn: async () => (await fetchPages((from, to) => supabase.from('gift_vouchers')
      .select('id, code, amount, balance, valid_until, status, sold_method, note, void_reason, created_at, session:pos_sessions(number)')
      .eq('company_id', companyId!).is('deleted_at', null).order('created_at', { ascending: false }).order('id').range(from, to))) as unknown as Voucher[] })
}
export const useBlockVoucher = () => useAction(async (a: { id: string; reason: string }) => unwrap(await supabase.rpc('voucher_block', { p_id: a.id, p_reason: a.reason })))
export type SessionPayout = { id: string; kind: 'cash' | 'supplier' | 'expense'; movement_type: 'cash_in' | 'cash_out'; amount: number; reason: string
  partner: string | null; payment: string | null; account: string | null; document_no: string | null; at: string; by: string | null; approved_by: string | null }
export function useSessionPayouts(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({ queryKey: [...posKeys.all(companyId!), 'payouts', id], enabled: !!id,
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
export async function posApprove(register: string, member: string, pin: string, purpose: 'void' | 'close' | 'payout' | 'refund' | 'unlock') {
  return unwrap(await supabase.rpc('pos_approve', { p_register: register, p_member: member, p_pin: pin, p_purpose: purpose })) as unknown as { approval?: string; name?: string; error?: string }
}

/** what the shift's count and its voids were (the Z report and the shift's page) */
export type SessionControls = {
  count: { notes_coins: Record<string, number> | null; counted: number; difference: number; counted_by: string | null; witnessed_by: string | null } | null
  voids: { count: number; amount: number; unconfirmed: number
    lines: { kind: 'void_line' | 'void_qty' | 'void_sale'; description: string | null; quantity: number | null; amount: number; at: string; cashier: string | null; approved_by: string | null; offline: boolean }[] }
  /** the shift's card money by the bank whose terminal took it ('' = taken before the bank was asked) */
  card_banks?: Record<string, number>
}
/** the card money by bank as lines to show under "Card": nothing when no payment names a bank */
export function cardBankLines(c: SessionControls | null | undefined): [string, number][] {
  const e = Object.entries(c?.card_banks ?? {}).map(([k, v]) => [k, Number(v)] as [string, number])
  return e.some(([k]) => k) ? e.sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0])) : []
}
export async function sessionControls(id: string) {
  return unwrap(await supabase.rpc('pos_session_controls', { p_session: id })) as unknown as SessionControls
}
export function useSessionControls(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({ queryKey: [...posKeys.all(companyId!), 'controls', id], enabled: !!id, queryFn: () => sessionControls(id!) })
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
  /** how this company's scales print their barcodes */
  scale?: import('@/lib/scale-barcode').ScaleSetup
}
export type CatalogItem = { variant_id: string; sku: string; name: string; category: string | null; barcodes: { code: string; qty: number }[]
  price: number; tax_code_id: string | null; tax_rate: number; tracking: string; on_hand: number; product_type: string
  /** the unit it is sold in (a server not updated yet sends none) */
  uom?: string | null
  /** the item's number on the scale (its PLU), for the scale's barcodes */
  scale_plu?: string | null }
export type TillShiftInfo = {
  last: { number: string; closed_at: string; closed_by: string | null; counted: number | null; difference: number | null; review_status: string } | null
  mine_open: { register: string; number: string } | null
  returned: number
  blind: boolean
  review: boolean
}

export type TillData = {
  register: Pick<Register, 'id' | 'code' | 'name' | 'company_id' | 'receipt_header' | 'receipt_footer' | 'default_customer_id' | 'location_id' | 'warehouse_id' | 'paper_mm' | 'mode' | 'screen' | 'quick_items'>
  session: { id: string; number: string; opened_at: string; opening_cash: number; opened_by?: string | null; opener?: string | null } | null
  /** before opening and at closing: the last shift, a blind count, whether a manager reconciles */
  shift?: TillShiftInfo
  catalog: CatalogItem[]
  customers: { id: string; name: string; code: string | null; tax_number: string | null; kind?: 'company' | 'individual' }[]
  /** the law's daily cash limits (null = none) and whether cash above them is refused */
  cashLimits?: { business: number | null; individual: number | null; block: boolean } | null
  /** the company's choices for the till */
  options?: TillOptions
  company: { name: string; legal_name: string | null; tax_number: string | null; base_currency: string; address: string | null; business_type?: string | null }
  /** the manager's quick buttons, and what sells most here */
  quick?: TillQuick
  /** loyalty cards and their rules, kept so discount cards work offline */
  loyalty?: TillLoyalty
  /** promotions running on this till (kept for offline) */
  promotions?: TillPromo[]
  /** Kosovo: this till's ATK numbers, so it signs its coupons without internet */
  atk?: AtkTill
  loadedAt: string
  /** the server's time of the last look at prices (the next look asks what changed after it) */
  pricesAt?: string
}
type CatalogRow = { price: number | string | null; tax_rate: number | string | null; on_hand: number | string | null; barcodes: unknown } & Record<string, unknown>
const toCatalogItem = (c: CatalogRow): CatalogItem =>
  ({ ...c, price: Number(c.price), tax_rate: Number(c.tax_rate), on_hand: Number(c.on_hand), barcodes: (c.barcodes ?? []) as CatalogItem['barcodes'] }) as unknown as CatalogItem
/** a minute early: a change saved while the catalog was being read is taken again, not lost */
const minuteBefore = (at: string) => new Date(Date.parse(at) - 60_000).toISOString()
/** the copy on the device keeps the items in rows of their own (offline.ts): the rest is one small record */
type StoredTill = Omit<TillData, 'catalog'> & { catalog?: CatalogItem[] }
const stripCatalog = ({ catalog: _c, ...rest }: TillData): StoredTill => rest
const sortItems = (items: CatalogItem[]) => items.sort((a, b) => a.name.localeCompare(b.name))
async function readCopy(registerId: string): Promise<TillData | undefined> {
  const key = `till:${registerId}`
  const blob = await kvGet<StoredTill>(key)
  if (!blob) return undefined
  let items = await itemsAll<CatalogItem>(registerId).catch(() => [] as CatalogItem[])
  // a copy made before the items had their own rows: they move there once
  if (blob.catalog?.length) {
    if (!items.length) { items = blob.catalog; await itemsWrite(registerId, items, [], true).catch(() => undefined) }
    await kvSet(key, { ...blob, catalog: undefined }).catch(() => undefined)
  }
  return { ...blob, catalog: sortItems(items) } as TillData
}
/** keeps the till on the device: the small record, and only the item rows that changed */
function keepCopy(registerId: string, prev: TillData | null, next: TillData) {
  void kvSet(`till:${registerId}`, stripCatalog(next)).catch(() => undefined)
  if (!prev || prev.catalog === next.catalog) return
  const before = new Map(prev.catalog.map((i) => [i.variant_id, i]))
  const put = next.catalog.filter((i) => before.get(i.variant_id) !== i)
  const still = new Set(next.catalog.map((i) => i.variant_id))
  const del = prev.catalog.filter((i) => !still.has(i.variant_id)).map((i) => i.variant_id)
  void itemsWrite(registerId, put, del).catch(() => undefined)
}
type CatalogChanges = { at: string; full: boolean; items?: CatalogRow[]; gone?: string[]; promotions?: boolean }
/** the items with what changed: changed rows replaced (same objects for the others), new ones added, gone ones out */
function withChanges(items: CatalogItem[], changed: CatalogItem[], gone: Set<string>) {
  const byId = new Map(changed.map((i) => [i.variant_id, i]))
  const seen = new Set<string>()
  const out = items.filter((i) => !gone.has(i.variant_id)).map((i) => { const n = byId.get(i.variant_id); if (!n) return i; seen.add(i.variant_id); return n })
  let added = false
  for (const n of changed) if (!seen.has(n.variant_id) && !gone.has(n.variant_id)) { out.push(n); added = true }
  return added ? sortItems(out) : out
}
/** Loads the till from the server when online and keeps a copy on the device; falls back to the copy offline.
 *  A till opened again the same day reads only the items that changed since (a market has 20 000 and more). */
export function useTill(registerId: string | undefined) {
  const [state, setState] = React.useState<{ data: TillData | null; offline: boolean; loading: boolean; error: string | null }>({ data: null, offline: false, loading: true, error: null })
  const load = React.useCallback(async (opts?: { full?: boolean }) => {
    if (!registerId) return
    const cached = await readCopy(registerId).catch(() => undefined)
    if (cached) setState({ data: cached, offline: !navigator.onLine, loading: false, error: null })
    try {
      const reg = unwrap(await supabase.from('pos_registers').select('*').eq('id', registerId).single())
      const catalogNow = async (): Promise<{ items: CatalogItem[]; at?: string; full: boolean }> => {
        if (!opts?.full && cached?.pricesAt && cached.catalog.length) {
          const { data: ch, error } = await supabase.rpc('pos_catalog_changes', { p_register: registerId, p_since: cached.pricesAt })
          const c = ch as unknown as CatalogChanges | null
          if (!error && c && !c.full) {
            const waiting = pendingQty(registerId)
            const changed = (c.items ?? []).map(toCatalogItem).map((i) => (waiting.has(i.variant_id) ? { ...i, on_hand: i.on_hand - waiting.get(i.variant_id)! } : i))
            return { items: withChanges(cached.catalog, changed, new Set(c.gone ?? [])), at: c.at, full: false }
          }
        }
        // a supermarket has thousands of items: read them all, 1 000 at a time (the server gives no more in one call)
        const rows = await fetchAll('variant_id', (a) => after(supabase.rpc('pos_catalog', { p_register: registerId }), 'variant_id', a).order('variant_id').limit(1000))
        const waiting = pendingQty(registerId)
        return { items: sortItems(rows.map(toCatalogItem).map((i) => (waiting.has(i.variant_id) ? { ...i, on_hand: i.on_hand - waiting.get(i.variant_id)! } : i))), full: true }
      }
      const [ses, cat, cus, co, loy, lim, promo, opt, atk, clock, shift, quick] = await Promise.all([
        supabase.from('pos_sessions').select('id, number, opened_at, opening_cash, opened_by, opener:profiles!pos_sessions_opened_by_profile_fkey(full_name, email)').eq('register_id', registerId).eq('status', 'open').maybeSingle(),
        catalogNow(),
        fetchAll('id', (a) => after(supabase.from('business_partners').select('id, name, code, tax_number, kind').eq('company_id', reg.company_id).eq('is_customer', true).is('deleted_at', null), 'id', a).order('id').limit(1000))
          .then((data) => ({ data: byName(data) })),
        supabase.from('companies').select('name, legal_name, tax_number, base_currency, address_line1, city, business_type').eq('id', reg.company_id).single(),
        supabase.rpc('pos_loyalty_data', { p_register: registerId }),
        supabase.rpc('pos_cash_limits', { p_register: registerId }),
        supabase.rpc('pos_promotions', { p_register: registerId }),
        supabase.rpc('pos_till_options', { p_register: registerId }),
        supabase.rpc('atk_till', { p_register: registerId }),
        supabase.rpc('pos_catalog_changes', { p_register: registerId, p_since: null as unknown as string }),
        supabase.rpc('pos_before_open', { p_register: registerId }),
        supabase.rpc('pos_quick_items', { p_register: registerId }),
      ])
      const clockAt = clock.error ? undefined : (clock.data as unknown as { at: string }).at
      const data: TillData = {
        register: reg as TillData['register'],
        session: ses.data ? { id: ses.data.id, number: ses.data.number, opened_at: ses.data.opened_at, opening_cash: ses.data.opening_cash, opened_by: ses.data.opened_by,
          opener: (ses.data.opener as { full_name: string | null; email: string | null } | null)?.full_name ?? (ses.data.opener as { email: string | null } | null)?.email ?? null } : null,
        shift: shift.error ? cached?.shift : (shift.data as unknown as TillShiftInfo),
        catalog: cat.items,
        customers: (cus.data ?? []) as TillData['customers'],
        company: { name: co.data?.name ?? '', legal_name: co.data?.legal_name ?? null, tax_number: co.data?.tax_number ?? null, base_currency: co.data?.base_currency ?? 'ALL', address: [co.data?.address_line1, co.data?.city].filter(Boolean).join(', ') || null,
          business_type: (co.data as { business_type?: string | null } | null)?.business_type ?? null },
        loyalty: loy.error ? cached?.loyalty : (loy.data as unknown as TillLoyalty),
        cashLimits: lim.error ? cached?.cashLimits ?? null : (lim.data as unknown as TillData['cashLimits']),
        promotions: promo.error ? cached?.promotions ?? [] : (promo.data as unknown as TillPromo[]),
        options: opt.error ? cached?.options ?? { count_notes: true } : (opt.data as unknown as TillData['options']),
        atk: atk.error ? cached?.atk : (atk.data as unknown as AtkTill),
        quick: quick.error ? cached?.quick : (quick.data as unknown as TillQuick),
        loadedAt: new Date().toISOString(),
        // a full read: the clock taken with it; only the changes: the time the server answered them
        pricesAt: cat.full ? (clockAt ? minuteBefore(clockAt) : undefined) : minuteBefore(cat.at!),
      }
      await kvSet(`till:${registerId}`, stripCatalog(data)).catch(() => undefined)
      if (cat.full) await itemsWrite(registerId, data.catalog, [], true).catch(() => undefined)
      else keepCopy(registerId, cached ?? null, data)
      setState({ data, offline: false, loading: false, error: null })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, offline: true, error: s.data ? null : describeError(e) }))
    }
  }, [registerId])
  React.useEffect(() => { void load() }, [load])
  // a till open all day: every few minutes, the prices and the stock that changed (the receipt on the screen keeps its own)
  const dataRef = React.useRef(state.data)
  dataRef.current = state.data
  React.useEffect(() => {
    if (!registerId) return
    let busy = false
    const look = async () => {
      const d = dataRef.current
      if (busy || !d?.pricesAt || !navigator.onLine) return
      busy = true
      try {
        const { data: ch, error } = await supabase.rpc('pos_catalog_changes', { p_register: registerId, p_since: d.pricesAt })
        if (error || !ch) return
        const c = ch as unknown as CatalogChanges
        if (c.full) { await load({ full: true }); return }
        const promo = c.promotions ? await supabase.rpc('pos_promotions', { p_register: registerId }) : null
        // the sales still waiting on this till are taken off what the server says is in stock
        const waiting = pendingQty(registerId)
        const items = (c.items ?? []).map(toCatalogItem).map((i) => (waiting.has(i.variant_id) ? { ...i, on_hand: i.on_hand - waiting.get(i.variant_id)! } : i))
        const now = dataRef.current
        if (!now) return
        const old = new Map(now.catalog.map((i) => [i.variant_id, i.price]))
        const prices = items.filter((i) => old.has(i.variant_id) && old.get(i.variant_id) !== i.price).length
        const catalog = withChanges(now.catalog, items, new Set(c.gone ?? []))
        const promotions = promo && !promo.error ? (promo.data as unknown as TillPromo[]) : undefined
        setState((s) => {
          if (!s.data) return s
          const next: TillData = { ...s.data, catalog: s.data.catalog === now.catalog ? catalog : withChanges(s.data.catalog, items, new Set(c.gone ?? [])),
            pricesAt: minuteBefore(c.at), promotions: promotions ?? s.data.promotions }
          keepCopy(registerId, s.data, next)
          return { ...s, data: next }
        })
        if (prices > 0) toast.info(t('New prices on {n} items', { n: prices }))
      } finally { busy = false }
    }
    lookRef.current = () => void look()
    // the server tells the till in real time when an item, a price or the stock changed (a few seconds);
    // the look every minute is only a safety net
    const timer = window.setInterval(() => void look(), 60_000)
    return () => { window.clearInterval(timer); lookRef.current = null }
  }, [registerId, load])
  const lookRef = React.useRef<(() => void) | null>(null)
  const companyId = state.data?.register.company_id
  React.useEffect(() => {
    if (!registerId || !companyId) return
    let wait: number | undefined
    // changes come in bursts (a sale moves the stock of several items): one look after the burst
    const soon = () => { window.clearTimeout(wait); wait = window.setTimeout(() => lookRef.current?.(), 1500) }
    const ch = supabase.channel(`pulse:${companyId}:${registerId}:${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_catalog_pulse', filter: `company_id=eq.${companyId}` }, soon)
      .subscribe()
    return () => { window.clearTimeout(wait); void supabase.removeChannel(ch) }
  }, [registerId, companyId])
  const patch = React.useCallback((fn: (d: TillData) => TillData) => {
    setState((s) => {
      if (!s.data) return s
      const next = fn(s.data)
      if (registerId) keepCopy(registerId, s.data, next)
      return { ...s, data: next }
    })
  }, [registerId])
  /** fetch what changed now (the server came back, the sales that waited went through) */
  const refresh = React.useCallback(() => lookRef.current?.(), [])
  return { ...state, reload: load, patch, refresh }
}

/* ------------------------------------------------------------------ the market's till: search, quick buttons, the lock */
export type TillQuick = { pinned: string[]; top: string[] }
/** the items of this till closest to what was typed or scanned, from the server (the same rules as on the device) */
export async function searchTill(registerId: string, q: string, limit = 20): Promise<CatalogItem[]> {
  const { data, error } = await supabase.rpc('pos_search', { p_register: registerId, p_q: q, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as unknown as CatalogRow[]).map(({ score: _s, ...r }) => toCatalogItem(r as CatalogRow))
}
export async function setQuickItems(registerId: string, ids: string[]): Promise<string[]> {
  return unwrap(await supabase.rpc('pos_quick_items_set', { p_register: registerId, p_items: ids })) as unknown as string[]
}
export type UnlockResult = { ok?: boolean; error?: string; no_pin?: boolean; member?: string }
export async function posUnlock(registerId: string, pin: string): Promise<UnlockResult> {
  return unwrap(await supabase.rpc('pos_unlock', { p_register: registerId, p_pin: pin })) as unknown as UnlockResult
}
export async function posMyPin(companyId: string): Promise<{ member: string; has_pin: boolean } | null> {
  return unwrap(await supabase.rpc('pos_my_pin', { p_company: companyId })) as unknown as { member: string; has_pin: boolean } | null
}
export async function setMyPin(member: string, pin: string) {
  unwrap(await supabase.rpc('member_set_pin', { p_member: member, p_pin: pin }))
}

export type ReceiptLookup = { id: string; number: string; device_ref: string | null; order_at: string; total: number; is_refund: boolean
  /** the ATK coupon of the sale (Kosovo), needed for a return */
  atk_coupon: string | null
  /** the coupon as kept, for the return coupon that shows it (Shtojca F) */
  atk?: { details?: string; daily_no?: number | null; print?: unknown } | null
  lines: { variant_id: string; description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number; tax_rate: number }[]
  refunds: { total?: number; lines: { variant_id: string; quantity: number }[] }[] }
/**
 * The sale behind what the customer brings back. Anything printed on the coupon finds it: DrisPRO's number
 * (KUP-…), the till's reference, ATK's coupon number (printed with leading zeros), the NUIKF, or the QR code
 * read by a scanner.
 */
export async function lookupReceipt(companyId: string, code: string): Promise<ReceiptLookup | null> {
  const raw = code.trim()
  const fields = 'id, number, device_ref, order_at, total, is_refund, atk_coupon:atk->>coupon_id, atk, lines:pos_order_lines(variant_id, description, quantity, unit_price, discount_pct, line_total, tax_rate)'
  const base = () => supabase.from('pos_orders').select(fields).eq('company_id', companyId).eq('status', 'paid').limit(1)
  let rows: unknown[]
  if (raw.includes('|')) rows = unwrap(await base().eq('atk->>qr', raw))
  else {
    const c = raw.replace(/[,()"\s]/g, '')
    const digits = /^\d{6,19}$/.test(c)
    const atkNo = digits ? c.replace(/^0+(?=\d)/, '') : null
    rows = unwrap(await base().or([`number.eq.${c}`, `device_ref.eq.${c}`, ...(digits ? [`atk->>coupon_id.eq.${atkNo}`, `atk->>verification_no.eq.${c}`] : [])].join(',')))
  }
  const o = rows[0] as { id: string } | undefined
  if (!o) return null
  // earlier refunds of this receipt (fetched separately: the self-reference cannot be embedded)
  const refunds = unwrap(await supabase.from('pos_orders').select('total, lines:pos_order_lines(variant_id, quantity)')
    .eq('company_id', companyId).eq('refund_of_id', o.id).eq('status', 'paid'))
  return { ...(o as unknown as Omit<ReceiptLookup, 'refunds'>), refunds: refunds as unknown as ReceiptLookup['refunds'] }
}


/* ------------------------------------------------------------------ the manager reconciles the shifts */
export type ReviewRow = { id: string; number: string; register: string; register_id: string; unit: string; unit_id: string
  opened_at: string; closed_at: string; reviewed_at: string | null; opened_by: string | null; closed_by: string | null; reviewed_by: string | null
  opened_by_id: string | null; closed_by_id: string | null
  expected: number; cashier_counted: number | null; counted: number | null; cashier_difference: number | null; difference: number | null
  review_status: 'pending' | 'returned' | 'reconciled'; sales: number | null; receipts: number | null; hours_waiting: number; last_note: string | null
  /** paid out of the drawer during the shift: to suppliers, and for expenses */
  supplier_paid: number; expenses: number }
export function useReviewList(status: 'open' | 'pending' | 'returned' | 'reconciled' | 'all') {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'review', status], enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('pos_review_list', { p_company: companyId!, p: { status } as never })) as unknown as ReviewRow[],
  })
}
export const useReconcile = () => useAction(async (a: { session: string; counted?: number | null; note?: string | null; notesCoins?: Record<string, number> | null }) =>
  unwrap(await supabase.rpc('pos_reconcile', { p_session: a.session, p: { counted: a.counted ?? null, note: a.note ?? null, notes_coins: a.notesCoins ?? null } as never })))
export const useReviewReturn = () => useAction(async (a: { session: string; note: string }) =>
  unwrap(await supabase.rpc('pos_review_return', { p_session: a.session, p_note: a.note })))
export const useRecount = () => useAction(async (a: { session: string; counted: number; note?: string | null; notesCoins?: Record<string, number> | null }) =>
  unwrap(await supabase.rpc('pos_recount', { p_session: a.session, p: { counted: a.counted, note: a.note ?? null, notes_coins: a.notesCoins ?? null } as never })))
export function useSessionReviews(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'reviews', id], enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('pos_session_reviews').select('id, action, counted, expected, difference, note, at, by:profiles!pos_session_reviews_by_user_fkey(full_name, email)')
      .eq('session_id', id!).order('at')) as unknown as { id: string; action: string; counted: number | null; expected: number | null; difference: number | null; note: string | null; at: string; by: { full_name: string | null; email: string | null } | null }[],
  })
}

/* ------------------------------------------------------------------ one shift, as the manager checks it */
export type ShiftCount = { kind: 'close' | 'recounted' | 'reconciled' | 'returned'; at: string; counted: number | null; notes_coins: Record<string, number> | null
  by: string | null; witness?: string | null; note: string | null; difference: number | null }
export type ReviewDetail = {
  id: string; number: string; status: string; review_status: 'pending' | 'returned' | 'reconciled' | null; currency: string
  register: string; register_id: string; unit: string | null; opened_at: string; closed_at: string | null; reviewed_at: string | null
  opened_by: string | null; closed_by: string | null; reviewed_by: string | null; sees_expected: boolean
  opening_cash: number; cashier_counted: number | null; counted: number | null; expected_cash: number | null; difference: number | null; cashier_difference: number | null; tolerance: number
  cash: { opening: number; sales: number; refunds: number; change: number; cash_in: number; cash_out: number
    movements: { type: 'cash_in' | 'cash_out'; kind: string | null; amount: number; reason: string | null; at: string }[] } | null
  payments: Record<string, number> | null
  sales: { orders: number; refunds: number; gross?: number; refunded?: number; discounts?: number; change?: number; offline?: number; average?: number | null; first_at?: string | null; last_at?: string | null }
  voids: { n: number; amount: number; unconfirmed: number }; moved_in: number; z: { id: string; number: string } | null
  counts: ShiftCount[]
}
export function useReviewDetail(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId!), 'review-detail', id], enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('pos_review_detail', { p_session: id! })) as unknown as ReviewDetail,
  })
}
export const useReconcileMany = () => useAction(async (ids: string[]) =>
  unwrap(await supabase.rpc('pos_reconcile_many', { p_sessions: ids })) as unknown as { reconciled: number; left: { id: string; number: string; reason: string }[] })
/** the company's tolerance for a drawer that is off, and whether it counts by note */
export function useCashRules() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...posKeys.all(companyId), 'cash-rules'], enabled: !!companyId, staleTime: 300_000,
    queryFn: async () => {
      const r = unwrap(await supabase.from('company_settings').select('pos_cash_tolerance, pos_count_notes, pos_blind_count').eq('company_id', companyId!).maybeSingle())
      return { tolerance: num(r?.pos_cash_tolerance), byNotes: r?.pos_count_notes ?? true, blind: (r as { pos_blind_count?: boolean } | null)?.pos_blind_count ?? true }
    },
  })
}

/** the shift so far, without closing it (the X-report); without the expected cash for a cashier who counts blind */
export async function xReport(session: string) {
  return unwrap(await supabase.rpc('pos_x_report', { p_session: session })) as unknown as {
    number: string; session: string; opened_at: string; at: string; order_count: number; refund_count: number; gross_sales: number; refunds_total: number
    discounts_total: number; net_sales: number; tax_total: number; payments_by_method: Record<string, number>; tax_breakdown: { rate: number; base: number; tax: number }[]
    opening_cash: number; cash_in: number; cash_out: number; expected_cash: number | null; items: { name: string; quantity: number; total: number }[] }
}

/* ------------------------------------------------------------------ the restaurant: waiters hand over their takings */
export type WaiterOwes = { waiter_id: string; name: string; receipts: number; cash: number; card: number; other: number; handed: number; handed_owed: number; owed: number; open_tables: number; me: boolean }
export type WaiterHandover = { id: string; at: string; waiter: string; waiter_id: string; owed: number; counted: number; difference: number; card: number; receipts: number; note: string | null
  notes_coins: Record<string, number> | null; received_by: string | null }
export type WaitersData = { required: boolean; holder: string | null; waiters: WaiterOwes[]; handovers: WaiterHandover[] }
export function usePosWaiters(session: string | undefined, poll = false) {
  return useQuery({
    queryKey: ['pos', 'waiters', session], enabled: !!session, refetchInterval: poll ? 60_000 : false,
    queryFn: async () => unwrap(await supabase.rpc('pos_waiters', { p_session: session! })) as unknown as WaitersData,
  })
}
export async function waiterHandover(a: { session: string; waiter: string; counted: number; note?: string | null; notesCoins?: Record<string, number> | null }) {
  return unwrap(await supabase.rpc('pos_waiter_handover', { p_session: a.session, p: { waiter: a.waiter, counted: a.counted, note: a.note ?? null, notes_coins: a.notesCoins ?? null } as never })) as unknown as
    { id: string; owed: number; counted: number; difference: number }
}
