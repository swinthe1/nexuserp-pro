import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { fetchPages, supabase } from '@/lib/supabase'
import { msg, t, tEnum } from '@/i18n'

export const finKeys = {
  all: (c: string) => ['fin', c] as const,
  list: (c: string, what: string) => ['fin', c, 'list', what] as const,
  doc: (c: string, kind: string, id: string) => ['fin', c, 'doc', kind, id] as const,
}

function useInvalidateFinance() {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: finKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['sales', companyId] }),
    qc.invalidateQueries({ queryKey: ['proc', companyId] }),
  ])
}
function useAction<A, R>(fn: (a: A) => Promise<R>) {
  const invalidate = useInvalidateFinance()
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => toast.error(describeError(e)) })
}

/* ---------------------------------------------------------------- accounts */
export type Account = Tables<'accounts'>
export function useAccounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'accounts'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.from('accounts').select('*').eq('company_id', companyId).is('deleted_at', null).order('code')),
  })
}
export function useSaveAccount() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
      ? unwrap(await supabase.from('accounts').update(v as never).eq('id', id))
      : unwrap(await supabase.from('accounts').insert({ ...v, company_id: companyId } as never)),
    onSuccess: () => void invalidate(),
  })
}

export type BalanceRow = { account_id: string; code: string; name: string; account_type: string; account_subtype: string; parent_id: string | null
  is_postable: boolean; cash_flow_category: string | null; opening: number; debit: number; credit: number; closing: number }
export function useAccountBalances(from: string, to: string, costCenter?: string | null, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.all(companyId), 'balances', from, to, costCenter ?? ''],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('account_balances', { p_company: companyId, p_from: from, p_to: to, p_cost_center: costCenter ?? undefined })) as BalanceRow[],
  })
}
/** the statutory ledger (what the law and ATK see), or the management one: statutory plus internal adjustments */
export type Ledger = 'statutory' | 'management'
export async function fetchBalances(companyId: string, from: string, to: string, costCenter?: string | null, ledger: Ledger = 'statutory') {
  return unwrap(await supabase.rpc('account_balances', { p_company: companyId, p_from: from, p_to: to, p_cost_center: costCenter ?? undefined, p_ledger: ledger.toUpperCase() })) as BalanceRow[]
}

export function useAccountDefaults() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'defaults'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_account_defaults').select('id, key, account_id').eq('company_id', companyId)),
  })
}
export function useSaveAccountDefault() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ key, accountId }: { key: string; accountId: string }) =>
      unwrap(await supabase.from('company_account_defaults').upsert({ company_id: companyId, key, account_id: accountId } as never, { onConflict: 'company_id,key' })),
    onSuccess: () => { toast.success(t('Posting account saved')); void invalidate() },
    onError: (e) => toast.error(describeError(e)),
  })
}

export function useJournals() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'journals'),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('journals').select('id, code, name, journal_type').eq('company_id', companyId).is('deleted_at', null).order('code')),
  })
}
export function useCostCenters() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'cost-centers'),
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.from('cost_centers').select('id, code, name, parent_id, is_active, manager_id').eq('company_id', companyId).is('deleted_at', null).order('code')),
  })
}
export function useSaveCostCenter() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
      ? unwrap(await supabase.from('cost_centers').update(v as never).eq('id', id))
      : unwrap(await supabase.from('cost_centers').insert({ ...v, company_id: companyId } as never)),
    onSuccess: () => void invalidate(),
  })
}

/* ----------------------------------------------------------- journal entries */
export type JournalLineRow = Tables<'journal_lines'> & {
  account: { code: string; name: string; account_type: string } | null
  partner: { name: string } | null
  cost_center: { code: string } | null
}
export type JournalEntryRow = Tables<'journal_entries'> & {
  journal: { code: string; name: string } | null
  lines: JournalLineRow[]
  poster?: { full_name: string | null } | null
}
const JE_SELECT = '*, journal:journals(code, name), poster:profiles!journal_entries_posted_by_profile_fkey(full_name), lines:journal_lines(*, account:accounts(code, name, account_type), partner:business_partners(name), cost_center:cost_centers(code))'

