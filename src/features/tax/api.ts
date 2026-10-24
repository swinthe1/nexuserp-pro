import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatMonth } from '@/lib/utils'
import { getLocale, t, tn } from '@/i18n'

export const taxKeys = { all: (c: string) => ['tax', c] as const }

function useInvalidate() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: taxKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['fin', companyId] }),
  ]), [qc, companyId])
}
function useAction<A, R>(fn: (a: A) => Promise<R>, success?: (r: R, a: A) => string | void) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, a) => { void invalidate(); const m = success?.(r, a); if (m) toast.success(m) },
    onError: (e) => toast.error(describeError(e)),
  })
}

/* ------------------------------------------------------------------ dates */
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
}
export function previousMonth() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return formatMonth(new Date(y, m - 1, 1))
}

/* ------------------------------------------------------------------ layout */
export interface LayoutCol { key: string; label: string; sq: string; vat?: boolean }
/** Layout labels come from the database in both languages: Albanian `sq`, English `label`. */
export const layoutLabel = (x: { label?: string; sq?: string }) => (getLocale() === 'sq' ? x.sq || x.label : x.label || x.sq) ?? ''
export interface FormLine { section?: string; code?: string; base?: string; vat?: string; label?: string; sq?: string; total?: boolean }
export interface VatLayout {
  sales_title: string; purchase_title: string; form_title: string; numbered: boolean
  sales_cols: LayoutCol[]; purchase_cols: LayoutCol[]; form: FormLine[]
}
export function useVatLayout() {
  const { company } = useCompany()
  const country = company?.country_code ?? 'AL'
  return useQuery({
    queryKey: ['tax-layout', country],
    staleTime: Infinity,
    queryFn: async () => unwrap(await supabase.rpc('vat_layout', { p_country: country })) as unknown as VatLayout,
  })
}

/* ------------------------------------------------------------------ books */
export interface BookRow {
  line_no: number; doc_date: string; number: string; ref: string | null; fiscal_code: string | null; partner: string | null
  tax_number: string | null; doc_type: string; total: number; cols: Record<string, number>; href: string | null
}
export function useVatBook(book: 'sales' | 'purchase', from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'book', book, from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('vat_book', { p_company: companyId, p_from: from, p_to: to, p_book: book })) as unknown as BookRow[],
  })
}

/* ------------------------------------------------------------------ return preview */
export interface VatPreview {
  country: string; period_start: string; period_end: string; boxes: Record<string, number>
  output_vat: number; input_vat: number; credit_brought_forward: number; payable: number; credit: number
  refund_requested: number; carry_forward: number; sales_taxable_base: number; sales_exempt_base: number; purchase_taxable_base: number
  previous: { number: string; period_end: string; carry_forward: number } | null
  ledger: { output_vat: number; input_vat: number; output_difference: number; input_difference: number; open_pos_vat?: number; credit_notes_moved?: number }
  counts: { sales: number; purchases: number; pos_days: number }
}
export function useVatPreview(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'preview', from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('vat_return_preview', { p_company: companyId, p_from: from, p_to: to })) as unknown as VatPreview,
  })
}

export type CalendarRow = { obligation: string; period_start: string; period_end: string; due_date: string; status: string; document_id: string | null; document_number: string | null; amount: number | null }
export function useTaxCalendar(months = 6) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'calendar', months],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('tax_calendar', { p_company: companyId, p_months: months })) as unknown as CalendarRow[],
  })
}

/* ------------------------------------------------------------------ declarations */
export type Declaration = Omit<Tables<'vat_declarations'>, 'details'> & { details: VatPreview | Record<string, never> }
export function useDeclarations() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'declarations'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('vat_declarations').select('*').eq('company_id', companyId).is('deleted_at', null)
      .order('period_start', { ascending: false })) as unknown as Declaration[],
  })
}
export function useDeclaration(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'declaration', id],
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('vat_declarations').select('*').eq('id', id!).single()) as unknown as Declaration,
  })
}
export const useCreateDeclaration = () => {
  const { companyId } = useCompany()
  return useAction(async ({ year, month }: { year: number; month: number }) =>
    unwrap(await supabase.rpc('create_vat_declaration', { p_company: companyId, p_year: year, p_month: month })) as string)
}
export const useRefreshDeclaration = () => useAction(async ({ id, refund }: { id: string; refund?: number }) =>
  unwrap(await supabase.rpc('refresh_vat_declaration', { p_id: id, ...(refund !== undefined ? { p_refund: refund } : {}) })), () => t('Recalculated from the books'))
