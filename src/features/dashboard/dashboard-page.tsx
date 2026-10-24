import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StockBar } from '@/components/stock-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { formatDateWith, formatNumberWith, t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatCompact, formatDate, formatMoney, formatQty, humanize, todayISO } from '@/lib/utils'
import { useSalesOverview } from '@/features/sales/api'
import { useProcurementOverview } from '@/features/procurement/api'
import { useInventoryOverview, useLowStock } from '@/features/inventory/api'
import { StockByWarehouse } from './stock-by-warehouse'
import { useFinanceOverview } from '@/features/finance/api'

const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }

function greeting(name: string) {
  const h = new Date().getHours()
  if (!name) return h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening')
  return h < 12 ? t('Good morning, {name}', { name }) : h < 18 ? t('Good afternoon, {name}', { name }) : t('Good evening, {name}', { name })
}

const shortDay = (d: string) => formatDateWith(new Date(`${d.slice(0, 10)}T00:00:00`), { day: 'numeric', month: 'short' })

export function DashboardPage() {
  const { user } = useAuth()
  const { company, companyId, can } = useCompany()
  const cur = company?.base_currency
  const inv = useInventoryOverview()
  const low = useLowStock()
  const monthStart = React.useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01` }, [])
  const sales = useSalesOverview(monthStart, todayISO(), can('sales.read'))
  const canAp = can('invoicing.read')
  const proc = useProcurementOverview(monthStart, todayISO(), canAp)
  const fin = useFinanceOverview(monthStart, todayISO(), can('finance.read'))
  const pending = useQuery({
    queryKey: ['approvals', companyId, 'count'],
    enabled: !!companyId,
    queryFn: async () => {
      const { count, error } = await supabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending')
      if (error) throw error
      return count ?? 0
    },
  })
  const recent = useQuery({
    queryKey: ['inv', companyId, 'recent-movements'],
    enabled: !!companyId && can('inventory.read'),
    queryFn: async () => unwrap(await supabase.from('v_stock_movements').select('id, movement_date, movement_type, sku, quantity, direction, total_cost, reference')
      .eq('company_id', companyId).order('movement_date', { ascending: false }).limit(8)),
  })

  // live: new orders, till sales and stock alerts refresh the numbers
  useRealtimeInvalidate('sales_orders', companyId, [['sales', companyId]])
  useRealtimeInvalidate('pos_orders', companyId, [['sales', companyId], ['inv', companyId]])
  useRealtimeInvalidate('stock_alerts', companyId, [['inv', companyId]])

  const flow = (inv.data?.movements_by_day ?? []).map((d) => ({ day: shortDay(d.day), in: Number(d.value_in), out: Number(d.value_out) }))
  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0]

  return (
    <>
      <PageHeader title={greeting(firstName)} description={`${company?.name ?? ''} · ${formatDate(new Date())}`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Stock value')} value={formatMoney(inv.data?.stock_value, cur)} loading={inv.isLoading} href="/inventory/stock" hint={t('{n} products in stock', { n: inv.data?.active_skus ?? 0 })} />
        <StatCard label={t('Running low')} value={inv.data?.low_stock ?? 0} tone={inv.data?.low_stock ? 'warning' : 'default'} loading={inv.isLoading} href="/inventory/alerts" hint={t('At or below the reorder point')} />
        <StatCard label={t('Imports waiting for customs costs')} value={inv.data?.pending_clearance ?? 0} loading={inv.isLoading} href="/inventory/receipts" hint={t('Customs and transport costs not added yet')} />
        <StatCard label={t('Waiting for approval')} value={pending.data ?? 0} loading={pending.isLoading} href="/approvals" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {can('sales.read') ? <>
          <StatCard label={t('Sales this month')} value={formatMoney(sales.data?.revenue, cur)} loading={sales.isLoading} href="/sales" hint={sales.data ? t('{n} invoices · {pct}% gross margin', { n: sales.data.invoice_count, pct: sales.data.revenue > 0 ? formatNumberWith(((sales.data.revenue - sales.data.cogs) / sales.data.revenue) * 100, { maximumFractionDigits: 1 }) : '0' }) : undefined} />
          <StatCard label={t('Unpaid invoices past due')} value={formatMoney(sales.data?.overdue_amount, cur)} loading={sales.isLoading} tone={sales.data?.overdue_count ? 'destructive' : 'default'} href="/sales/invoices" hint={t('{n} past the due date', { n: sales.data?.overdue_count ?? 0 })} />
        </> : <>
          <StatCard label={t('Sales this month')} value="" pending={t('No access')} hint={t('Needs access to sales')} />
          {can('finance.read') ? <StatCard label={t('Customers late paying')} value={formatMoney(fin.data?.ar_overdue, cur)} loading={fin.isLoading} href="/finance/receivables"
            tone={fin.data?.ar_overdue ? 'destructive' : 'default'} hint={fin.data ? t('of {amount} customers owe in total', { amount: formatMoney(fin.data.receivables) }) : undefined} />
            : <StatCard label={t('Customers late paying')} value="" pending={t('No access')} hint={t('Needs access to finance')} />}
        </>}
        {canAp ? (
          <StatCard label={t('Bills to pay soon')} value={formatMoney((proc.data?.ap_due_7 ?? 0) + (proc.data?.ap_overdue ?? 0), cur)} loading={proc.isLoading} href="/procurement/bills"
            tone={proc.data?.ap_overdue_count ? 'destructive' : 'default'}
            hint={proc.data ? t('{amount} late · the rest within 7 days', { amount: formatMoney(proc.data.ap_overdue) }) : undefined} />
        ) : <StatCard label={t('Bills to pay soon')} value="" pending={t('No access')} hint={t('Needs access to invoices and payments')} />}
        {can('sales.read') ? (
          <StatCard label={t('Orders to deliver and invoice')} value={formatMoney(sales.data?.backlog, cur)} loading={sales.isLoading} href="/sales/orders" hint={t('{n} orders confirmed this month', { n: sales.data?.orders_count ?? 0 })} />
        ) : can('finance.read') ? (
          <StatCard label={t('Net profit this month')} value={formatMoney(fin.data?.net_profit, cur)} loading={fin.isLoading} href="/finance/reports" tone={(fin.data?.net_profit ?? 0) < 0 ? 'destructive' : 'default'} hint={t('From the accounting')} />
        ) : <StatCard label={t('Net profit this month')} value="" pending={t('No access')} hint={t('Needs access to finance')} />}
      </div>

      {can('inventory.read') && <StockByWarehouse />}

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader><CardTitle>{t('Stock in and out')}</CardTitle><CardDescription>{t('Last 30 days, at cost ({currency})', { currency: cur ?? '' })}</CardDescription></CardHeader>
          <CardContent>
            {inv.isLoading ? <Skeleton className="h-64" /> : inv.isError ? <ErrorState compact error={inv.error} onRetry={() => void inv.refetch()} /> : (
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={flow} margin={{ left: -8, right: 4 }} barGap={1}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} interval={4} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, n: string) => [formatMoney(v, cur), n === 'in' ? t('Received') : t('Sent out')]} />
                    <Bar dataKey="in" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="out" fill="hsl(var(--foreground) / 0.35)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle>{t('Running low')}</CardTitle><CardDescription>{t('Available compared with the reorder point')}</CardDescription></div>
            <Button variant="ghost" size="sm" asChild><Link to="/inventory/alerts">{t('View all')} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            {low.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            {low.isError && <ErrorState compact error={low.error} onRetry={() => void low.refetch()} />}
            {low.data?.length === 0 && <EmptyState compact title={t('Nothing is running low')} description={t('Products appear here when they drop to the reorder point.')} />}
            {low.data?.slice(0, 6).map((r) => (
              <Link key={r.rule_id} to={`/inventory/products/${r.product_id}`} className="grid gap-1 rounded-md p-1 hover:bg-secondary/60">
                <div className="flex justify-between text-[13px]"><span className="truncate font-medium">{r.sku}</span><span className="text-muted-foreground">{td(r.warehouse_name)}</span></div>
                <StockBar onHand={r.available} reserved={0} min={r.min_qty} max={r.max_qty} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>{t('Stock value by category')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5">
            {inv.isLoading && <Skeleton className="h-40" />}
            {inv.data?.value_by_category.length === 0 && <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No stock yet.')}</p>}
            {inv.data?.value_by_category.map((c) => {
              const max = Math.max(...inv.data!.value_by_category.map((x) => Number(x.value)), 1)
              return (
                <div key={c.name} className="grid gap-1">
                  <div className="flex justify-between text-[13px]"><span>{td(c.name)}</span><span className="tabular text-muted-foreground">{formatMoney(c.value)}</span></div>
                  <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(Number(c.value) / max) * 100}%` }} /></div>
                </div>
              )
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t('Latest stock movements')}</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/inventory/movements">{t('All movements')} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {recent.isLoading && <div className="grid gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>}
            {recent.isError && <ErrorState compact error={recent.error} onRetry={() => void recent.refetch()} />}
            {recent.data?.length === 0 && <EmptyState compact title={t('No movements yet')} description={t('Receive goods or add opening stock to get started.')} action={<Button size="sm" asChild><Link to="/inventory/receipts/new">{t('Receive goods')}</Link></Button>} />}
            <ul className="divide-y">
              {recent.data?.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="w-24 shrink-0 text-muted-foreground">{formatDate(m.movement_date)}</span>
                  <span className="w-32 shrink-0">{humanize(m.movement_type)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.sku}</span>
                  <span className={`tabular ${Number(m.quantity) === 0 ? 'text-muted-foreground' : m.direction === 'in' ? 'text-success' : m.direction === 'out' ? 'text-destructive' : ''}`}>{Number(m.quantity) === 0 ? t('value only') : `${m.direction === 'out' ? '−' : m.direction === 'in' ? '+' : ''}${formatQty(m.quantity)}`}</span>
                  <span className="w-28 text-right tabular text-muted-foreground">{formatMoney(m.total_cost)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