export function useJournalEntries(from: string, to: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.list(companyId, 'entries'), from, to],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('journal_entries')
      .select('*, journal:journals(code, name)')
      .eq('company_id', companyId).is('deleted_at', null).gte('entry_date', from).lte('entry_date', to)
      .order('entry_date', { ascending: false }).order('number', { ascending: false }).order('id').limit(2000)),
  })
}
export function useJournalEntry(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.doc(companyId, 'je', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('journal_entries').select(JE_SELECT).eq('id', id!).single().returns<JournalEntryRow>()),
  })
}
/** Every journal entry produced by one source document (the document's own entry + its stock postings) */
export function useEntriesForSource(sourceType: string | string[] | undefined, sourceId: string | undefined) {
  const { companyId, can } = useCompany()
  const types = Array.isArray(sourceType) ? sourceType : sourceType ? [sourceType] : []
  return useQuery({
    queryKey: finKeys.doc(companyId, 'source-je', `${types.join(',')}:${sourceId ?? ''}`),
    enabled: !!companyId && !!sourceId && types.length > 0 && can('finance.read'),
    queryFn: async () => unwrap(await supabase.from('journal_entries').select(JE_SELECT)
      .eq('company_id', companyId).in('source_doc_type', types).eq('source_doc_id', sourceId!).is('deleted_at', null)
      .order('created_at').returns<JournalEntryRow[]>()),
  })
}
export function useSaveJournalEntry() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ header, lines }: { header: Record<string, unknown>; lines: Record<string, unknown>[] }) =>
      unwrap(await supabase.rpc('save_document', {
        p_table: 'journal_entries', p_header: { ...header, company_id: companyId } as unknown as Json, p_children: { journal_lines: lines } as unknown as Json,
      })) as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
export const usePostJournalEntry = () => useAction(async (id: string) => unwrap(await supabase.from('journal_entries').update({ status: 'posted' }).eq('id', id)))
export const useReverseJournalEntry = () => useAction(async (a: { id: string; date?: string; memo?: string }) =>
  unwrap(await supabase.rpc('reverse_journal_entry', { p_id: a.id, p_date: a.date, p_memo: a.memo })) as string)
export const useDeleteJournalEntry = () => useAction(async (id: string) => unwrap(await supabase.from('journal_entries').delete().eq('id', id)))

export type LedgerLine = { id: string; debit: number; credit: number; description: string | null; entry_id: string
  entry: { number: string; entry_date: string; memo: string | null; reference: string | null; source_doc_type: string | null; source_doc_id: string | null; status: string; reporting_ledger?: string }
  partner: { name: string } | null }
export function useAccountLedger(accountId: string | undefined, from: string, to: string, ledger: Ledger = 'statutory') {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.doc(companyId, 'ledger', accountId ?? ''), from, to, ledger],
    enabled: !!companyId && !!accountId,
    queryFn: async () => {
      let q = supabase.from('journal_lines')
        .select('id, debit, credit, description, entry_id, entry:journal_entries!inner(number, entry_date, memo, reference, source_doc_type, source_doc_id, status, reporting_ledger), partner:business_partners(name)')
        .eq('account_id', accountId!).in('entry.status', ['posted', 'reversed']).gte('entry.entry_date', from).lte('entry.entry_date', to)
      if (ledger === 'statutory') q = q.eq('entry.reporting_ledger', 'STATUTORY')
      const [lines, opening] = await Promise.all([
        q.limit(5000).returns<LedgerLine[]>(),
        supabase.rpc('account_balances', { p_company: companyId, p_from: from, p_to: to, p_ledger: ledger.toUpperCase() }),
      ])
      const rows = unwrap(lines).sort((a, b) => a.entry.entry_date.localeCompare(b.entry.entry_date) || a.entry.number.localeCompare(b.entry.number))
      const bal = (unwrap(opening) as BalanceRow[]).find((r) => r.account_id === accountId)
      return { rows, opening: Number(bal?.opening ?? 0), closing: Number(bal?.closing ?? 0) }
    },
  })
}

