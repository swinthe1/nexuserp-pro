import { ArrowRight, FileText, Plus } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCompact, formatMoney, formatQty, num } from '@/lib/utils'
import { useSalesOverview } from '../api'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, formatNumberWith, msg, t, td, tn } from '@/i18n'

const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const pct = (v: number, digits: number) => formatNumberWith(v, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const RANGES = {
  month: { label: msg('This month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n] } },
  last_month: { label: msg('Last month'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)] } },
  quarter: { label: msg('This quarter'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1), n] } },
  ytd: { label: msg('Year to date'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), n] } },
  last_12: { label: msg('Last 12 months'), range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 11, 1), n] } },
} as const
type RangeKey = keyof typeof RANGES

export function SalesOverviewPage() {
  const { company } = useCompany()
  const cur = company?.base_currency ?? 'ALL'
  const [rangeKey, setRangeKey] = React.useState<RangeKey>('month')
  const [from, to] = React.useMemo(() => RANGES[rangeKey].range().map(iso) as [string, string], [rangeKey])
  const ov = useSalesOverview(from, to)
  const d = ov.data
  const margin = d && d.revenue > 0 ? ((d.revenue - d.cogs) / d.revenue) * 100 : null
  const winRate = d && d.won + d.lost > 0 ? (d.won / (d.won + d.lost)) * 100 : null
  const quoteConv = d && d.quotes_sent > 0 ? (d.quotes_converted / d.quotes_sent) * 100 : null
  const months = (d?.revenue_by_month ?? []).map((m) => ({ month: formatDateWith(new Date(`${m.month}T00:00:00`), { month: 'short' }), revenue: num(m.revenue) }))
  const pipeline = d?.pipeline ?? []
  const pipeMax = Math.max(1, ...pipeline.map((p) => num(p.value)))

  return (
    <>
      <PageHeader
        title={t('Sales overview|menu')}
        description={t('Sales are counted from posted invoices minus credit notes, in {currency} without VAT.', { currency: cur })}
        actions={<>
          <Select value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
            <SelectTrigger className="w-[160px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, r]) => <SelectItem key={k} value={k}>{t(r.label)}</SelectItem>)}</SelectContent>
          </Select>
          <Can perm="sales.write">
            <Button variant="outline" asChild><Link to="/sales/quotes/new"><FileText /> {t('New quote')}</Link></Button>
            <Button asChild><Link to="/sales/orders/new"><Plus /> {t('New order')}</Link></Button>
          </Can>
        </>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Sales (without VAT)')} value={formatMoney(d?.revenue)} loading={ov.isLoading} href="/sales/invoices" hint={tn(d?.invoice_count ?? 0, '{n} invoice', '{n} invoices')} />
        <StatCard label={t('Gross margin')} value={margin == null ? '—' : `${pct(margin, 1)}%`} loading={ov.isLoading} hint={d ? t('{profit} after {cost} cost of goods, without VAT', { profit: formatMoney(d.revenue - d.cogs), cost: formatMoney(d.cogs) }) : undefined} tone={margin != null && margin < 15 ? 'warning' : 'default'} />
        <StatCard label={t('Orders taken (without VAT)')} value={formatMoney(d?.orders_value)} loading={ov.isLoading} href="/sales/orders" hint={tn(d?.orders_count ?? 0, '{n} confirmed order', '{n} confirmed orders')} />
        <StatCard label={t('Overdue invoices (with VAT)')} value={formatMoney(d?.overdue_amount)} loading={ov.isLoading} tone={d?.overdue_count ? 'destructive' : 'default'} href="/sales/invoices" hint={t('{n} past the due date', { n: d?.overdue_count ?? 0 })} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('To deliver and invoice (without VAT)')} value={formatMoney(d?.backlog)} loading={ov.isLoading} hint={t('Open orders, the part not delivered yet')} />
        <StatCard label={t('Quotes turned into orders')} value={quoteConv == null ? '—' : `${pct(quoteConv, 0)}%`} loading={ov.isLoading} href="/sales/quotes" hint={t('{done} of {sent} sent', { done: d?.quotes_converted ?? 0, sent: d?.quotes_sent ?? 0 })} />
        <StatCard label={t('Deals won')} value={winRate == null ? '—' : `${pct(winRate, 0)}%`} loading={ov.isLoading} href="/crm/pipeline" hint={t('{won} won · {lost} lost', { won: d?.won ?? 0, lost: d?.lost ?? 0 })} />
        <StatCard label={t('Open deals (without VAT)')} value={formatMoney(pipeline.reduce((s, p) => s + num(p.value), 0))} loading={ov.isLoading} href="/crm/pipeline" hint={t('{amount} expected by probability', { amount: formatMoney(pipeline.reduce((s, p) => s + num(p.weighted), 0)) })} />
      </div>

      {ov.isError && <Card className="mt-4"><ErrorState error={ov.error} onRetry={() => void ov.refetch()} /></Card>}
      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader><CardTitle>{t('Sales by month')}</CardTitle><CardDescription>{t('Last 12 months, {currency} without VAT', { currency: cur })}</CardDescription></CardHeader>
          <CardContent>
            {ov.isLoading ? <Skeleton className="h-64" /> : (
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={months} margin={{ left: -8, right: 4 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [formatMoney(v, cur), t('Sales (without VAT)')]} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle>{t('Sales pipeline')}</CardTitle><CardDescription>{t('Open deals by stage, without VAT')}</CardDescription></div>
            <Button variant="ghost" size="sm" asChild><Link to="/crm/pipeline">{t('Open board')} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            {ov.isLoading && <Skeleton className="h-48" />}
            {d && !pipeline.length && <EmptyState compact title={t('No open deals')} description={t('Deals you add in the pipeline appear here by stage.')} />}
            {pipeline.map((p) => (
              <div key={p.name} className="grid gap-1">
                <div className="flex justify-between text-[13px]"><span>{td(p.name)} <span className="text-muted-foreground">· {p.count}</span></span><span className="tabular text-muted-foreground">{formatMoney(p.value)}</span></div>
                <div className="relative h-2 rounded-full bg-muted" title={t('{amount} expected at {pct}% probability', { amount: formatMoney(p.weighted), pct: num(p.probability) })}>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: `${(num(p.value) / pipeMax) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(num(p.weighted) / pipeMax) * 100}%` }} />
                </div>
              </div>
            ))}
            {!!pipeline.length && <p className="text-xs text-muted-foreground">{t("Dark bar: the value you can expect, using each stage's probability.")}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
         <RankCard title={t('Top customers (without VAT)')} loading={ov.isLoading} rows={(d?.top_customers ?? []).map((c) => ({ key: c.id, label: c.name, href: `/partners/${c.id}`, value: num(c.revenue) }))} />
        <RankCard title={t('Top products (without VAT)')} loading={ov.isLoading} rows={(d?.top_products ?? []).map((p) => ({ key: p.sku, label: p.sku, sub: t('{name} · {qty} sold', { name: p.name, qty: formatQty(p.quantity) }), value: num(p.revenue) }))} />
        <RankCard title={t('By salesperson (without VAT)')} loading={ov.isLoading} rows={(d?.by_salesperson ?? []).map((s) => ({ key: s.name, label: s.name, sub: tn(s.invoices, '{n} invoice', '{n} invoices'), value: num(s.revenue) }))} />
      </div>
    </>
  )
}

function RankCard({ title, rows, loading }: { title: string; loading: boolean; rows: { key: string; label: string; sub?: string; href?: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {loading && <Skeleton className="h-40" />}
        {!loading && !rows.length && <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No invoiced sales in this period.')}</p>}
        {rows.map((r) => {
          const label = <span className="truncate font-medium">{r.label}</span>
          return (
            <div key={r.key} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                {r.href ? <Link to={r.href} className="min-w-0 truncate hover:underline">{label}</Link> : label}
                <span className="tabular shrink-0">{formatMoney(r.value)}</span>
              </div>
              {r.sub && <div className="truncate text-xs text-muted-foreground">{r.sub}</div>}
              <div className="h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
