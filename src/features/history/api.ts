import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type HistoryKind = 'sale' | 'pos_sale' | 'sale_return' | 'purchase' | 'purchase_return' | 'transfer' | 'count' | 'other'
export interface HistoryDoc {
  id: string; kind: HistoryKind; doc_type: string | null; number: string | null; doc_date: string; partner_name: string | null; partner_code: string | null
  partner_id: string | null; warehouse_code: string | null; total: number; tax: number | null; paid: number | null; cashier: string | null
}
export interface HistoryDocDetail extends HistoryDoc {
  net: number | null; discount: number | null; fiscal_code: string | null; description: string | null
  lines: { id: string; line_no: number; sku: string | null; name: string | null; variant_id: string | null; quantity: number; unit_price: number | null; discount_pct: number | null; total: number | null; tax_rate: number | null }[]
}
export interface HistoryPayment { id: string; kind: 'cash' | 'bank' | 'payment'; number: string | null; pay_date: string; partner_name: string | null; partner_code: string | null; amount: number; book: string | null; document: string | null; description: string | null }
export interface PageParams { kind?: string[]; from?: string; to?: string; partner_id?: string; q?: string; offset: number; limit: number; sort?: 'date' | 'total'; desc?: boolean }

const key = (c: string) => ['history', c] as const

export function useHistoryDocuments(p: PageParams) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'docs', p],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await supabase.rpc('history_documents_page', { p_company: companyId, p: p as never })) as unknown as { total_count: number; total_amount: number; rows: HistoryDoc[] },
  })
}
export function useHistoryDocument(id: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'doc', id],
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.rpc('history_document', { p_id: id! })) as unknown as HistoryDocDetail,
  })
}
export function useHistoryPayments(p: PageParams) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'payments', p],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await supabase.rpc('history_payments_page', { p_company: companyId, p: p as never })) as unknown as { total_count: number; money_in: number; money_out: number; rows: HistoryPayment[] },
  })
}
export interface HistorySummary {
  documents: number; first_date: string | null; last_date: string | null; payments: number; accounts_months: number
  by_month: { month: string; sales: number | null; purchases: number | null; receipts: number }[]
  by_store: { store: string; sales: number | null; receipts: number }[]
  top_products: { name: string; sku: string | null; quantity: number; amount: number }[]
}
export function useHistorySummary(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'summary', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('history_summary', { p_company: companyId, p_from: from, p_to: to })) as unknown as HistorySummary,
  })
}
export interface BalanceRow { code: string; name: string | null; type: string | null; months: Record<string, [number, number]>; debit: number; credit: number; opening: number }
export function useHistoryBalances(year: number, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'balances', year],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('history_balances', { p_company: companyId, p_year: year })) as unknown as { years: number[]; accounts: BalanceRow[] },
  })
}

export interface HistoryLive {
  has_history: boolean; last_date?: string | null; today?: number; today_receipts?: number; month?: number; month_net?: number; month_receipts?: number
  month_cost?: number | null; month_purchases?: number; month_from_exits?: number
  by_store?: { store: string; warehouse_id: string | null; today: number | null; today_receipts: number; month: number | null; from_exits?: boolean }[]
}
/** Today's and this month's sales from the old program; the live link keeps them current. */
export function useHistoryLive(enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...key(companyId), 'live'],
    enabled: !!companyId && enabled,
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('history_live', { p_company: companyId })) as unknown as HistoryLive,
  })
}