/* ------------------------------------------------------------------ payments */
export type PaymentRow = Tables<'payments'> & { partner: { name: string } | null; bank: { name: string } | null }
export function usePayments() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'payments'),
    enabled: !!companyId,
    queryFn: () => fetchPages((from, to) => supabase.from('payments').select('*, partner:business_partners(name), bank:bank_accounts(name)')
      .eq('company_id', companyId!).is('deleted_at', null).order('payment_date', { ascending: false }).order('number', { ascending: false }).order('id').range(from, to)
      .returns<PaymentRow[]>()),
  })
}
export type PaymentDetail = Tables<'payments'> & {
  partner: { id: string; name: string } | null
  allocations: (Tables<'payment_allocations'> & { invoice: { number: string; invoice_date: string; total: number } | null; bill: { number: string; vendor_invoice_number: string; bill_date: string; total: number } | null })[]
}
export function usePayment(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.doc(companyId, 'payment', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('payments')
      .select('*, partner:business_partners(id, name), allocations:payment_allocations(*, invoice:sales_invoices(number, invoice_date, total), bill:vendor_bills(number, vendor_invoice_number, bill_date, total))')
      .eq('id', id!).single().returns<PaymentDetail>()),
  })
}
export type OpenDocument = { id: string; number: string; ref: string | null; date: string; due_date: string; currency_code: string; total: number; open: number }
export function useOpenDocuments(kind: 'customer_payment' | 'vendor_payment', partnerId: string | null | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.list(companyId, 'open-docs'), kind, partnerId ?? ''],
    enabled: !!companyId && !!partnerId,
    queryFn: async (): Promise<OpenDocument[]> => {
      if (kind === 'customer_payment') {
        const rows = unwrap(await supabase.from('sales_invoices').select('id, number, invoice_date, due_date, currency_code, total, amount_paid, amount_due')
          .eq('partner_id', partnerId!).eq('status', 'posted').eq('document_type', 'sales_invoice').neq('payment_status', 'paid').is('deleted_at', null).order('due_date'))
        return rows.map((r) => ({ id: r.id, number: r.number, ref: null, date: r.invoice_date, due_date: r.due_date, currency_code: r.currency_code, total: r.total, open: Number(r.amount_due) }))
      }
      const rows = unwrap(await supabase.from('vendor_bills').select('id, number, vendor_invoice_number, bill_date, due_date, currency_code, total, amount_due')
        .eq('vendor_id', partnerId!).eq('status', 'posted').eq('document_type', 'vendor_bill').neq('payment_status', 'paid').is('deleted_at', null).order('due_date'))
      return rows.map((r) => ({ id: r.id, number: r.number, ref: r.vendor_invoice_number, date: r.bill_date, due_date: r.due_date, currency_code: r.currency_code, total: r.total, open: Number(r.amount_due) }))
    },
  })
}
export function useSavePayment() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ header, allocations }: { header: Record<string, unknown>; allocations: Record<string, unknown>[] }) =>
      unwrap(await supabase.rpc('save_document', {
        p_table: 'payments', p_header: { ...header, company_id: companyId } as unknown as Json, p_children: { payment_allocations: allocations } as unknown as Json,
      })) as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
export const usePostPayment = () => useAction(async (id: string) => unwrap(await supabase.rpc('post_payment', { p_id: id })) as string)
export const useReversePayment = () => useAction(async (a: { id: string; reason: string }) => unwrap(await supabase.rpc('reverse_payment', { p_id: a.id, p_reason: a.reason })))
export const useDeletePayment = () => useAction(async (id: string) => unwrap(await supabase.from('payments').delete().eq('id', id)))

export function useBankAccounts() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'bank-accounts'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('bank_accounts').select('*, account:accounts(code, name)').eq('company_id', companyId).is('deleted_at', null).order('name')
      .returns<(Tables<'bank_accounts'> & { account: { code: string; name: string } | null })[]>()),
  })
}
export function useSaveBankAccount() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
      ? unwrap(await supabase.from('bank_accounts').update(v as never).eq('id', id))
      : unwrap(await supabase.from('bank_accounts').insert({ ...v, company_id: companyId } as never)),
    onSuccess: () => void invalidate(),
  })
}

