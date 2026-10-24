import { CheckCircle2, Circle, ClipboardCheck } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, tn } from '@/i18n'
import { cn, formatDate, formatMoney, formatQty, todayISO } from '@/lib/utils'
import { type AnyImportKind, type MigrationCheck, type MigrationRun, useMigrationCheck } from '../api'
import { Importer, KINDS } from '../components/importer'

const PROGRAMS = ['Kubit', 'Logmicro', 'Bilanc', 'Pantheon', 'Excel']

type Step = { key: AnyImportKind | 'check'; optional?: boolean; why: string }
// the order matters: invoices need their customers, stock and prices need the products
const STEPS: Step[] = [
  { key: 'products', why: msg('Codes, names, units, prices and VAT of every item.') },
  { key: 'partners', why: msg('Customers and vendors with their NUI/NIPT, before their open invoices.') },
  { key: 'employees', optional: true, why: msg('Only if the company runs payroll here.') },
  { key: 'opening_stock', why: msg('Quantity and cost per item on the cut-over date, one file per warehouse.') },
  { key: 'price_lists', optional: true, why: msg('Wholesale or customer-specific prices.') },
  { key: 'open_receivables', why: msg('Unpaid customer invoices on the cut-over date.') },
  { key: 'open_payables', why: msg('Unpaid vendor bills on the cut-over date.') },
  { key: 'opening_balances', why: msg('Bank, cash, loans, VAT and capital from the trial balance.') },
  { key: 'check', why: msg('Compare the totals with the old program before the client starts working.') },
]

