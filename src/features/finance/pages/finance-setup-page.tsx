import { CalendarPlus, Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { msg, t, td, tn } from '@/i18n'
import { formatDate, formatMonth, humanize, todayISO } from '@/lib/utils'
import { CashLimits } from '../components/cash-limits'
import { PaymentTerms } from '../components/instalments'
import { useAccountDefaults, useAccounts, useAssetCategories, useCreateFiscalYear, useFiscalYears, useJournals, useSaveAccountDefault, useSetPeriodStatus } from '../api'

/** Which account each automatic posting uses — grouped the way an accountant reads them */
const GROUPS: { title: string; keys: [string, string, string][] }[] = [
  { title: msg('Customers and vendors'), keys: [
    ['receivable', msg('Receivables'), msg('Debited by sales invoices, credited by customer receipts')],
    ['payable', msg('Payables'), msg('Credited by vendor bills, debited by payments')],
    ['customer_advances', msg('Customer advances'), msg('Receipts not yet matched to an invoice')],
    ['vendor_advances', msg('Vendor advances'), msg('Payments not yet matched to a bill')],
  ] },
  { title: msg('Sales and VAT'), keys: [
    ['sales_revenue', msg('Sales revenue'), msg('Used when a product or category has no revenue account of its own')],
    ['sales_discount', msg('Sales discounts'), msg('Header discounts on invoices')],
    ['vat_output', msg('VAT payable (output)'), msg('Used when a tax code has no account')],
    ['vat_input', msg('VAT receivable (input)'), msg('Used when a tax code has no account')],
  ] },
  { title: msg('Inventory and purchasing'), keys: [
    ['inventory', msg('Inventory'), msg('Stock value; category overrides apply')],
    ['grni', msg('Goods received, not invoiced'), msg('Credited at receipt, cleared by the vendor bill')],
    ['cogs', msg('Cost of goods sold'), msg('Debited at delivery and POS sale')],
    ['purchase_price_variance', msg('Purchase price variance'), msg('Bill price differs and the stock was already sold')],
    ['inventory_adjustment', msg('Inventory adjustments'), msg('Counts, scrap and other stock corrections')],
    ['landed_cost_clearing', msg('Landed cost clearing'), msg('Freight and duties added to stock value')],
    ['purchase_expense', msg('Purchases (non-stock)'), msg('Bill lines without a product or account')],
  ] },
  { title: msg('Production'), keys: [
    ['wip', msg('Work in progress'), msg('Materials issued to work orders')],
    ['labor_absorbed', msg('Labour absorbed'), ''], ['overhead_absorbed', msg('Overhead absorbed'), ''],
    ['production_variance', msg('Production variance'), ''],
  ] },
  { title: msg('Cash, bank and currency'), keys: [
    ['cash', msg('Cash|account'), ''], ['bank', msg('Bank'), ''], ['pos_cash', msg('POS cash drawers'), ''], ['card_clearing', msg('Card payments in transit'), ''],
    ['cash_in_transit', msg('Cash on its way to the bank'), msg('Deposits from the safe until they are on the bank statement')],
    ['owner_drawings', msg('Owner drawings'), msg('Money the owner takes from the safe')],
    ['bank_charges', msg('Bank charges'), msg('Suggested when booking statement fees')],
    ['cash_difference', msg('Cash over and short'), msg('POS closing differences')],
    ['rounding', msg('Rounding'), msg('Cent differences on automatic entries')],
    ['exchange_gain', msg('Exchange gains'), msg('Realised on payments in foreign currency')], ['exchange_loss', msg('Exchange losses'), ''],
  ] },
  { title: msg('Equity, assets and payroll'), keys: [
    ['retained_earnings', msg('Retained earnings'), ''], ['current_year_earnings', msg('Current year result'), ''],
    ['opening_balance', msg('Opening balances'), msg('Counter-account when stock or balances are loaded')],
    ['depreciation_expense', msg('Depreciation expense'), ''], ['accumulated_depreciation', msg('Accumulated depreciation'), ''],
    ['asset_disposal_gain', msg('Gain on asset disposal'), ''], ['asset_disposal_loss', msg('Loss on asset disposal'), ''],
    ['salary_expense', msg('Salaries'), ''], ['salary_payable', msg('Salaries payable'), ''], ['social_security_payable', msg('Social security payable'), ''],
    ['health_insurance_payable', msg('Health insurance payable'), ''], ['pension_payable', msg('Pension payable'), ''],
    ['income_tax_payable', msg('Income tax payable'), ''], ['employer_contribution_expense', msg('Employer contributions'), ''],
  ] },
]

export function FinanceSetupPage() {
  return (
    <>
      <PageHeader title={t('Finance setup')} description={t('Which accounts automatic entries use, the journals, and which months are still open.')} />
      <Tabs defaultValue="accounts">
        <TabsList><TabsTrigger value="accounts">{t('Posting accounts')}</TabsTrigger><TabsTrigger value="periods">{t('Accounting months')}</TabsTrigger><TabsTrigger value="journals">{t('Journals')}</TabsTrigger><TabsTrigger value="assets">{t('Asset categories')}</TabsTrigger><TabsTrigger value="cash">{t('Cash limits')}</TabsTrigger><TabsTrigger value="terms">{t('Payment terms')}</TabsTrigger></TabsList>
        <TabsContent value="accounts"><PostingAccounts /></TabsContent>
        <TabsContent value="periods"><Periods /></TabsContent>
        <TabsContent value="journals"><Journals /></TabsContent>
        <TabsContent value="assets"><AssetCategories /></TabsContent>
        <TabsContent value="cash"><CashLimits /></TabsContent>
        <TabsContent value="terms"><PaymentTerms /></TabsContent>
      </Tabs>
    </>
  )
}

function PostingAccounts() {
  const { can } = useCompany()
  const accounts = useAccounts()
  const defaults = useAccountDefaults()
  const save = useSaveAccountDefault()
  const map = new Map((defaults.data ?? []).map((d) => [d.key, d.account_id]))
  const options = (accounts.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} ${td(a.name)}`, keywords: [a.account_type, a.name] }))
  if (defaults.isLoading || accounts.isLoading) return <Skeleton className="h-96" />
  if (defaults.isError || accounts.isError) return <Card><ErrorState error={defaults.error ?? accounts.error} onRetry={() => { void defaults.refetch(); void accounts.refetch() }} /></Card>
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {GROUPS.map((g) => (
        <Card key={g.title}>
          <CardHeader className="pb-2"><CardTitle>{t(g.title)}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {g.keys.map(([key, label, hint]) => (
              <div key={key} className="grid grid-cols-[minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_260px]">
                <div><div className="text-[13px] font-medium">{t(label)}</div>{hint && <div className="text-xs text-muted-foreground">{t(hint)}</div>}</div>
                <SearchSelect value={map.get(key) ?? null} disabled={!can('finance.write')} options={options} placeholder={t('Not set: posting will be refused')}
                  onChange={(v) => v && save.mutate({ key, accountId: v })} aria-invalid={!map.get(key)} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Periods() {
  const years = useFiscalYears()
  const setStatus = useSetPeriodStatus()
  const create = useCreateFiscalYear()
  const existing = new Set((years.data ?? []).map((y) => Number(y.start_date.slice(0, 4))))
  const thisYear = new Date().getFullYear()
  const nextYear = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2].find((y) => !existing.has(y))
  const today = todayISO()
  if (years.isLoading) return <Skeleton className="h-96" />
  if (years.isError) return <Card><ErrorState error={years.error} onRetry={() => void years.refetch()} /></Card>
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted-foreground">{t('Closing a month stops new entries dated in it; a finance manager can reopen it. A locked month cannot be reopened. Documents dated in a closed month are refused with a clear message.')}</p>
        <Can perm="finance.write">{nextYear && <Button variant="outline" loading={create.isPending} onClick={async () => { await create.mutateAsync(nextYear); toast.success(t('Financial year {year} created', { year: nextYear })) }}><CalendarPlus /> {t('Create financial year {year}', { year: nextYear })}</Button>}</Can>
      </div>
      {!years.data?.length && <EmptyState title={t('No financial years')} description={t('Create the current year to start recording entries.')} />}
      {(years.data ?? []).map((y) => {
        const periods = [...y.periods].sort((a, b) => a.period_no - b.period_no)
        return (
          <Card key={y.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
              <div><CardTitle>{/^FY \d{4}$/.test(y.name) ? t('Financial year {year}', { year: y.name.slice(3) }) : y.name}</CardTitle><CardDescription>{formatDate(y.start_date)} – {formatDate(y.end_date)} · {t('{open} of {total} months open', { open: periods.filter((p) => p.status === 'open').length, total: periods.length })}</CardDescription></div>
              <StatusBadge status={y.status} />
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableBody>
                  {periods.map((p) => (
                    <TableRow key={p.id} className="hover:bg-transparent">
                      <TableCell className="w-40 font-medium capitalize">{formatMonth(p.start_date)}</TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{formatDate(p.start_date)} – {formatDate(p.end_date)}{p.start_date <= today && today <= p.end_date && <span className="ml-2 text-primary">{t('Current')}</span>}</TableCell>
                      <TableCell className="w-28"><StatusBadge status={p.status} /></TableCell>
                      <TableCell className="w-56 text-right">
                        <Can perm="finance.approve">
                          {p.status === 'open' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'closed' }, { onSuccess: () => toast.success(t('{month} closed', { month: formatMonth(p.start_date) })) })}><Lock /> {t('Close month')}</Button>}
                          {p.status === 'closed' && <>
                            <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'open' }, { onSuccess: () => toast.success(t('{month} reopened', { month: formatMonth(p.start_date) })) })}><LockOpen /> {t('Reopen')}</Button>
                            <ConfirmDialog destructive title={t('Lock {month} for good?', { month: formatMonth(p.start_date) })}
                              description={t('A locked month never opens again: nobody, not even the administrator, can add or change an entry dated in it. Lock it only after the declarations for it are filed and the books are checked.')}
                              confirmLabel={t('Lock for good')}
                              trigger={<Button size="sm" variant="ghost" className="text-destructive">{t('Lock')}</Button>}
                              onConfirm={async () => { await setStatus.mutateAsync({ id: p.id, status: 'locked' }); toast.success(t('{month} locked', { month: formatMonth(p.start_date) })) }} />
                          </>}
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Journals() {
  const journals = useJournals()
  if (journals.isLoading) return <Skeleton className="h-64" />
  if (journals.isError) return <Card><ErrorState error={journals.error} onRetry={() => void journals.refetch()} /></Card>
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Code')}</TableHead><TableHead>{t('Name')}</TableHead><TableHead>{t('Used for')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {(journals.data ?? []).map((j) => (
              <TableRow key={j.id} className="hover:bg-transparent">
                <TableCell className="font-mono text-xs">{j.code}</TableCell><TableCell className="font-medium">{td(j.name)}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{JOURNAL_USE[j.code] ? t(JOURNAL_USE[j.code]!) : humanize(j.journal_type)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
const JOURNAL_USE: Record<string, string> = {
  SAL: msg('Sales invoices and credit notes'), PUR: msg('Vendor bills and credits'), INV: msg('Receipts, deliveries, adjustments, landed costs'),
  BNK: msg('Bank payments, receipts and statement bookings'), CSH: msg('Cash box payments'), GEN: msg('Manual entries, asset acquisitions and disposals'),
  POS: msg('Point-of-sale sessions'), DEP: msg('Monthly depreciation'), MFG: msg('Work orders'), PAY: msg('Payroll'),
}

function AssetCategories() {
  const cats = useAssetCategories()
  const accounts = useAccounts()
  const name = (id: string) => { const a = accounts.data?.find((x) => x.id === id); return a ? `${a.code} ${td(a.name)}` : '—' }
  if (cats.isLoading) return <Skeleton className="h-64" />
  if (cats.isError) return <Card><ErrorState error={cats.error} onRetry={() => void cats.refetch()} /></Card>
  if (!cats.data?.length) return <Card><EmptyState title={t('No asset categories')} description={t('Asset categories are created with the company. Add one when you register a new kind of asset.')} /></Card>
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Category')}</TableHead><TableHead>{t('Useful life')}</TableHead><TableHead>{t('Method')}</TableHead><TableHead>{t('Asset account')}</TableHead><TableHead>{t('Accumulated depreciation')}</TableHead><TableHead>{t('Expense account')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {(cats.data ?? []).map((c) => (
              <TableRow key={c.id} className="hover:bg-transparent">
                <TableCell className="font-medium">{td(c.name)}</TableCell>
                <TableCell className="tabular">{c.useful_life_months / 12 >= 1 && c.useful_life_months % 12 === 0 ? tn(c.useful_life_months / 12, '{n} year', '{n} years') : tn(c.useful_life_months, '{n} month', '{n} months')}</TableCell>
                <TableCell className="text-[13px]">{c.depreciation_method === 'straight_line' ? t('Straight line') : t('Declining balance {pct}%', { pct: c.declining_rate_pct ?? 20 })}</TableCell>
                <TableCell className="text-[13px]">{name(c.asset_account_id)}</TableCell>
                <TableCell className="text-[13px]">{name(c.accumulated_depreciation_account_id)}</TableCell>
                <TableCell className="text-[13px]">{name(c.depreciation_expense_account_id)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
