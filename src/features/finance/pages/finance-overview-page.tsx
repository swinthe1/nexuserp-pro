import { ArrowDownLeft, ArrowUpRight, BookPlus, ChartColumn, Landmark, Waves } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { SignedBars, Waterfall } from '@/components/charts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Can, useCompany } from '@/app/company-provider'
import { MoreMenu } from '@/components/more-menu'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, formatNumberWith, msg, t, td, tn } from '@/i18n'
import { cn, formatMoney, num } from '@/lib/utils'
import { useFinanceOverview, useFinanceWaterfall } from '../api'

export const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
export const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const RANGES = {
  month: { label: msg('This month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n] } },
  last_month: { label: msg('Last month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] } },
  quarter: { label: msg('This quarter'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1), n] } },
  ytd: { label: msg('Year to date'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), n] } },
} as const
type RangeKey = keyof typeof RANGES

export function FinanceOverviewPage() {
  const { company, can } = useCompany()
  const cur = company?.base_currency ?? 'ALL'
  const [rangeKey, setRangeKey] = React.useState<RangeKey>('ytd')
  const [from, to] = React.useMemo(() => RANGES[rangeKey].range().map(iso) as [string, string], [rangeKey])
  const ov = useFinanceOverview(from, to)
  const d = ov.data
  const months = (d?.cash_by_month ?? []).map((m) => { const dt = new Date(`${m.month}-01T00:00:00`); return { key: m.month, label: formatDateWith(dt, { month: 'short' }), title: formatDateWith(dt, { month: 'long', year: 'numeric' }), cash: num(m.cash), profit: num(m.profit) } })
  const income = num(d?.revenue) + num(d?.other_income)
  const margin = income ? (num(d?.net_profit) / income) * 100 : null

  return (
    <>
      <PageHeader title={t('Finance overview|menu')} description={t('Figures come straight from the accounts, in {cur}. Click a number to see what is behind it.', { cur })}
        actions={<>
          <Select value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
            <SelectTrigger className="w-[150px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, r]) => <SelectItem key={k} value={k}>{t(r.label)}</SelectItem>)}</SelectContent>
          </Select>
          <MoreMenu items={[
            { label: t('Pay a vendor'), icon: ArrowUpRight, to: '/finance/payments/new?type=vendor_payment', hidden: !can('invoicing.write') },
            { label: t('Manual entry'), icon: BookPlus, to: '/finance/journal/new', hidden: !can('finance.write') },
          ]} />
          <Can perm="invoicing.write">
            <Button asChild><Link to="/finance/payments/new?type=customer_payment"><ArrowDownLeft /> {t('Receive a payment')}</Link></Button>
          </Can>
        </>} />
      {ov.isError && <Card className="mb-3"><ErrorState compact error={ov.error} onRetry={() => void ov.refetch()} /></Card>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Revenue (without VAT)')} value={formatMoney(income)} loading={ov.isLoading} href="/finance/reports?tab=pl" hint={t('Cost of goods sold {amount}, without VAT', { amount: formatMoney(d?.cogs) })} />
        <StatCard label={t('Net profit (without VAT)')} value={formatMoney(d?.net_profit)} loading={ov.isLoading} href="/finance/reports?tab=pl" tone={num(d?.net_profit) < 0 ? 'destructive' : 'default'}
          hint={margin == null ? t('No income in the period') : t('{pct}% net margin', { pct: formatNumberWith(margin, { maximumFractionDigits: 1 }) })} />
        <StatCard label={t('Cash and bank')} value={formatMoney(d?.cash)} loading={ov.isLoading} href="/finance/bank" hint={d?.unmatched_bank_lines ? tn(d.unmatched_bank_lines, '{n} bank statement line to match', '{n} bank statement lines to match') : t('Bank statements are matched')} />
        <StatCard label={t('VAT to pay')} value={formatMoney(d?.vat_due)} loading={ov.isLoading} href="/finance/reports?tab=tb" hint={t('VAT on sales minus VAT on purchases, to date')} tone={num(d?.vat_due) < 0 ? 'warning' : 'default'} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Customers owe (with VAT)')} value={formatMoney(d?.receivables)} loading={ov.isLoading} href="/finance/receivables" tone={num(d?.ar_overdue) ? 'warning' : 'default'}
          hint={num(d?.ar_overdue) ? t('{amount} overdue', { amount: formatMoney(d?.ar_overdue) }) : t('Nothing overdue')} />
        <StatCard label={t('You owe vendors (with VAT)')} value={formatMoney(d?.payables)} loading={ov.isLoading} href="/finance/payables" tone={num(d?.ap_overdue) ? 'destructive' : 'default'}
          hint={num(d?.ap_overdue) ? t('{amount} overdue', { amount: formatMoney(d?.ap_overdue) }) : t('Nothing overdue')} />
        <StatCard label={t('Stock value in the accounts (at purchase price, without VAT)')} value={formatMoney(d?.inventory)} loading={ov.isLoading} href="/inventory/stock" hint={t('Stock value plus production in progress')} />
        <StatCard label={t('Draft entries')} value={d?.draft_entries ?? 0} loading={ov.isLoading} href="/finance/journal" tone={d?.draft_entries ? 'warning' : 'default'} hint={t('Manual entries not posted yet')} />
      </div>
      <div className="mt-4"><FinanceCharts from={from} to={to} currency={cur} months={months} loading={ov.isLoading} /></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { href: '/finance/reports', title: msg('Financial statements'), text: msg('Income statement, balance sheet, cash flow and trial balance, compared across years.') },
          { href: '/finance/accounts', title: msg('Chart of accounts'), text: msg('Every account with its balance. Open one to see its movements and the documents behind them.') },
          { href: '/finance/bank', title: msg('Bank reconciliation'), text: msg('Paste a bank statement, let it match payments, and record fees in one click.') },
          { href: '/finance/assets', title: msg('Fixed assets'), text: msg('Register assets, run monthly depreciation and record disposals.') },
        ].map((l) => (
          <Link key={l.href} to={l.href} className={cn('rounded-lg border bg-card p-4 transition-colors hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring')}>
            <div className="font-medium">{t(l.title)}</div>
            <p className="mt-1 text-[13px] text-muted-foreground">{t(l.text)}</p>
          </Link>
        ))}
      </div>
    </>
  )
}

