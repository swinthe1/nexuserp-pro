import { ArrowDownLeft, ArrowUpRight, BookPlus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can, useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, formatNumberWith, msg, t, tn } from '@/i18n'
import { cn, formatCompact, formatMoney, num } from '@/lib/utils'
import { useFinanceOverview } from '../api'

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
  const { company } = useCompany()
  const cur = company?.base_currency ?? 'ALL'
  const [rangeKey, setRangeKey] = React.useState<RangeKey>('ytd')
  const [from, to] = React.useMemo(() => RANGES[rangeKey].range().map(iso) as [string, string], [rangeKey])
  const ov = useFinanceOverview(from, to)
  const d = ov.data
  const months = (d?.cash_by_month ?? []).map((m) => ({ month: formatDateWith(new Date(`${m.month}-01T00:00:00`), { month: 'short' }), cash: num(m.cash), profit: num(m.profit) }))
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
          <Can perm="finance.write"><Button variant="outline" asChild><Link to="/finance/journal/new"><BookPlus /> {t('Manual entry')}</Link></Button></Can>
          <Can perm="invoicing.write">
            <Button variant="outline" asChild><Link to="/finance/payments/new?type=vendor_payment"><ArrowUpRight /> {t('Pay a vendor')}</Link></Button>
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
      <Card className="mt-4">
        <CardHeader><CardTitle>{t('Cash and profit by month')}</CardTitle><CardDescription>{t('Cash and bank at the end of each month (bars, left scale) and the month’s net profit without VAT (line, right scale), last 12 months')}</CardDescription></CardHeader>
        <CardContent>
          {ov.isLoading ? <Skeleton className="h-72" /> : (
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={months} margin={{ left: -8, right: 4 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="cash" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={56} />
                  <YAxis yAxisId="profit" orientation="right" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }}
                    formatter={(v: number, n: string) => [formatMoney(v, cur), n === 'cash' ? t('Cash and bank') : t('Net profit (without VAT)')]} />
                  <Bar yAxisId="cash" dataKey="cash" fill="hsl(var(--primary) / 0.35)" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="profit" dataKey="profit" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
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