function useSetup(companyId: string) {
  const key = `nexus.migration.${companyId}`
  const [state, setState] = React.useState<{ cutover: string; program: string }>(() => {
    try { return { cutover: todayISO(), program: '', ...JSON.parse(localStorage.getItem(key) ?? '{}') } } catch { return { cutover: todayISO(), program: '' } }
  })
  const update = (patch: Partial<typeof state>) => setState((s) => {
    const next = { ...s, ...patch }
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  return [state, update] as const
}

export function MigrationPage() {
  const { companyId, company, can } = useCompany()
  const [setup, update] = useSetup(companyId)
  const check = useMigrationCheck(setup.cutover)
  const [params, setParams] = useSearchParams()
  const current = (params.get('step') ?? 'products') as Step['key']
  const runs = check.data?.runs ?? []
  const lastRun = (k: string) => runs.find((r) => r.kind === k)
  const kind = KINDS.find((k) => k.key === current)
  const writable = can('admin.write')

  return (
    <>
      <PageHeader title={t('Move from another program')}
        description={t('Bring {company} over from the program it used until now: master data first, then the position on the cut-over date, then compare the totals.', { company: company?.name ?? '' })} />

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-[200px_220px_minmax(0,1fr)] sm:items-end">
          <div className="grid gap-1.5">
            <label htmlFor="cutover" className="text-[13px] font-medium">{t('Cut-over date')}</label>
            <Input id="cutover" type="date" value={setup.cutover} onChange={(e) => update({ cutover: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <label className="text-[13px] font-medium" id="program-label">{t('Old program')}</label>
            <Select value={setup.program || undefined} onValueChange={(v) => update({ program: v })}>
              <SelectTrigger aria-labelledby="program-label"><SelectValue placeholder={t('Choose…')} /></SelectTrigger>
              <SelectContent>
                {PROGRAMS.map((p) => <SelectItem key={p} value={p}>{p === 'Excel' ? t('Excel kept by hand') : p}</SelectItem>)}
                <SelectItem value="other">{t('Another program')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Balances, open invoices and stock are taken as they stand on the cut-over date; from that day on the client works only in NexusERP. Export each list from the old program to Excel on that date.')}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label={t('Steps')} className="flex flex-col gap-1">
          {STEPS.map((s, i) => {
            const k = KINDS.find((x) => x.key === s.key)
            const run = s.key !== 'check' ? lastRun(s.key) : undefined
            const active = current === s.key
            return (
              <button key={s.key} type="button" onClick={() => setParams({ step: s.key }, { replace: true })}
                aria-current={active ? 'step' : undefined}
                className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-secondary',
                  active ? 'border-primary bg-card ring-1 ring-primary' : 'border-transparent')}>
                {run ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : s.key === 'check' ? <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{i + 1}. {s.key === 'check' ? t('Check the totals') : t(k!.title)}
                    {s.optional && <span className="ml-1 font-normal text-muted-foreground">{t('(optional)')}</span>}</span>
                  <span className="block text-xs text-muted-foreground">
                    {run ? t('{rows} rows · {date}', { rows: formatQty(run.rows), date: formatDate(run.run_at, true) }) : t(s.why)}
                    {run && run.skipped > 0 && <span className="block text-warning">{tn(run.skipped, '{n} row was left out', '{n} rows were left out')}</span>}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0">
          {current === 'check' ? (
            <CheckPanel check={check.data} loading={check.isLoading} error={check.error} retry={() => void check.refetch()} cutover={setup.cutover} />
          ) : kind && writable ? (
            <>
              <div className="mb-1">
                <h2 className="text-base font-semibold">{t(kind.title)}</h2>
                <p className="text-[13px] text-muted-foreground">{t(kind.description)}</p>
              </div>
              <Importer key={`${kind.key}-${setup.cutover}`} kind={kind} cutover={setup.cutover} source={setup.program && setup.program !== 'other' ? setup.program : undefined} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Only the company administrator can import.')}</p>
          )}
        </div>
      </div>
    </>
  )
}

function Figure({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-lg font-semibold tabular">{value}</span>
      {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

const RUN_TITLES: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.title]))

function CheckPanel({ check, loading, error, retry, cutover }: { check?: MigrationCheck; loading: boolean; error: unknown; retry: () => void; cutover: string }) {
  const { company } = useCompany()
  const cur = company?.base_currency
  if (loading) return <Skeleton className="h-80" />
  if (error || !check) return <ErrorState error={error} onRetry={retry} />
  const opening = Number(check.opening_account_balance)
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('Compare with the old program on {date}', { date: formatDate(cutover) })}</CardTitle>
          <CardDescription>{t('Open the same reports in the old program for the cut-over date. Every figure here should match; if one does not, import that step again or correct the document.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Figure label={t('Products')} value={formatQty(check.products)} />
          <Figure label={t('Customers')} value={formatQty(check.customers)} sub={tn(check.vendors, '{n} vendor', '{n} vendors')} />
          <Figure label={t('Stock value')} value={formatMoney(check.stock_value, cur)} sub={tn(check.stock_lines, '{n} item in stock', '{n} items in stock')} />
          <Figure label={t('Employees')} value={formatQty(check.employees)} sub={tn(check.price_list_items, '{n} special price', '{n} special prices')} />
          <Figure label={t('Customers owe')} value={formatMoney(check.receivables, cur)} sub={tn(check.receivables_count, '{n} open invoice', '{n} open invoices')} />
          <Figure label={t('Owed to vendors')} value={formatMoney(check.payables, cur)} sub={tn(check.payables_count, '{n} open bill', '{n} open bills')} />
          <Figure label={t('Opening balance account (1091)')} value={formatMoney(-opening, cur)}
            sub={opening === 0 ? t('Balanced: capital came in with the trial balance') : t('The company\'s opening capital, unless capital accounts were imported too')} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{t('What was imported')}</CardTitle><CardDescription>{t('Every import, newest first.')}</CardDescription></CardHeader>
        {check.runs.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="pl-6">{t('When')}</TableHead><TableHead>{t('Step')}</TableHead><TableHead>{t('File')}</TableHead>
                <TableHead className="text-right">{t('Rows')}</TableHead><TableHead className="text-right">{t('New / updated')}</TableHead>
                <TableHead className="text-right">{t('Total')}</TableHead><TableHead>{t('Who')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {check.runs.map((r: MigrationRun) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap pl-6">{formatDate(r.run_at, true)}</TableCell>
                    <TableCell>{RUN_TITLES[r.kind] ? t(RUN_TITLES[r.kind]!) : r.kind}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{r.file_name || '—'}</TableCell>
                    <TableCell className="text-right tabular">{formatQty(r.rows)}</TableCell>
                    <TableCell className="text-right tabular">{formatQty(r.created)} / {formatQty(r.updated)}</TableCell>
                    <TableCell className="text-right tabular">
                      {r.total == null ? '—' : r.journal_entry_id
                        ? <Link to={`/finance/journal/${r.journal_entry_id}`} className="text-primary hover:underline">{formatMoney(r.total, cur)}</Link>
                        : formatMoney(r.total, cur)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.run_by ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <CardContent><p className="text-sm text-muted-foreground">{t('Nothing imported yet. Start with step 1.')}</p></CardContent>}
      </Card>
    </div>
  )
}