/* --------------------------------------------------------------------- aging */
export type AgingRow = { partner_id: string; partner_name: string; not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number
  unapplied: number; total: number; oldest_due: string | null; documents: number }
export function useAging(kind: 'ar' | 'ap', asOf: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.all(companyId), 'aging', kind, asOf],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('partner_aging', { p_company: companyId, p_kind: kind, p_as_of: asOf })) as AgingRow[],
  })
}

/* ---------------------------------------------------------- bank statements */
export type StatementRow = Tables<'bank_statements'> & { bank: { name: string } | null; lines: { count: number }[] }
export function useStatements() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'statements'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('bank_statements').select('*, bank:bank_accounts(name), lines:bank_statement_lines(count)')
      .eq('company_id', companyId).is('deleted_at', null).order('statement_date', { ascending: false }).returns<StatementRow[]>()),
  })
}
export type StatementLine = Tables<'bank_statement_lines'> & {
  payment: { number: string; document_type: string; partner: { name: string } | null } | null
  partner: { name: string } | null
}
export function useStatement(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.doc(companyId, 'statement', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => {
      const s = unwrap(await supabase.from('bank_statements').select('*, bank:bank_accounts(id, name, account_id, currency_code)').eq('id', id!).single()
        .returns<Tables<'bank_statements'> & { bank: { id: string; name: string; account_id: string; currency_code: string } | null }>())
      const lines = unwrap(await supabase.from('bank_statement_lines')
        .select('*, payment:payments!bank_statement_lines_company_id_matched_payment_id_fkey(number, document_type, partner:business_partners(name)), partner:business_partners(name)')
        .eq('statement_id', id!).order('transaction_date').order('created_at').returns<StatementLine[]>())
      return { ...s, lines }
    },
  })
}
export function useCreateStatement() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ header, lines }: { header: Record<string, unknown>; lines: Record<string, unknown>[] }) => {
      const s = unwrap(await supabase.from('bank_statements').insert({ ...header, company_id: companyId } as never).select('id').single())
      if (lines.length) unwrap(await supabase.from('bank_statement_lines').insert(lines.map((l) => ({ ...l, company_id: companyId, statement_id: s.id })) as never))
      return s.id as string
    },
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
/** recorded payments first, then the invoices and bills the money pays (sure ones are settled, likely ones suggested) */
export async function matchAll(id: string) {
  const matched = unwrap(await supabase.rpc('auto_match_statement', { p_statement: id })) as number
  const r = unwrap(await supabase.rpc('settle_statement', { p_statement: id })) as unknown as { settled: number; suggested: number; failed: number }
  return { matched, settled: r.settled, suggested: r.suggested + r.failed }
}
export const useAutoMatch = () => useAction(matchAll)
export const useAcceptSuggestion = () => useAction(async (line: string) => unwrap(await supabase.rpc('accept_statement_suggestion', { p_line: line })))
export const useAcceptAllSuggestions = () => useAction(async (statement: string) => unwrap(await supabase.rpc('accept_all_statement_suggestions', { p_statement: statement })) as unknown as { accepted: number; failed: number })
export const useDismissSuggestion = () => useAction(async (line: string) => unwrap(await supabase.rpc('dismiss_statement_suggestion', { p_line: line })))
export const useBookStatementLine = () => useAction(async (a: { line: string; account: string; memo?: string; partner?: string | null }) =>
  unwrap(await supabase.rpc('book_statement_line', { p_line: a.line, p_account: a.account, p_memo: a.memo, p_partner: a.partner ?? undefined })))
export const useReconcileStatement = () => useAction(async (id: string) => unwrap(await supabase.rpc('reconcile_statement', { p_statement: id })))
export const useUpdateStatementLine = () => useAction(async ({ id, ...v }: Record<string, unknown> & { id: string }) =>
  unwrap(await supabase.from('bank_statement_lines').update(v as never).eq('id', id)))
