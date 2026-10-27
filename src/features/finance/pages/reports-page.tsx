import { useQueries } from '@tanstack/react-query'
import { AlertTriangle, Download, Printer } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, msg, t, td } from '@/i18n'
import { cn, formatCompact, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { fetchBalances, finKeys, useCostCenters, useFiscalStartMonth, type BalanceRow } from '../api'
import { downloadCsv } from '@/lib/export'
import { axisTick, iso, tooltipStyle } from './finance-overview-page'

/* ------------------------------------------------------------------ periods */
type Col = { key: string; label: string; from: string; to: string }
type PeriodKind = 'ytd' | 'year' | 'quarter' | 'month' | 'last_month' | 'custom'
type Compare = 'none' | 'prev1' | 'prev2' | 'prev4' | 'months' | 'quarters'

const MONTHS = (y: number, m: number) => formatDateWith(new Date(y, m, 1), { month: 'short' })
const shiftYear = (d: string, k: number) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  const last = new Date(y - k, m, 0).getDate()        // keep 29 Feb → 28 Feb
  return `${y - k}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
}
function baseRange(kind: PeriodKind, year: number, fyMonth: number, custom: [string, string]): [string, string, string] {
  const n = new Date()
  const fyStart = (y: number) => new Date(y, fyMonth - 1, 1)
  const fyOf = (d: Date) => (d.getMonth() + 1 >= fyMonth ? d.getFullYear() : d.getFullYear() - 1)
  switch (kind) {
    case 'year': { const s = fyStart(year); return [iso(s), iso(new Date(s.getFullYear() + 1, s.getMonth(), 0)), t('Financial year {year}', { year })] }
    case 'ytd': { const s = fyStart(fyOf(n)); return [iso(s), iso(n), `${MONTHS(s.getFullYear(), s.getMonth())}–${MONTHS(n.getFullYear(), n.getMonth())} ${n.getFullYear()}`] }
    case 'quarter': { const s = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1); return [iso(s), iso(n), t('Q{q} {year}', { q: Math.floor(n.getMonth() / 3) + 1, year: n.getFullYear() })] }
    case 'month': return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n), `${MONTHS(n.getFullYear(), n.getMonth())} ${n.getFullYear()}`]
    case 'last_month': { const s = new Date(n.getFullYear(), n.getMonth() - 1, 1); return [iso(s), iso(new Date(n.getFullYear(), n.getMonth(), 0)), `${MONTHS(s.getFullYear(), s.getMonth())} ${s.getFullYear()}`] }
    default: return [custom[0], custom[1], `${formatDate(custom[0])} – ${formatDate(custom[1])}`]
  }
}
function buildColumns(kind: PeriodKind, compare: Compare, year: number, fyMonth: number, custom: [string, string]): Col[] {
  const [from, to, label] = baseRange(kind, year, fyMonth, custom)
  const base: Col = { key: 'c0', label, from, to }
  if (compare.startsWith('prev')) {
    const n = compare === 'prev1' ? 1 : compare === 'prev2' ? 2 : 4
    return [base, ...Array.from({ length: n }, (_, i) => {
      const f = shiftYear(from, i + 1); const t = shiftYear(to, i + 1)
      return { key: `c${i + 1}`, from: f, to: t, label: label.replace(/\d{4}/g, (y) => String(Number(y) - i - 1)) }
    })]
  }
  if (compare === 'months' || compare === 'quarters') {
    const cols: Col[] = []
    const step = compare === 'months' ? 1 : 3
    let d = new Date(`${from}T00:00:00`)
    while (iso(d) <= to && cols.length < 24) {
      const end = new Date(d.getFullYear(), d.getMonth() + step, 0)
      cols.push({ key: `p${cols.length}`, from: iso(d), to: iso(end) > to ? to : iso(end),
        label: step === 1 ? MONTHS(d.getFullYear(), d.getMonth()) : t('Q{q}', { q: Math.floor(((d.getMonth() - fyMonth + 1 + 12) % 12) / 3) + 1 }) })
      d = new Date(d.getFullYear(), d.getMonth() + step, 1)
    }
    return [...cols, { ...base, key: 'total', label: t('Total') }]
  }
  return [base]
}
const fyStartOf = (d: string, fyMonth: number) => {
  const [y, m] = d.split('-').map(Number) as [number, number]
  return `${m >= fyMonth ? y : y - 1}-${String(fyMonth).padStart(2, '0')}-01`
}

/* -------------------------------------------------------------- statements */
type Row = { kind: 'section' | 'account' | 'subtotal' | 'total' | 'check'; label: string; values: number[]; accountId?: string; code?: string; depth?: number }
type Bal = Map<string, BalanceRow>
const mvt = (b?: BalanceRow) => num(b?.debit) - num(b?.credit)

function accountRows(accounts: BalanceRow[], cols: Bal[], pick: (a: BalanceRow) => boolean, value: (b: BalanceRow | undefined) => number): { rows: Row[]; totals: number[] } {
  const rows: Row[] = []
  const totals = cols.map(() => 0)
  for (const a of accounts.filter((x) => x.is_postable && pick(x)).sort((x, y) => x.code.localeCompare(y.code))) {
    const values = cols.map((c) => value(c.get(a.account_id)))
    if (values.every((v) => Math.abs(v) < 0.005)) continue
    values.forEach((v, i) => { totals[i]! += v })
    rows.push({ kind: 'account', label: a.name, code: a.code, accountId: a.account_id, values, depth: 1 })
  }
  return { rows, totals }
}
const add = (...xs: number[][]) => xs[0]!.map((_, i) => xs.reduce((s, x) => s + num(x[i]), 0))
const neg = (x: number[]) => x.map((v) => -v)

function profitAndLoss(accounts: BalanceRow[], cols: Bal[]) {
  const rev = accountRows(accounts, cols, (a) => a.account_type === 'revenue' && a.account_subtype !== 'other_income', (b) => -mvt(b))
  const cogs = accountRows(accounts, cols, (a) => a.account_type === 'expense' && a.account_subtype === 'cogs', mvt)
  const opex = accountRows(accounts, cols, (a) => a.account_type === 'expense' && !['cogs', 'other_expense'].includes(a.account_subtype), mvt)
  const oi = accountRows(accounts, cols, (a) => a.account_type === 'revenue' && a.account_subtype === 'other_income', (b) => -mvt(b))
  const oe = accountRows(accounts, cols, (a) => a.account_type === 'expense' && a.account_subtype === 'other_expense', mvt)
  const gross = add(rev.totals, neg(cogs.totals))
  const operating = add(gross, neg(opex.totals))
  const net = add(operating, oi.totals, neg(oe.totals))
  const rows: Row[] = [
    { kind: 'section', label: msg('Revenue'), values: [] }, ...rev.rows, { kind: 'subtotal', label: msg('Total revenue'), values: rev.totals },
    { kind: 'section', label: msg('Cost of sales'), values: [] }, ...cogs.rows, { kind: 'subtotal', label: msg('Total cost of sales'), values: cogs.totals },
    { kind: 'total', label: msg('Gross profit'), values: gross },
    { kind: 'section', label: msg('Operating expenses'), values: [] }, ...opex.rows, { kind: 'subtotal', label: msg('Total operating expenses'), values: opex.totals },
    { kind: 'total', label: msg('Operating profit'), values: operating },
  ]
  if (oi.rows.length || oe.rows.length) rows.push(
    { kind: 'section', label: msg('Other income and expenses'), values: [] }, ...oi.rows, ...oe.rows.map((r) => ({ ...r, values: neg(r.values) })),
    { kind: 'subtotal', label: msg('Net other income'), values: add(oi.totals, neg(oe.totals)) })
  rows.push({ kind: 'total', label: msg('Net profit'), values: net })
  // the usual profit measures, from the same accounts: tax (69), interest (661 / 761), depreciation
  const sumOf = (pick: (a: BalanceRow) => boolean, val: (b?: BalanceRow) => number) => cols.map((c) => accounts.filter((a) => a.is_postable && pick(a)).reduce((s, a) => s + val(c.get(a.account_id)), 0))
  const isInterest = (a: BalanceRow) => /interest|interes|kamat/i.test(a.name)
  const tax = sumOf((a) => a.account_type === 'expense' && a.code.startsWith('69'), mvt)
  const interest = add(sumOf((a) => a.account_type === 'expense' && (a.code.startsWith('661') || isInterest(a)), mvt),
    neg(sumOf((a) => a.account_type === 'revenue' && (a.code.startsWith('761') || isInterest(a)), (b) => -mvt(b))))
  const dep = sumOf((a) => a.account_type === 'expense' && (a.account_subtype === 'depreciation' || a.code.startsWith('68')), mvt)
  const ebt = add(net, tax)
  const ebit = add(ebt, interest)
  const ebitda = add(ebit, dep)
  rows.push(
    { kind: 'section', label: msg('Profit measures'), values: [] },
    { kind: 'account', label: msg('EBITDA: profit before interest, tax, depreciation and amortisation'), values: ebitda, depth: 1 },
    { kind: 'account', label: msg('EBIT: profit before interest and tax'), values: ebit, depth: 1 },
    { kind: 'account', label: msg('EBT: profit before tax'), values: ebt, depth: 1 },
    { kind: 'account', label: msg('EAT: profit after tax'), values: net, depth: 1 },
  )
  return { rows, revenue: rev.totals, gross, net }
}

function balanceSheet(accounts: BalanceRow[], cols: Bal[]) {
  const cl = (b?: BalanceRow) => num(b?.closing)
  const isA = (a: BalanceRow, ...s: string[]) => a.account_type === 'asset' && s.includes(a.account_subtype)
  const nonCurrent = ['fixed_asset', 'accumulated_depreciation', 'non_current_asset']
  const ca = accountRows(accounts, cols, (a) => a.account_type === 'asset' && !nonCurrent.includes(a.account_subtype), cl)
  const nca = accountRows(accounts, cols, (a) => isA(a, ...nonCurrent), cl)
  const cli = accountRows(accounts, cols, (a) => a.account_type === 'liability' && a.account_subtype !== 'long_term_liability', (b) => -cl(b))
  const lli = accountRows(accounts, cols, (a) => a.account_type === 'liability' && a.account_subtype === 'long_term_liability', (b) => -cl(b))
  const eq = accountRows(accounts, cols, (a) => a.account_type === 'equity', (b) => -cl(b))
  const pl = (a: BalanceRow) => a.account_type === 'revenue' || a.account_type === 'expense'
  const prior = cols.map((c) => -accounts.filter(pl).reduce((s, a) => s + num(c.get(a.account_id)?.opening), 0))
  const current = cols.map((c) => -accounts.filter(pl).reduce((s, a) => s + mvt(c.get(a.account_id)), 0))
  const assets = add(ca.totals, nca.totals)
  const liabilities = add(cli.totals, lli.totals)
  const equity = add(eq.totals, prior, current)
  const le = add(liabilities, equity)
  const diff = add(assets, neg(le))
  const rows: Row[] = [
    { kind: 'section', label: msg('Current assets'), values: [] }, ...ca.rows, { kind: 'subtotal', label: msg('Total current assets'), values: ca.totals },
    { kind: 'section', label: msg('Non-current assets'), values: [] }, ...nca.rows, { kind: 'subtotal', label: msg('Total non-current assets'), values: nca.totals },
    { kind: 'total', label: msg('Total assets'), values: assets },
    { kind: 'section', label: msg('Current liabilities'), values: [] }, ...cli.rows, { kind: 'subtotal', label: msg('Total current liabilities'), values: cli.totals },
  ]
  if (lli.rows.length) rows.push({ kind: 'section', label: msg('Long-term liabilities'), values: [] }, ...lli.rows, { kind: 'subtotal', label: msg('Total long-term liabilities'), values: lli.totals })
  rows.push(
    { kind: 'subtotal', label: msg('Total liabilities'), values: liabilities },
    { kind: 'section', label: msg('Equity'), values: [] }, ...eq.rows,
    ...(prior.some((v) => Math.abs(v) > 0.005) ? [{ kind: 'account' as const, label: msg('Result of earlier years, not yet closed'), values: prior, depth: 1 }] : []),
    { kind: 'account', label: msg('Profit for the year'), values: current, depth: 1 },
    { kind: 'subtotal', label: msg('Total equity'), values: equity },
    { kind: 'total', label: msg('Total liabilities and equity'), values: le },
  )
  if (diff.some((v) => Math.abs(v) > 0.005)) rows.push({ kind: 'check', label: msg('Out of balance'), values: diff })
  return { rows, assets, equity }
}

function cashFlow(accounts: BalanceRow[], cols: Bal[]) {
  const isCash = (a: BalanceRow) => a.account_type === 'asset' && ['cash', 'bank'].includes(a.account_subtype)
  const bs = (a: BalanceRow) => ['asset', 'liability', 'equity'].includes(a.account_type) && !isCash(a)
  const category = (a: BalanceRow) => a.account_subtype === 'accumulated_depreciation' ? 'investing'
    : a.cash_flow_category ?? (isCashFlowInvesting(a) ? 'investing' : a.account_type === 'equity' || a.account_subtype === 'long_term_liability' ? 'financing' : 'operating')
  const change = (b?: BalanceRow) => -(num(b?.closing) - num(b?.opening))      // more assets = cash out
  const depreciation = cols.map((c) => accounts.filter((a) => a.account_type === 'expense' && a.account_subtype === 'depreciation').reduce((s, a) => s + mvt(c.get(a.account_id)), 0))
  const net = cols.map((c) => -accounts.filter((a) => a.account_type === 'revenue' || a.account_type === 'expense').reduce((s, a) => s + mvt(c.get(a.account_id)), 0))
  const group = (label: string, pick: (a: BalanceRow) => boolean): Row => ({
    kind: 'account', label, depth: 1, values: cols.map((c) => accounts.filter((a) => a.is_postable && bs(a) && pick(a)).reduce((s, a) => s + change(c.get(a.account_id)), 0)),
  })
  const op = (a: BalanceRow) => category(a) === 'operating'
  const opRows = [
    { kind: 'account' as const, label: msg('Net profit'), values: net, depth: 1 },
    // depreciation is added back as expensed; what is left of the change in accumulated depreciation belongs to disposals (investing)
    { kind: 'account' as const, label: msg('Depreciation'), depth: 1, values: depreciation },
    group(msg('Change in receivables'), (a) => op(a) && a.account_subtype === 'receivable'),
    group(msg('Change in inventory'), (a) => op(a) && a.account_subtype === 'inventory'),
    group(msg('Change in payables'), (a) => op(a) && a.account_subtype === 'payable'),
    group(msg('Change in VAT and taxes'), (a) => op(a) && a.account_subtype === 'tax'),
    group(msg('Other working capital'), (a) => op(a) && !['receivable', 'inventory', 'payable', 'tax'].includes(a.account_subtype)),
  ].filter((r, i) => i === 0 || r.values.some((v) => Math.abs(v) > 0.005))
  const invRows = accountRows(accounts, cols, (a) => bs(a) && category(a) === 'investing' && a.account_subtype !== 'accumulated_depreciation', change)
  const disposals = cols.map((c, i) => accounts.filter((a) => a.account_subtype === 'accumulated_depreciation').reduce((s, a) => s + change(c.get(a.account_id)), 0) - depreciation[i]!)
  if (disposals.some((v) => Math.abs(v) > 0.005)) {
    invRows.rows.push({ kind: 'account', label: msg('Depreciation written off on disposals'), values: disposals, depth: 1 })
    invRows.totals = add(invRows.totals, disposals)
  }
  const finRows = accountRows(accounts, cols, (a) => bs(a) && category(a) === 'financing', change)
  const opTotal = add(...opRows.map((r) => r.values))
  const total = add(opTotal, invRows.totals, finRows.totals)
  const begin = cols.map((c) => accounts.filter(isCash).reduce((s, a) => s + num(c.get(a.account_id)?.opening), 0))
  const end = cols.map((c) => accounts.filter(isCash).reduce((s, a) => s + num(c.get(a.account_id)?.closing), 0))
  const diff = add(begin, total, neg(end))
  const rows: Row[] = [
    { kind: 'section', label: msg('Operating activities'), values: [] }, ...opRows, { kind: 'subtotal', label: msg('Cash from operations'), values: opTotal },
    { kind: 'section', label: msg('Investing activities'), values: [] }, ...invRows.rows, { kind: 'subtotal', label: msg('Cash from investing'), values: invRows.totals },
    { kind: 'section', label: msg('Financing activities'), values: [] }, ...finRows.rows, { kind: 'subtotal', label: msg('Cash from financing'), values: finRows.totals },
    { kind: 'total', label: msg('Net change in cash'), values: total },
    { kind: 'account', label: msg('Cash at the start'), values: begin },
    { kind: 'total', label: msg('Cash at the end'), values: end },
  ]
  if (diff.some((v) => Math.abs(v) > 0.005)) rows.push({ kind: 'check', label: msg('Does not reconcile'), values: diff })
  return { rows }
}
const isCashFlowInvesting = (a: BalanceRow) => a.account_type === 'asset' && ['fixed_asset', 'non_current_asset'].includes(a.account_subtype)

/* -------------------------------------------------------------------- page */
const TABS = { pl: msg('Income statement'), bs: msg('Balance sheet'), cf: msg('Cash flow statement'), tb: msg('Trial balance') } as const
type Tab = keyof typeof TABS

export function ReportsPage() {
  const { company, companyId } = useCompany()
  const cur = company?.base_currency ?? 'ALL'
  const fyMonth = useFiscalStartMonth().data ?? 1
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) in TABS ? (params.get('tab') as Tab) : 'pl'
  const setTab = (t: string) => setParams((p) => { p.set('tab', t); return p }, { replace: true })
  const thisYear = new Date().getFullYear()
  const [kind, setKind] = React.useState<PeriodKind>(params.get('from') ? 'custom' : 'ytd')
  const [year, setYear] = React.useState(thisYear - 1)
  const [custom, setCustom] = React.useState<[string, string]>([params.get('from') ?? `${thisYear}-01-01`, params.get('to') ?? todayISO()])
  const [compare, setCompare] = React.useState<Compare>(params.get('from') ? 'none' : 'prev1')
  const [cc, setCc] = React.useState<string | null>(params.get('cc'))
  const ccs = useCostCenters()
  const cols = React.useMemo(() => buildColumns(kind, compare, year, fyMonth, custom), [kind, compare, year, fyMonth, custom])
  const useCc = tab === 'pl' || tab === 'tb' ? cc : null
  const ranges = cols.map((c) => (tab === 'bs' ? { from: fyStartOf(c.to, fyMonth), to: c.to } : { from: c.from, to: c.to }))
  const results = useQueries({
    queries: ranges.map((r) => ({
      queryKey: [...finKeys.all(companyId), 'balances', r.from, r.to, useCc ?? 'all'],
      queryFn: () => fetchBalances(companyId, r.from, r.to, useCc),
      enabled: !!companyId,
      staleTime: 30_000,
    })),
  })
  const loading = results.some((r) => r.isLoading)
  const failed = results.find((r) => r.isError)
  const maps = results.map((r) => new Map((r.data ?? []).map((b) => [b.account_id, b])))
  const accounts = results[0]?.data ?? []
  const yearly = compare.startsWith('prev')

  const statement = React.useMemo((): { rows: Row[]; revenue?: number[]; gross?: number[]; net?: number[] } | null => {
    if (loading || !accounts.length) return null
    if (tab === 'pl') return profitAndLoss(accounts, maps)
    if (tab === 'bs') return balanceSheet(accounts, maps)
    if (tab === 'cf') return cashFlow(accounts, maps)
    return null
  }, [loading, tab, results.map((r) => r.dataUpdatedAt).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const chart = tab === 'pl' && statement?.net && cols.length > 1
    ? cols.filter((c) => c.key !== 'total').map((c, i) => ({ label: c.label, revenue: statement.revenue?.[i], gross: statement.gross?.[i], net: statement.net?.[i] }))
    : null
  const chartData = chart && yearly ? [...chart].reverse() : chart     // oldest year first

  const exportCsv = () => {
    if (tab === 'tb') {
      downloadCsv(`${t('trial-balance')}-${cols[0]!.to}`, [[t('Code'), t('Account'), t('Opening'), t('Debit'), t('Credit'), t('Closing')],
        ...accounts.filter((a) => a.is_postable && (num(a.opening) || num(a.debit) || num(a.credit))).map((a) => [a.code, td(a.name), a.opening, a.debit, a.credit, a.closing])])
      return
    }
    if (!statement) return
    downloadCsv(`${t(TABS[tab]).toLowerCase().replace(/\s+/g, '-')}-${cols[0]!.to}`, [[t('Code'), t('Line'), ...cols.map((c) => `${c.label} (${c.from}..${c.to})`)],
      ...statement.rows.map((r) => [r.code ?? '', rowLabel(r), ...cols.map((_, i) => (r.kind === 'section' ? '' : r.values[i]?.toFixed(2)))])])
  }

  const base = cols.find((c) => c.key === 'c0' || c.key === 'total')!
  const ccName = cc ? ccs.data?.find((c) => c.id === cc) : null
  return (
    <>
      <PageHeader title={t('Financial statements')}
        description={<>{company?.name} · {cur}{ccName && (tab === 'pl' || tab === 'tb') ? ` · ${t('cost center {name}', { name: `${ccName.code} ${ccName.name}` })}` : ''}. {t('Figures come from posted accounting entries; click an account to see what is behind it.')}</>}
        actions={<>
          <Button variant="outline" onClick={exportCsv} disabled={loading}><Download /> {t('Export')}</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer /> {t('Print')}</Button>
        </>} />
      <Tabs value={tab} onValueChange={setTab} className="print:hidden">
        <TabsList>{Object.entries(TABS).map(([k, l]) => <TabsTrigger key={k} value={k}>{t(l)}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div className="mt-3 flex flex-wrap items-end gap-3 print:hidden">
        <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{tab === 'bs' ? t('As of the end of') : t('Period')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as PeriodKind)}><SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ytd">{t('Year to date')}</SelectItem><SelectItem value="year">{t('Full financial year')}</SelectItem><SelectItem value="quarter">{t('This quarter')}</SelectItem>
              <SelectItem value="month">{t('This month')}</SelectItem><SelectItem value="last_month">{t('Last month')}</SelectItem><SelectItem value="custom">{t('Custom dates')}</SelectItem>
            </SelectContent></Select></div>
        {kind === 'year' && <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{t('Year')}</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}><SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>}
        {kind === 'custom' && <>
          <div className="grid gap-1.5"><Label htmlFor="r-from" className="text-xs text-muted-foreground">{t('From')}</Label><Input id="r-from" type="date" className="w-[150px]" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} /></div>
          <div className="grid gap-1.5"><Label htmlFor="r-to" className="text-xs text-muted-foreground">{t('To')}</Label><Input id="r-to" type="date" className="w-[150px]" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} /></div>
        </>}
        {tab !== 'tb' && <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{t('Compare with')}</Label>
          <Select value={compare} onValueChange={(v) => setCompare(v as Compare)}><SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('No comparison')}</SelectItem><SelectItem value="prev1">{t('Previous year')}</SelectItem>
              <SelectItem value="prev2">{t('Two previous years')}</SelectItem><SelectItem value="prev4">{t('Four previous years')}</SelectItem>
              {tab !== 'bs' && <><SelectItem value="months">{t('Month by month')}</SelectItem><SelectItem value="quarters">{t('Quarter by quarter')}</SelectItem></>}
              {tab === 'bs' && <><SelectItem value="months">{t('End of each month')}</SelectItem><SelectItem value="quarters">{t('End of each quarter')}</SelectItem></>}
            </SelectContent></Select></div>}
        {(tab === 'pl' || tab === 'tb') && <div className="grid gap-1.5"><Label className="text-xs text-muted-foreground">{t('Cost center')}</Label>
          <Select value={cc ?? '__all'} onValueChange={(v) => setCc(v === '__all' ? null : v)}><SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all">{t('Whole company')}</SelectItem>{(ccs.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}</SelectContent></Select></div>}
      </div>

      {chartData && chartData.length > 1 && (
        <Card className="mt-4 print:hidden">
          <CardHeader className="pb-2"><CardTitle>{yearly ? t('Year on year') : t('Over the period')}</CardTitle><CardDescription>{t('Revenue, gross profit and net profit, {cur}', { cur })}</CardDescription></CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ left: -8, right: 4 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={56} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => formatMoney(v, cur)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                  <Bar isAnimationActive={false} dataKey="revenue" name={t('Revenue')} fill="hsl(var(--primary) / 0.3)" radius={[3, 3, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="gross" name={t('Gross profit')} fill="hsl(var(--primary) / 0.6)" radius={[3, 3, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="net" name={t('Net profit')} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4 print:border-0 print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle>{t(TABS[tab])}</CardTitle>
          <CardDescription>{tab === 'bs' ? t('As of {date}', { date: formatDate(base.to) }) : `${formatDate(base.from)} – ${formatDate(base.to)}`}{tab === 'cf' ? ` · ${t('indirect method')}` : ''}{useCc ? ` · ${t('one cost center')}` : ''}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? <Skeleton className="m-4 h-80" /> : failed ? <ErrorState error={failed.error} onRetry={() => results.forEach((r) => void r.refetch())} />
            : !accounts.length ? <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{t('Nothing recorded in this period.')}</p> : tab === 'tb' ? <TrialBalance rows={accounts} /> : statement && (
            <StatementTable rows={statement.rows} cols={tab === 'bs' && cols.at(-1)?.key === 'total' ? cols.slice(0, -1) : cols} variance={yearly} trimLast={tab === 'bs' && cols.at(-1)?.key === 'total'} />
          )}
        </CardContent>
      </Card>
    </>
  )
}

function StatementTable({ rows, cols, variance, trimLast }: { rows: Row[]; cols: Col[]; variance: boolean; trimLast: boolean }) {
  const n = cols.length
  return (
    <table className="w-full min-w-[560px] text-[13px]">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="sticky left-0 z-10 min-w-[240px] bg-card px-4 py-2 text-left font-medium" />
          {cols.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-2 text-right font-medium">{c.label}</th>)}
          {variance && n > 1 && <th className="px-4 py-2 text-right font-medium">{t('Change|difference')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const vals = trimLast ? r.values.slice(0, n) : r.values
          const ch = variance && n > 1 && r.kind !== 'section' ? pctChange(vals[0], vals[1]) : null
          if (r.kind === 'section') return <tr key={i}><td className="sticky left-0 bg-card px-4 pb-1 pt-4 text-xs font-semibold text-muted-foreground">{rowLabel(r)}</td><td colSpan={n + 1} /></tr>
          return (
            <tr key={i} className={cn(
              r.kind === 'subtotal' && 'border-t font-medium',
              r.kind === 'total' && 'border-y-2 bg-muted font-semibold',
              r.kind === 'check' && 'text-destructive',
            )}>
              <td className={cn('sticky left-0 bg-card px-4 py-1.5', r.kind === 'total' && 'bg-muted', r.depth && 'pl-8')}>
                {r.kind === 'check' && <AlertTriangle className="mr-1.5 inline size-3.5" />}
                {r.accountId ? <Link to={`/finance/accounts/${r.accountId}`} className="hover:underline"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>{rowLabel(r)}</Link> : rowLabel(r)}
              </td>
              {vals.map((v, j) => <td key={j} className={cn('whitespace-nowrap px-4 py-1.5 text-right tabular', v < -0.004 && 'text-destructive', Math.abs(v) < 0.005 && 'text-muted-foreground/50')}>{Math.abs(v) < 0.005 ? '—' : formatMoney(v)}</td>)}
              {variance && n > 1 && <td className={cn('px-4 py-1.5 text-right tabular text-xs', ch == null ? 'text-muted-foreground/50' : ch >= 0 ? 'text-success' : 'text-destructive')}>{ch == null ? '—' : `${ch >= 0 ? '+' : ''}${formatMoney(ch, undefined, 1)}%`}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
/** account rows show the account's name (translated when it is a default name); other rows are report wording */
const rowLabel = (r: Row) => (r.accountId ? td(r.label) : t(r.label))
const pctChange = (a?: number, b?: number) => (b == null || a == null || Math.abs(b) < 0.005 ? null : ((a - b) / Math.abs(b)) * 100)

function TrialBalance({ rows }: { rows: BalanceRow[] }) {
  const list = rows.filter((a) => a.is_postable && (Math.abs(num(a.opening)) + num(a.debit) + num(a.credit) > 0.004)).sort((a, b) => a.code.localeCompare(b.code))
  const tot = list.reduce((s, a) => ({ od: s.od + Math.max(num(a.opening), 0), oc: s.oc + Math.max(-num(a.opening), 0), d: s.d + num(a.debit), c: s.c + num(a.credit), cd: s.cd + Math.max(num(a.closing), 0), cc: s.cc + Math.max(-num(a.closing), 0) }),
    { od: 0, oc: 0, d: 0, c: 0, cd: 0, cc: 0 })
  const m = (v: number) => (Math.abs(v) < 0.005 ? '' : formatMoney(v))
  return (
    <table className="w-full min-w-[760px] text-[13px]">
      <thead>
        <tr className="text-muted-foreground"><th className="px-4 pt-2" colSpan={2} /><th colSpan={2} className="border-b px-4 pt-2 text-center font-medium">{t('Opening')}</th><th colSpan={2} className="border-b px-4 pt-2 text-center font-medium">{t('Period')}</th><th colSpan={2} className="border-b px-4 pt-2 text-center font-medium">{t('Closing')}</th></tr>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-4 py-2 text-left font-medium">{t('Code')}</th><th className="px-4 py-2 text-left font-medium">{t('Account')}</th>
          {[t('Debit'), t('Credit'), t('Debit'), t('Credit'), t('Debit'), t('Credit')].map((h, i) => <th key={i} className="px-4 py-2 text-right font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.account_id} className="border-b border-border/50">
            <td className="px-4 py-1.5 font-mono text-xs">{a.code}</td>
            <td className="px-4 py-1.5"><Link to={`/finance/accounts/${a.account_id}`} className="hover:underline">{td(a.name)}</Link></td>
            <td className="px-4 py-1.5 text-right tabular">{m(Math.max(num(a.opening), 0))}</td><td className="px-4 py-1.5 text-right tabular">{m(Math.max(-num(a.opening), 0))}</td>
            <td className="px-4 py-1.5 text-right tabular">{m(num(a.debit))}</td><td className="px-4 py-1.5 text-right tabular">{m(num(a.credit))}</td>
            <td className="px-4 py-1.5 text-right tabular font-medium">{m(Math.max(num(a.closing), 0))}</td><td className="px-4 py-1.5 text-right tabular font-medium">{m(Math.max(-num(a.closing), 0))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 bg-muted/40 font-semibold">
          <td className="px-4 py-2" colSpan={2}>{t('Total')} {Math.abs(tot.d - tot.c) < 0.005 && Math.abs(tot.cd - tot.cc) < 0.005 ? <span className="ml-2 text-xs font-normal text-success">{t('Balanced')}</span> : <span className="ml-2 text-xs font-normal text-destructive">{t('Not balanced')}</span>}</td>
          {[tot.od, tot.oc, tot.d, tot.c, tot.cd, tot.cc].map((v, i) => <td key={i} className="px-4 py-2 text-right tabular">{formatMoney(v)}</td>)}
        </tr>
      </tfoot>
    </table>
  )
}