export const useSubmitDeclaration = () => useAction(async ({ id, reference }: { id: string; reference?: string }) =>
  unwrap(await supabase.rpc('submit_vat_declaration', { p_id: id, ...(reference ? { p_reference: reference } : {}) })), () => t('Declaration submitted and booked'))
export const useDecideDeclaration = () => useAction(async ({ id, accepted, note }: { id: string; accepted: boolean; note?: string }) =>
  unwrap(await supabase.rpc('decide_vat_declaration', { p_id: id, p_accepted: accepted, ...(note ? { p_note: note } : {}) })),
  (_r, a) => a.accepted ? t('Marked as accepted') : t('Marked as rejected; the booking was reversed'))
export const useReopenDeclaration = () => useAction(async (id: string) =>
  unwrap(await supabase.rpc('reopen_vat_declaration', { p_id: id })), () => t('Back to draft'))

/* ------------------------------------------------------------------ fiscalization */
export type FiscalOverview = { enabled: boolean; environment: 'test' | 'production' | null; pending: number; failed: number; fiscalized_today: number; subsequent: number }
export function useFiscalOverview() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'fiscal-overview'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('fiscal_overview', { p_company: companyId })) as unknown as FiscalOverview,
  })
}
export type FiscalRecord = Tables<'fiscalization_records'> & { doc_number: string | null; href: string | null }
export function useFiscalRecords() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'fiscal-records'],
    enabled: !!companyId,
    queryFn: async () => {
      const recs = unwrap(await supabase.from('fiscalization_records').select('*').eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(1000))
      const inv = recs.filter((r) => r.source_doc_type !== 'pos_order').map((r) => r.source_doc_id)
      const pos = recs.filter((r) => r.source_doc_type === 'pos_order').map((r) => r.source_doc_id)
      const [a, b] = await Promise.all([
        inv.length ? supabase.from('sales_invoices').select('id, number').in('id', inv) : Promise.resolve({ data: [] as { id: string; number: string }[], error: null }),
        pos.length ? supabase.from('pos_orders').select('id, number, session_id').in('id', pos) : Promise.resolve({ data: [] as { id: string; number: string; session_id: string }[], error: null }),
      ])
      const invMap = new Map((a.data ?? []).map((x) => [x.id, x.number]))
      const posMap = new Map((b.data ?? []).map((x) => [x.id, x]))
      return recs.map((r): FiscalRecord => {
        if (r.source_doc_type === 'pos_order') {
          const p = posMap.get(r.source_doc_id)
          return { ...r, doc_number: p?.number ?? null, href: p ? `/pos/sessions/${p.session_id}` : null }
        }
        return { ...r, doc_number: invMap.get(r.source_doc_id) ?? null, href: `/sales/invoices/${r.source_doc_id}` }
      })
    },
  })
}
export const useProcessQueue = () => {
  const { companyId } = useCompany()
  return useAction(async () => unwrap(await supabase.rpc('process_fiscal_queue', { p_company: companyId })) as unknown as { fiscalized: number; failed: number },
    (r) => r.failed ? t('{ok} fiscalized, {failed} failed', { ok: r.fiscalized, failed: r.failed }) : tn(r.fiscalized, '{n} document fiscalized', '{n} documents fiscalized'))
}

/* ------------------------------------------------------------------ tax codes */
export type TaxCode = Tables<'tax_codes'>
export function useTaxCodes() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'codes'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('tax_codes').select('*').eq('company_id', companyId).is('deleted_at', null).order('rate', { ascending: false }).order('code')),
  })
}
export function useTaxAccounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'tax-accounts'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('accounts').select('id, code, name').eq('company_id', companyId).eq('account_subtype', 'tax')
      .eq('is_postable', true).is('deleted_at', null).order('code')),
  })
}
export const useSaveTaxCode = () => {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('tax_codes').update(v as never).eq('id', id))
    : unwrap(await supabase.from('tax_codes').insert({ ...v, company_id: companyId } as never)), () => t('Tax code saved'))
}

export function useCompanyTaxProfile() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...taxKeys.all(companyId), 'profile'],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('companies').select('name, legal_name, tax_number, vat_number, country_code, base_currency').eq('id', companyId).single()),
  })
}