export function useMatchCandidates(bankAccountId: string | undefined, amount: number | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.all(companyId), 'match-candidates', bankAccountId ?? '', amount ?? 0],
    enabled: !!companyId && !!bankAccountId && amount !== undefined,
    queryFn: async () => {
      const pays = unwrap(await supabase.from('payments').select('id, number, document_type, amount, amount_base, currency_code, payment_date, reference, partner:business_partners(name)')
        .eq('bank_account_id', bankAccountId!).eq('status', 'posted').order('payment_date', { ascending: false }).limit(200))
      // a payment already matched to a statement line is not offered again
      const ids = pays.map((p) => p.id)
      const taken = ids.length ? unwrap(await supabase.from('bank_statement_lines').select('matched_payment_id').in('matched_payment_id', ids)) : []
      const used = new Set(taken.map((x) => x.matched_payment_id))
      return pays.filter((p) => !used.has(p.id))
    },
  })
}

/* -------------------------------------------------------------- fixed assets */
export type AssetRow = Tables<'fixed_assets'> & { category: { name: string } | null; cost_center: { code: string; name: string } | null }
export function useAssets() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'assets'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('fixed_assets').select('*, category:fixed_asset_categories(name), cost_center:cost_centers(code, name)')
      .eq('company_id', companyId).is('deleted_at', null).order('number', { ascending: false }).returns<AssetRow[]>()),
  })
}
export function useAsset(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.doc(companyId, 'asset', id ?? ''),
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('fixed_assets').select('*, category:fixed_asset_categories(*), schedule:asset_depreciation_lines(*)').eq('id', id!).single()
      .returns<Tables<'fixed_assets'> & { category: Tables<'fixed_asset_categories'> | null; schedule: Tables<'asset_depreciation_lines'>[] }>()),
  })
}
export function useAssetCategories() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'asset-categories'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('fixed_asset_categories').select('*').eq('company_id', companyId).is('deleted_at', null).order('name')),
  })
}
export function useSaveAsset() {
  const { companyId } = useCompany()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
      ? unwrap(await supabase.from('fixed_assets').update(v as never).eq('id', id).select('id').single()).id as string
      : unwrap(await supabase.from('fixed_assets').insert({ ...v, company_id: companyId } as never).select('id').single()).id as string,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(describeError(e)),
  })
}
export const useActivateAsset = () => useAction(async (a: { id: string; counter?: string | null }) =>
  unwrap(await supabase.rpc('activate_fixed_asset', { p_id: a.id, p_counter_account: a.counter ?? undefined })))
export const useRunDepreciation = () => {
  const { companyId } = useCompany()
  return useAction(async (through: string) => unwrap(await supabase.rpc('run_depreciation', { p_company: companyId, p_through: through })) as unknown as
    { lines: number; amount: number; months: number })
}
/** depreciation recorded by itself on the first days of every month */
export function useDepreciationAuto() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const key = ['finance', companyId, 'depreciation-auto']
  const q = useQuery({ queryKey: key, enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.from('company_settings').select('depreciation_auto').eq('company_id', companyId).maybeSingle()))?.depreciation_auto ?? false })
  const set = useMutation({
    mutationFn: async (on: boolean) => unwrap(await supabase.rpc('set_depreciation_auto', { p_company: companyId, p_on: on })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(describeError(e)),
  })
  return { on: q.data ?? false, loading: q.isLoading, set }
}
export const useDisposeAsset = () => useAction(async (a: { id: string; date: string; proceeds: number; account?: string | null }) =>
  unwrap(await supabase.rpc('dispose_fixed_asset', { p_id: a.id, p_date: a.date, p_proceeds: a.proceeds, p_proceeds_account: a.account ?? undefined })) as unknown as
  { book_value: number; gain: number })

