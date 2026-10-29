import { useQuery } from '@tanstack/react-query'
import { AlarmClock, ArrowRight, Boxes, ClipboardCheck, Landmark, PackageCheck, ShieldAlert, Ship, TrendingUp, TriangleAlert, Users, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/app/auth-provider'
import { useBooksCheck } from '@/features/accountant/books-check-page'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { useDashboardCards } from '@/components/layout/nav-prefs'
import { ChooseCards } from './choose-cards'
import { StockBar } from '@/components/stock-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { formatDateWith, formatNumberWith, t, td, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatCompact, formatDate, formatMoney, formatQty, humanize, num, todayISO } from '@/lib/utils'
import { useSalesOverview } from '@/features/sales/api'
import { useProcurementOverview } from '@/features/procurement/api'
import { useInventoryOverview, useLowStock } from '@/features/inventory/api'
import { StockByWarehouse } from './stock-by-warehouse'
import { LegacySales } from './legacy-sales'
import { useHistoryLive } from '@/features/history/api'
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
  // a company still selling in the old program: its receipts arrive through the live link
  const live = useHistoryLive(can('sales.read'))
  const legacy = live.data?.has_history && !num(sales.data?.invoice_count) ? live.data : null
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

  const choice = useDashboardCards()
  // every card a person may put on the dashboard; each one only when they may see what it shows
  const cards: { key: string; label: string; node: React.ReactNode }[] = []
  const add = (key: string, label: string, ok: boolean, node: React.ReactNode) => { if (ok) cards.push({ key, label, node }) }
  add('stock_value', t('Value at purchase price, without VAT'), can('inventory.read'),
    <StatCard icon={Boxes} hue="152 68%" label={t('Value at purchase price, without VAT')} value={formatMoney(inv.data?.stock_value, cur)} loading={inv.isLoading} href="/inventory/stock"
      hint={inv.data?.sales_value != null ? t('At selling price with VAT {amount}', { amount: formatMoney(inv.data.sales_value) }) : t('{n} products in stock', { n: inv.data?.active_skus ?? 0 })} />)
  add('low_stock', t('Running low'), can('inventory.read'),
    <StatCard icon={TriangleAlert} hue="32 90%" label={t('Running low')} value={inv.data?.low_stock ?? 0} tone={inv.data?.low_stock ? 'warning' : 'default'} loading={inv.isLoading} href="/inventory/alerts" hint={t('At or below the reorder point')} />)
  add('customs', t('Imports waiting for customs costs'), can('inventory.read'),
    <StatCard icon={Ship} hue="188 78%" label={t('Imports waiting for customs costs')} value={inv.data?.pending_clearance ?? 0} loading={inv.isLoading} href="/inventory/receipts" hint={t('Customs and transport costs not added yet')} />)
  add('approvals', t('Waiting for approval'), true,
    <StatCard icon={ClipboardCheck} hue="262 60%" label={t('Waiting for approval')} value={pending.data ?? 0} loading={pending.isLoading} href="/approvals" />)
  add('sales_month', legacy ? t('Sales this month (with VAT)') : t('Sales this month (without VAT)'), can('sales.read'),
    legacy ? <StatCard icon={TrendingUp} hue="204 82%" label={t('Sales this month (with VAT)')} value={formatMoney(legacy.month, cur)} href="/history"
      hint={t('{n} receipts · {pct}% gross margin without VAT · old program', { n: num(legacy.month_receipts), pct: legacy.month_cost != null && num(legacy.month_net) > 0 ? formatNumberWith(((num(legacy.month_net) - num(legacy.month_cost)) / num(legacy.month_net)) * 100, { maximumFractionDigits: 1 }) : '—' })} />
      : <StatCard icon={TrendingUp} hue="204 82%" label={t('Sales this month (without VAT)')} value={formatMoney(sales.data?.revenue, cur)} loading={sales.isLoading} href="/sales" hint={sales.data ? t('{n} invoices · {pct}% gross margin, without VAT', { n: sales.data.invoice_count, pct: sales.data.revenue > 0 ? formatNumberWith(((sales.data.revenue - sales.data.cogs) / sales.data.revenue) * 100, { maximumFractionDigits: 1 }) : '0' }) : undefined} />)
  add('overdue', t('Unpaid invoices past due (with VAT)'), can('sales.read'),
    <StatCard icon={AlarmClock} hue="354 70%" label={t('Unpaid invoices past due (with VAT)')} value={formatMoney(sales.data?.overdue_amount, cur)} loading={sales.isLoading} tone={sales.data?.overdue_count ? 'destructive' : 'default'} href="/sales/invoices" hint={t('{n} past the due date', { n: sales.data?.overdue_count ?? 0 })} />)
  add('customers_late', t('Customers late paying (with VAT)'), can('finance.read'),
    <StatCard icon={Users} hue="350 70%" label={t('Customers late paying (with VAT)')} value={formatMoney(fin.data?.ar_overdue, cur)} loading={fin.isLoading} href="/finance/receivables"
      tone={fin.data?.ar_overdue ? 'destructive' : 'default'} hint={fin.data ? t('of {amount} customers owe in total, with VAT', { amount: formatMoney(fin.data.receivables) }) : undefined} />)
  add('bills_due', t('Bills to pay soon (with VAT)'), canAp,
    <StatCard icon={Wallet} hue="32 90%" label={t('Bills to pay soon (with VAT)')} value={formatMoney((proc.data?.ap_due_7 ?? 0) + (proc.data?.ap_overdue ?? 0), cur)} loading={proc.isLoading} href="/procurement/bills"
      tone={proc.data?.ap_overdue_count ? 'destructive' : 'default'} hint={proc.data ? t('{amount} late · the rest within 7 days', { amount: formatMoney(proc.data.ap_overdue) }) : undefined} />)
  add('backlog', t('Orders to deliver and invoice (without VAT)'), can('sales.read'),
    <StatCard icon={PackageCheck} hue="204 82%" label={t('Orders to deliver and invoice (without VAT)')} value={formatMoney(sales.data?.backlog, cur)} loading={sales.isLoading} href="/sales/orders" hint={t('{n} orders confirmed this month', { n: sales.data?.orders_count ?? 0 })} />)
  add('net_profit', t('Net profit this month (without VAT)'), can('finance.read'),
    <StatCard icon={Landmark} hue="158 82%" label={t('Net profit this month (without VAT)')} value={formatMoney(fin.data?.net_profit, cur)} loading={fin.isLoading} href="/finance/reports" tone={(fin.data?.net_profit ?? 0) < 0 ? 'destructive' : 'default'} hint={t('From the accounting')} />)
  const byKey = new Map(cards.map((c) => [c.key, c]))
  // the usual eight, until the person chooses their own
  const usual = ['stock_value', 'low_stock', 'customs', 'approvals', 'sales_month', can('sales.read') ? 'overdue' : 'customers_late', 'bills_due', can('sales.read') ? 'backlog' : 'net_profit']
  const shown = (choice.cards ?? usual).filter((k) => byKey.has(k))

  const flow = (inv.data?.movements_by_day ?? []).map((d) => ({ day: shortDay(d.day), in: Number(d.value_in), out: Number(d.value_out) }))
  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0]

  return (
    <>
      <PageHeader title={greeting(firstName)} description={`${company?.name ?? ''} · ${formatDate(new Date())}`}
        actions={<ChooseCards all={cards.map((c) => ({ key: c.key, label: c.label }))} shown={shown} onSave={choice.set} />} />
      <BooksCheckBanner />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* until the person's own choice has loaded, so the cards do not jump */}
        {!choice.loaded ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[136px] rounded-xl" />)
          : shown.map((k) => <React.Fragment key={k}>{byKey.get(k)!.node}</React.Fragment>)}
      </div>

      {legacy && <LegacySales data={legacy} />}
      {can('inventory.read') && <StockByWarehouse />}

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader><CardTitle>{t('Stock in and out')}</CardTitle><CardDescription>{t('Last 30 days, at purchase price without VAT ({currency})', { currency: cur ?? '' })}</CardDescription></CardHeader>
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
          <CardHeader><CardTitle>{t('Stock value by category')}</CardTitle><CardDescription>{t('At purchase price, without VAT')}</CardDescription></CardHeader>
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
            <Button variant="ghost" size="sm" asChild><Link to="/inventory/item-card">{t('All movements')} <ArrowRight /></Link></Button>
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
                  <span className="w-28 text-right tabular text-muted-foreground" title={t('Cost, without VAT')}>{formatMoney(m.total_cost)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

/** the morning look at the books: one line when something slipped through */
function BooksCheckBanner() {
  const q = useBooksCheck()
  const n = (q.data ?? []).filter((c) => c.code !== 'guard_waved').reduce((s, c) => s + c.count, 0)
  if (!n) return null
  return (
    <Link to="/check" className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm hover:bg-warning/10">
      <ShieldAlert className="size-5 shrink-0 text-warning" />
      <span className="flex-1"><span className="font-medium">{tn(n, '{n} thing to check in the books', '{n} things to check in the books')}</span>
        <span className="text-muted-foreground"> · {t('goods without invoice, items below zero, partners without NUI…')}</span></span>
      <ArrowRight className="size-4 text-muted-foreground" />
    </Link>
  )
}