type MonthFig = { key: string; label: string; title: string; cash: number; profit: number }

/** from the sales to the profit for the period, and the profit and the money month by month (each on its own scale) */
function FinanceCharts({ from, to, currency, months, loading }: { from: string; to: string; currency: string; months: MonthFig[]; loading: boolean }) {
  const [tab, setTab] = React.useState('way')
  const wf = useFinanceWaterfall(from, to)
  const w = wf.data
  const steps = w ? [
    { name: t('Sales'), value: num(w.revenue) + num(w.other_income), kind: 'total' as const },
    { name: t('Cost of the goods sold'), value: num(w.cogs), kind: 'down' as const },
    { name: t('Gross profit'), value: num(w.revenue) + num(w.other_income) - num(w.cogs), kind: 'total' as const },
    ...w.expenses.map((e) => ({ name: e.name ? td(e.name) : t('Other costs'), value: num(e.amount), kind: (num(e.amount) >= 0 ? 'down' : 'up') as 'down' | 'up' })),
    { name: t('Net profit'), value: num(w.net_profit), kind: 'result' as const },
  ] : []
  const desc: Record<string, string> = {
    way: t('What is left of the sales after each cost, in the chosen period, without VAT.'),
    profit: t('The net profit of each month, last 12 months, without VAT.'),
    cash: t('Cash and bank at the end of each month, last 12 months.'),
  }
  return (
    <Card>
      <Tabs value={tab} onValueChange={setTab}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="grid gap-1"><CardTitle>{t('Profit and money in charts')}</CardTitle><CardDescription>{desc[tab]}</CardDescription></div>
          <TabsList>
            <TabsTrigger value="way"><Waves />{t('From sales to profit')}</TabsTrigger>
            <TabsTrigger value="profit"><ChartColumn />{t('Profit by month')}</TabsTrigger>
            <TabsTrigger value="cash"><Landmark />{t('Money by month')}</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="way" className="mt-0">
            {wf.isLoading ? <Skeleton className="h-72" /> : wf.isError ? <ErrorState compact error={wf.error} onRetry={() => void wf.refetch()} /> : <Waterfall steps={steps} currency={currency} />}
          </TabsContent>
          <TabsContent value="profit" className="mt-0">{loading ? <Skeleton className="h-56" /> : <SignedBars rows={months.map((m) => ({ ...m, value: m.profit }))} currency={currency} label={t('Net profit (without VAT)')} height={240} />}</TabsContent>
          <TabsContent value="cash" className="mt-0">{loading ? <Skeleton className="h-56" /> : <SignedBars rows={months.map((m) => ({ ...m, value: m.cash }))} currency={currency} label={t('Cash and bank')} height={240} />}</TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