/* -------------------------------------------------------- periods, overview */
export function useFiscalYears() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'fiscal-years'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('fiscal_years').select('*, periods:fiscal_periods(*)').eq('company_id', companyId).is('deleted_at', null)
      .order('start_date', { ascending: false }).returns<(Tables<'fiscal_years'> & { periods: Tables<'fiscal_periods'>[] })[]>()),
  })
}
export const useSetPeriodStatus = () => useAction(async (a: { id: string; status: 'open' | 'closed' | 'locked' }) =>
  unwrap(await supabase.rpc('set_period_status', { p_period: a.id, p_status: a.status })))
export const useCreateFiscalYear = () => {
  const { companyId } = useCompany()
  return useAction(async (year: number) => unwrap(await supabase.rpc('create_fiscal_year', { p_company: companyId, p_year: year })))
}

export interface FinanceOverview {
  revenue: number; other_income: number; cogs: number; expenses: number; net_profit: number; cash: number; receivables: number
  payables: number; inventory: number; vat_due: number; ar_overdue: number; ap_overdue: number; unmatched_bank_lines: number; draft_entries: number
  cash_by_month: { month: string; cash: number; profit: number }[]
}
export function useFinanceOverview(from: string, to: string, enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.all(companyId), 'overview', from, to],
    enabled: !!companyId && enabled,
    queryFn: async () => unwrap(await supabase.rpc('finance_overview', { p_company: companyId, p_from: from, p_to: to })) as unknown as FinanceOverview,
  })
}

/** Where a source document lives in the app */
export const SOURCE_HREF: Record<string, string> = {
  sales_invoice: '/sales/invoices/', credit_note: '/sales/invoices/', debit_note: '/sales/invoices/', vendor_debit: '/procurement/bills/', delivery: '/sales/deliveries/',
  goods_receipt: '/inventory/receipts/', stock_adjustment: '/inventory/adjustments/', stock_transfer: '/inventory/transfers/',
  landed_cost: '/inventory/landed-costs/', vendor_bill: '/procurement/bills/', vendor_credit: '/procurement/bills/',
  customer_payment: '/finance/payments/', vendor_payment: '/finance/payments/', compensation: '/finance/compensations?c=', fixed_asset: '/finance/assets/', pos_session: '/pos/sessions/', work_order: '/manufacturing/orders/',
}
export const SOURCE_LABEL: Record<string, string> = {
  sales_invoice: msg('Invoice'), credit_note: msg('Credit note'), debit_note: msg('Debit note'), vendor_debit: msg('Supplier’s debit note'), delivery: msg('Delivery'), goods_receipt: msg('Goods receipt'), stock_adjustment: msg('Adjustment'),
  stock_transfer: msg('Transfer|document'), landed_cost: msg('Landed cost'), vendor_bill: msg('Vendor bill'), vendor_credit: msg('Vendor credit'), customer_payment: msg('Receipt|payment'),
  vendor_payment: msg('Payment'), compensation: msg('Compensation'), fixed_asset: msg('Fixed asset'), work_order: msg('Work order'), pos_order: msg('POS receipt'), pos_session: msg('POS session'),
}

/** Name of the kind of document an accounting entry came from, in the current language */
export function sourceLabel(type: string | null | undefined): string {
  if (!type) return ''
  const k = SOURCE_LABEL[type]
  return k ? t(k) : tEnum(type)
}

/** month the fiscal year starts (1 = January) */
export function useFiscalStartMonth() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.all(companyId), 'fy-month'],
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.from('companies').select('fiscal_year_start_month').eq('id', companyId).single()).fiscal_year_start_month as number,
  })
}

/* ---------------------------------------------------------------- cash forecast and the supplier payment proposal */
export type ForecastWeek = {
  week: number; start: string; end: string; receipts: number; recurring_in: number; plan_in: number; sales_in: number; future_sales: number
  bills: number; payroll: number; vat: number; plan_out: number; other_out: number; future_bills: number
  inflow: number; outflow: number; net: number; closing: number
}
export type ForecastFlow = { date: string; week: number; kind: string; label: string | null; partner_id: string | null; partner: string | null; amount: number; ref: string | null; overdue: boolean }
export type CashForecast = {
  as_of: string; weeks_count: number; estimates: boolean; currency: string; opening: number
  accounts: { id: string; name: string; kind: string; currency: string; balance: number; balance_currency: number }[]
  weeks: ForecastWeek[]; first_negative_week: number | null; lowest: { week: number; closing: number } | null
  overdue_in: number; overdue_out: number; doubtful: number; avg_late_days: number
  ar_open: number; ap_open: number; dso: number | null; dpo: number | null
  customers: { id: string; name: string; amount: number; late_days: number; docs: number; overdue: boolean }[]
  flows: ForecastFlow[]
}
export function useCashForecast(weeks: number, estimates: boolean) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...finKeys.list(companyId, 'cash-forecast'), weeks, estimates],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('cash_forecast', { p_company: companyId, p_weeks: weeks, p_estimates: estimates })) as unknown as CashForecast,
  })
}
export type CashPlanItem = Tables<'cash_plan_items'>
export function useCashPlanItems() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'cash-plan'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('cash_plan_items').select('*').eq('company_id', companyId).order('first_date')),
  })
}
export function useSaveCashPlanItem() {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Partial<CashPlanItem> & { id?: string }) => id
    ? unwrap(await supabase.from('cash_plan_items').update(v as never).eq('id', id))
    : unwrap(await supabase.from('cash_plan_items').insert({ ...v, company_id: companyId } as never)))
}
export const useDeleteCashPlanItem = () => useAction(async (id: string) => unwrap(await supabase.from('cash_plan_items').delete().eq('id', id)))

export type ProposalRow = {
  bill_id: string; number: string; vendor_invoice_number: string | null; vendor_id: string; vendor_name: string; vendor_iban: string | null
  bill_date: string; due_date: string | null; days_overdue: number; currency_code: string; total: number; open_amount: number; open_base: number
  due_now: number; instalments: number; discount_amount: number; discount_until: string | null; reason: 'overdue' | 'discount' | 'due_soon' | 'later'; priority: number
}
export function usePaymentProposal() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'payment-proposal'),
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('payment_proposal', { p_company: companyId })) as unknown as ProposalRow[],
  })
}
export function usePayVendorBills() {
  const { companyId } = useCompany()
  return useAction(async (a: { bank: string; date: string; items: { bill: string; amount: number }[]; reference?: string }) =>
    unwrap(await supabase.rpc('pay_vendor_bills', { p_company: companyId, p_bank: a.bank, p_date: a.date, p_items: a.items as unknown as Json, p_reference: a.reference || undefined })) as unknown as
      { payments: { id: string; number: string; vendor: string; amount: number; status: string }[]; count: number; total: number })
}

/* ---------------------------------------------------------------- bank position: books next to the bank */
export type BankPositionItemBank = { id: string; date: string; description: string | null; amount: number; statement_id: string }
export type BankPositionItemBooks = { entry_id: string; date: string; number: string; description: string | null; amount: number }
export type BankPositionAccount = {
  id: string; name: string; kind: string; currency: string; bank_name: string | null; iban: string | null; account_id: string
  book_balance: number; book_balance_base: number; in_30: number; out_30: number
  statement: null | {
    id: string; date: string; closing: number; status: string; reference: string | null; days_old: number; book_at_date: number; difference: number
    not_in_books: number; not_in_books_count: number; not_in_bank: number; not_in_bank_count: number; unexplained: number
  }
  not_in_books_items: BankPositionItemBank[]; not_in_bank_items: BankPositionItemBooks[]
}
export function useBankPosition() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: finKeys.list(companyId, 'bank-position'),
    enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('bank_position', { p_company: companyId })) as unknown as { accounts: BankPositionAccount[] }).accounts,
  })
}

/** The cash boxes and bank accounts an expense or a Z report can be paid from */
export type PayAccount = { id: string; name: string; kind: 'cash' | 'bank' }
export function useExpensePayAccounts() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: ['expense-pay', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('expense_pay_accounts', { p_company: companyId! })) as unknown as PayAccount[] })
}
