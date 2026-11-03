import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownRight, ArrowUpRight, Boxes, Clock3, Coins, Gauge, PackageX, Percent, Receipt, ShieldCheck, Target, UsersRound,
} from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from 'recharts'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { axisTick, iso, tooltipStyle } from '@/features/finance/pages/finance-overview-page'
import { useWarehouses } from '@/features/inventory/api'
import { formatDateWith, formatNumberWith, msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatCompact, formatDate, formatMoney, formatMonth, num, todayISO } from '@/lib/utils'

/** the figures of one period, as app.kpi_figures gives them (all amounts without VAT) */
type Figures = {
  sales: number; cost: number; margin: number; margin_pct: number | null; receipts: number; items: number; avg_receipt: number | null
  items_per_receipt: number | null; target: number | null; plan_pct: number | null
  losses?: number; lost?: number; found?: number; losses_pct?: number | null; stock_start?: number; stock_end?: number; turnover?: number | null
  stock_days?: number | null; hours?: number | null; sales_per_hour?: number | null; shifts?: number; voids?: number; void_amount?: number
  voids_per_shift?: number | null; cash_diff?: number; diff_shifts?: number
}
type Store = Figures & { warehouse_id: string; name: string }
type Panel = {
  from: string; to: string; warehouse_id: string | null; my_stores: string[] | null; can_set_targets: boolean
  previous: { from: string; to: string }; last_year_range: { from: string; to: string }
  now: Figures; before: Figures; last_year: Figures
  days: { date: string; sales: number; receipts: number; target: number | null }[]
  hours: { hour: number; sales: number; receipts: number }[]
  stores: Store[]
  targets: { warehouse_id: string | null; month: string; amount: number }[]
}

type Preset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year'
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: msg('Today') }, { value: 'yesterday', label: msg('Yesterday') }, { value: 'this_week', label: msg('This week') },
  { value: 'last_week', label: msg('Last week') }, { value: 'this_month', label: msg('This month') }, { value: 'last_month', label: msg('Last month') },
  { value: 'this_year', label: msg('Year to date') },
]
function presetRange(p: Preset): [string, string] {
  const n = new Date()
  const day = (d: number) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + d)
  const monday = (n.getDay() + 6) % 7
  switch (p) {
    case 'today': return [todayISO(), todayISO()]
    case 'yesterday': return [iso(day(-1)), iso(day(-1))]
    case 'this_week': return [iso(day(-monday)), todayISO()]
    case 'last_week': return [iso(day(-monday - 7)), iso(day(-monday - 1))]
    case 'this_month': return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), todayISO()]
    case 'last_month': return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]
    case 'this_year': return [iso(new Date(n.getFullYear(), 0, 1)), todayISO()]
  }
}
const ALL = '__all'
const fmt = (v: number | null | undefined, max = 2) => (v == null ? '—' : formatNumberWith(num(v), { maximumFractionDigits: max }))
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${formatNumberWith(num(v), { minimumFractionDigits: d, maximumFractionDigits: d })}%`)
const days = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1

function usePanel(from: string, to: string, warehouse: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['kpi-panel', companyId, from, to, warehouse], enabled: !!companyId, placeholderData: (p) => p,
    queryFn: async () => unwrap(await supabase.rpc('kpi_panel', { p_company: companyId!, p_from: from, p_to: to, p_warehouse: warehouse ?? undefined })) as unknown as Panel,
  })
}

/** The manager's panel: the shop's numbers against its plan and against the period before */
export function KpiPage() {
  const { company } = useCompany()
  const cur = company?.base_currency
  const [params, setParams] = useSearchParams()
  const [defFrom, defTo] = presetRange('this_month')
  const from = params.get('from') ?? defFrom
  const to = params.get('to') ?? defTo
  const store = params.get('store')
  const set = (p: Record<string, string | null>) => setParams((q) => {
    const n = new URLSearchParams(q)
    Object.entries(p).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)))
    return n
  }, { replace: true })
  const warehouses = useWarehouses()
  const q = usePanel(from, to, store)
  const k = q.data
  const [targets, setTargets] = React.useState(false)
  const preset = PRESETS.find((p) => { const [f, t2] = presetRange(p.value); return f === from && t2 === to })?.value
  const restricted = !!k?.my_stores?.length
  const stores = (warehouses.data ?? []).filter((w) => !restricted || k!.my_stores!.includes(w.id))
  const storeName = (id: string | null | undefined) => (id ? td(warehouses.data?.find((w) => w.id === id)?.name ?? '') : t('All stores'))
  const n = k?.now, b = k?.before, ly = k?.last_year
  const span = days(from, to)
  const monthly = !!k && k.previous.from.endsWith('-01') && from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7)
  const beforeLabel = monthly ? (to === iso(new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)) ? t('vs. the month before') : t('vs. the same days last month'))
    : span === 1 ? t('vs. the day before') : span <= 7 && new Date(from).getDay() === 1 ? (span === 7 ? t('vs. the week before') : t('vs. the same days last week'))
    : tn(span, 'vs. the day before', 'vs. the {n} days before')

  return (
    <>
      <PageHeader title={t('Manager\'s panel')}
        description={t('The shop\'s numbers against its plan and the period before: customers, average receipt, margin, losses, stock and the tills. Amounts without VAT.')}
        actions={k?.can_set_targets && <Button variant="outline" onClick={() => setTargets(true)}><Target /> {t('Sales targets')}</Button>} />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t('Period')}</Label>
            <Select value={preset ?? 'custom'} onValueChange={(v) => { if (v === 'custom') return; const [f, t2] = presetRange(v as Preset); set({ from: f, to: t2 }) }}>
              <SelectTrigger className="h-8 w-[150px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
              <SelectContent>{PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}<SelectItem value="custom">{t('Custom range')}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-1"><Label htmlFor="kpi-from" className="text-xs">{t('From')}</Label>
            <Input id="kpi-from" type="date" className="h-8 w-[150px]" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="kpi-to" className="text-xs">{t('To')}</Label>
            <Input id="kpi-to" type="date" className="h-8 w-[150px]" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} /></div>
          <div className="grid gap-1">
            <Label className="text-xs">{t('Store')}</Label>
            <Select value={store ?? k?.warehouse_id ?? ALL} onValueChange={(v) => set({ store: v === ALL ? null : v })}>
              <SelectTrigger className="h-8 w-[200px]" aria-label={t('Store')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {!restricted && <SelectItem value={ALL}>{t('All stores')}</SelectItem>}
                {stores.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto self-center text-[13px] text-muted-foreground">
            {k ? t('Compared with {a} – {b}', { a: formatDate(k.previous.from), b: formatDate(k.previous.to) }) : null}
          </span>
        </CardContent>
      </Card>

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !k || !n || !b || !ly ? (
        <div className="grid gap-4"><Skeleton className="h-32 rounded-xl" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[136px] rounded-xl" />)}</div></div>
      ) : (
        <div className={cn('grid gap-4 transition-opacity', q.isFetching && 'opacity-60')}>
          <PlanCard k={k} cur={cur} onSet={k.can_set_targets ? () => setTargets(true) : undefined} />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Coins} hue="158 82%" label={t('Sales')} value={formatMoney(n.sales, cur)}
              hint={<Change now={n.sales} before={b.sales} label={beforeLabel} ly={ly.sales} />} />
            <StatCard icon={UsersRound} hue="204 82%" label={t('Customers')} value={fmt(n.receipts)}
              hint={<Change now={n.receipts} before={b.receipts} label={beforeLabel} ly={ly.receipts} plain />} />
            <StatCard icon={Receipt} hue="262 70%" label={t('Average receipt')} value={formatMoney(n.avg_receipt, cur)}
              hint={<Change now={n.avg_receipt} before={b.avg_receipt} label={beforeLabel} ly={ly.avg_receipt}
                extra={n.items_per_receipt != null ? t('{n} items per receipt', { n: fmt(n.items_per_receipt, 1) }) : undefined} />} />
            <StatCard icon={Percent} hue="38 92%" label={t('Gross margin')} value={pct(n.margin_pct)}
              hint={<Change now={n.margin_pct} before={b.margin_pct} label={beforeLabel} points extra={t('{amount} after the cost of the goods', { amount: formatMoney(n.margin, cur) })} />} />
            <StatCard icon={PackageX} hue="0 72%" label={t('Losses')} value={pct(n.losses_pct, 2)} tone={num(n.losses_pct) >= 1 ? 'warning' : 'default'}
              hint={<Change now={n.losses_pct} before={b.losses_pct} label={beforeLabel} points lowerIsBetter
                extra={t('{amount} at cost: counts, damage, theft, expiry', { amount: formatMoney(n.losses, cur) })} />} />
            <StatCard icon={Boxes} hue="174 62%" label={t('Stock turnover')} value={n.turnover == null ? '—' : `${fmt(n.turnover)}×`}
              hint={n.stock_days != null ? <>{t('The stock lasts about {n} days', { n: fmt(n.stock_days) })}<br />
                {t('{amount} in stock at cost', { amount: formatMoney(n.stock_end, cur) })}</> : num(n.cost) > 0 ? t('The stock here is below zero: goods were sold before they were received')
                : t('Nothing sold from stock in this period')} />
            <StatCard icon={Clock3} hue="330 70%" label={t('Sales per hour worked')} value={n.sales_per_hour == null ? '—' : formatMoney(n.sales_per_hour, cur)}
              hint={k.warehouse_id ? t('The attendance sheet is kept for the whole company, not by store') : n.hours == null
                ? t('Fill in the attendance sheet in HR to see this')
                : <Change now={n.sales_per_hour} before={b.sales_per_hour} label={beforeLabel} extra={t('{n} hours worked', { n: fmt(n.hours, 1) })} />} />
            <StatCard icon={ShieldCheck} hue="221 70%" label={t('At the tills')} value={n.shifts ? tn(num(n.voids), '{n} void', '{n} voids') : '—'}
              hint={n.shifts ? <>{tn(num(n.shifts), '{n} shift', '{n} shifts')} · {t('{n} voids per shift', { n: fmt(n.voids_per_shift, 1) })}<br />
                {num(n.cash_diff) > 0 ? <span className="font-medium text-warning">{tn(num(n.diff_shifts), 'Cash off by {amount} in {n} shift', 'Cash off by {amount} in {n} shifts', { amount: formatMoney(n.cash_diff, cur) })}</span>
                  : t('Every drawer balanced')}</> : t('No shift closed in this period')} />
          </div>

          <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_400px]">
            <DaysChart k={k} cur={cur} />
            <HoursChart k={k} cur={cur} />
          </div>

          {!k.warehouse_id && k.stores.length > 0 && <StoresTable k={k} cur={cur} onPick={(id) => set({ store: id })} />}
          <p className="text-xs text-muted-foreground">
            {t('Customers are the receipts and invoices of the period; returns lower the sales but are not counted as customers. Losses are what stock counts and adjustments for damage, theft and expiry took out, less what they found, at cost.')}
          </p>
        </div>
      )}
      {targets && k && <TargetsDialog stores={stores} restricted={restricted} month={from.slice(0, 7)} cur={cur} storeName={storeName} onClose={() => setTargets(false)} />}
    </>
  )
}

/** a change against the period before (in % or in points), and last year's figure when there is one */
function Change({ now, before, label, ly, lowerIsBetter, points, plain, extra }: {
  now: number | null | undefined; before: number | null | undefined; label: string; ly?: number | null; lowerIsBetter?: boolean; points?: boolean; plain?: boolean; extra?: string
}) {
  const a = now == null ? null : num(now), z = before == null ? null : num(before)
  let text: string | null = null, good: boolean | null = null, up: boolean | null = null
  if (a != null && z != null) {
    if (points) {
      const d = Math.round((a - z) * 100) / 100
      text = d === 0 ? t('unchanged') : `${d > 0 ? '+' : '−'}${formatNumberWith(Math.abs(d), { maximumFractionDigits: 2 })} ${t('points|percentage')}`
      good = d === 0 ? null : (d > 0) !== !!lowerIsBetter; up = d === 0 ? null : d > 0
    } else if (z !== 0) {
      const d = Math.round(((a - z) / Math.abs(z)) * 1000) / 10
      text = d === 0 ? t('unchanged') : `${d > 0 ? '+' : '−'}${formatNumberWith(Math.abs(d), { maximumFractionDigits: 1 })}%`
      good = d === 0 ? null : (d > 0) !== !!lowerIsBetter; up = d === 0 ? null : d > 0
    }
  }
  const lyText = ly != null && num(ly) !== 0 && !points ? t('Last year: {v}', { v: plain ? fmt(ly) : formatMoney(ly) }) : null
  return (
    <span className="grid gap-0.5">
      {text && (
        <span className="flex flex-wrap items-center gap-1">
          <span className={cn('inline-flex items-center gap-0.5 font-medium', good === true && 'text-success', good === false && 'text-destructive')}>
            {up === true ? <ArrowUpRight className="size-3.5" /> : up === false ? <ArrowDownRight className="size-3.5" /> : null}{text}
          </span>
          <span>{label}</span>
        </span>
      )}
      {extra && <span>{extra}</span>}
      {lyText && <span>{lyText}</span>}
    </span>
  )
}

/** the plan: how far the period's sales are; in a month still running, where they should be by now and what each day left needs */
function PlanCard({ k, cur, onSet }: { k: Panel; cur?: string; onSet?: () => void }) {
  const n = k.now
  if (n.target == null) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Gauge className="size-5" /></span>
            <span><span className="block text-sm font-medium">{t('No sales target for this period')}</span>
              <span className="block text-[13px] text-muted-foreground">{t('Set a monthly target for each store, and the panel shows how far you are and where you should be by today.')}</span></span>
          </span>
          {onSet && <Button onClick={onSet}><Target /> {t('Set the targets')}</Button>}
        </CardContent>
      </Card>
    )
  }
  // a month still running, counted from its first day: the whole month's target, and the pace to it
  const monthEnd = iso(new Date(Number(k.from.slice(0, 4)), Number(k.from.slice(5, 7)), 0))
  const running = k.from.endsWith('-01') && k.to.slice(0, 7) === k.from.slice(0, 7) && k.to < monthEnd
  const rows = k.targets.filter((x) => x.month === k.from)
  const own = (id: string | null) => rows.filter((x) => x.warehouse_id === id).reduce((a, x) => a + num(x.amount), 0)
  const month = !running || !rows.length ? null
    : k.warehouse_id ? own(k.warehouse_id) || null : rows.some((x) => x.warehouse_id === null) ? own(null) : rows.reduce((a, x) => a + num(x.amount), 0)
  const whole = month ?? num(n.target)
  const share = Math.min(100, (100 * num(n.sales)) / whole)
  const pace = month ? Math.min(100, (100 * num(n.target)) / month) : null
  const gap = num(n.sales) - num(n.target)
  const left = days(k.to, monthEnd) - 1
  const perDay = month && left > 0 ? Math.max(0, month - num(n.sales)) / left : null
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6">
        <div>
          <div className="text-[13px] font-medium text-muted-foreground">{t('Plan reached')}</div>
          <div className={cn('tabular text-[40px] font-bold leading-none tracking-[-0.03em]', num(n.plan_pct) >= 100 && 'text-success')}>{pct(n.plan_pct)}</div>
          {month && <div className="mt-1 text-xs text-muted-foreground">{t('of what the plan asks by {date}', { date: formatDateWith(new Date(k.to), { day: 'numeric', month: 'long' }) })}</div>}
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap justify-between gap-x-4 text-[13px]">
            <span>{month ? t('{sales} of the month\'s {target}', { sales: formatMoney(n.sales, cur), target: formatMoney(month, cur) })
              : t('{sales} of a {target} target', { sales: formatMoney(n.sales, cur), target: formatMoney(n.target, cur) })}</span>
            {month && (
              <span className={cn('font-medium', gap >= 0 ? 'text-success' : 'text-destructive')}>
                {gap >= 0 ? t('{amount} ahead of the pace', { amount: formatMoney(gap, cur) }) : t('{amount} behind the pace', { amount: formatMoney(-gap, cur) })}
              </span>
            )}
          </div>
          <div className="relative h-3 rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100} aria-label={t('Plan reached')}>
            <div className="h-3 rounded-full bg-primary transition-[width] duration-500" style={{ width: `${share}%` }} />
            {pace != null && <div className="absolute -top-1 h-5 w-0.5 rounded bg-foreground" style={{ left: `calc(${pace}% - 1px)` }} title={t('Where the sales should be by today')} />}
          </div>
          {month && perDay != null && (
            <div className="text-xs text-muted-foreground">
              {num(n.sales) >= month ? t('The month\'s target is reached.')
                : tn(left, 'The line marks where the plan asks to be. {amount} a day reaches the month in the {n} day left.',
                  'The line marks where the plan asks to be. {amount} a day reaches the month in the {n} days left.', { amount: formatMoney(perDay, cur) })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DaysChart({ k, cur }: { k: Panel; cur?: string }) {
  const data = k.days.map((d) => ({ ...d, day: formatDateWith(new Date(d.date), { day: 'numeric', month: 'short' }) }))
  const hasTarget = k.days.some((d) => d.target != null)
  return (
    <Card>
      <CardHeader><CardTitle>{t('Day by day')}</CardTitle><CardDescription>{hasTarget ? t('Sales without VAT, and the day\'s share of the target') : t('Sales without VAT')}</CardDescription></CardHeader>
      <CardContent>
        {!k.days.some((d) => num(d.sales) !== 0) ? <EmptyState compact title={t('No sales in this period')} /> : (
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ left: -8, right: 4 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompact(v)} width={52} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }}
                  formatter={(v: number, name: string) => [formatMoney(v, cur), name === 'target' ? t('Target') : t('Sales')]} />
                <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                {hasTarget && <Line dataKey="target" stroke="hsl(var(--foreground))" strokeDasharray="4 3" strokeWidth={1.5} dot={false} type="stepAfter" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** the tills by the hour of the day: where more hands are needed */
function HoursChart({ k, cur }: { k: Panel; cur?: string }) {
  const by = new Map(k.hours.map((h) => [h.hour, h]))
  const first = Math.min(8, ...k.hours.map((h) => h.hour)), last = Math.max(21, ...k.hours.map((h) => h.hour))
  const data = Array.from({ length: last - first + 1 }, (_, i) => first + i).map((h) => ({ hour: `${String(h).padStart(2, '0')}`, receipts: by.get(h)?.receipts ?? 0, sales: by.get(h)?.sales ?? 0 }))
  const busiest = [...k.hours].sort((a, b) => b.receipts - a.receipts)[0]
  return (
    <Card>
      <CardHeader><CardTitle>{t('Hours of the day')}</CardTitle>
        <CardDescription>{busiest ? t('Customers at the tills by the hour; the busiest is {h}:00–{h2}:00', { h: String(busiest.hour).padStart(2, '0'), h2: String(busiest.hour + 1).padStart(2, '0') })
          : t('Customers at the tills by the hour')}</CardDescription></CardHeader>
      <CardContent>
        {!k.hours.length ? <EmptyState compact title={t('No till sales in this period')} /> : (
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ left: -16, right: 4 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={axisTick} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} labelFormatter={(h: string) => `${h}:00–${String(Number(h) + 1).padStart(2, '0')}:00`}
                  formatter={(v: number, name: string, p: { payload?: { sales: number } }) => [name === 'receipts' ? `${v} · ${formatMoney(p.payload?.sales ?? 0, cur)}` : v, t('Customers')]} />
                <Bar dataKey="receipts" fill="hsl(204 82% 48%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StoresTable({ k, cur, onPick }: { k: Panel; cur?: string; onPick: (id: string) => void }) {
  const rows = [...k.stores].sort((a, b) => num(b.sales) - num(a.sales))
  return (
    <Card>
      <CardHeader><CardTitle>{t('Stores side by side')}</CardTitle><CardDescription>{t('Open a store to see its own panel.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('Store')}</TableHead><TableHead className="text-right">{t('Sales')}</TableHead><TableHead className="text-right">{t('Plan|target')}</TableHead>
            <TableHead className="text-right">{t('Customers')}</TableHead><TableHead className="text-right">{t('Average receipt')}</TableHead>
            <TableHead className="text-right">{t('Gross margin')}</TableHead><TableHead className="text-right">{t('Losses')}</TableHead>
            <TableHead className="text-right">{t('Voids')}</TableHead><TableHead className="text-right">{t('Cash off')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.warehouse_id} className="cursor-pointer" onClick={() => onPick(s.warehouse_id)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onPick(s.warehouse_id) }}>
                <TableCell className="font-medium">{td(s.name)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(s.sales, cur)}</TableCell>
                <TableCell className={cn('whitespace-nowrap text-right tabular', s.plan_pct != null && num(s.plan_pct) >= 100 && 'text-success')}>{pct(s.plan_pct)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{fmt(s.receipts)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(s.avg_receipt)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{pct(s.margin_pct)}</TableCell>
                <TableCell className={cn('whitespace-nowrap text-right tabular', num(s.losses_pct) >= 1 && 'text-warning')}>{pct(s.losses_pct, 2)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{num(s.voids)}</TableCell>
                <TableCell className={cn('whitespace-nowrap text-right tabular', num(s.cash_diff) > 0 && 'text-warning')}>{formatMoney(s.cash_diff)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** the monthly sales targets: one per store, and one for the whole company if you want */
function TargetsDialog({ stores, restricted, month: initial, cur, storeName, onClose }: {
  stores: { id: string; name: string }[]; restricted: boolean; month: string; cur?: string; storeName: (id: string | null) => string; onClose: () => void
}) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [month, setMonth] = React.useState(initial)
  const first = `${month}-01`
  const saved = useQuery({
    queryKey: ['sales-targets', companyId, first], enabled: !!companyId && /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => unwrap(await supabase.from('sales_targets').select('warehouse_id, amount').eq('company_id', companyId!).eq('month', first)),
  })
  const rows: (string | null)[] = [...(restricted ? [] : [null]), ...stores.map((s) => s.id)]
  const [values, setValues] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    if (!saved.data) return
    setValues(Object.fromEntries(rows.map((id) => [id ?? ALL, String(saved.data.find((r) => r.warehouse_id === id)?.amount ?? '')])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data])
  const save = useMutation({
    mutationFn: async () => {
      for (const id of rows) {
        const was = saved.data?.find((r) => r.warehouse_id === id)?.amount ?? null
        const v = values[id ?? ALL]?.trim() ?? ''
        const amount = v === '' ? 0 : Number(v.replace(',', '.'))
        if (Number.isNaN(amount) || amount < 0) throw new Error(t('Enter an amount for {store}', { store: storeName(id) }))
        if ((was == null && amount === 0) || num(was) === amount) continue
        unwrap(await supabase.rpc('kpi_target_save', { p_company: companyId!, p_warehouse: id as string /* null: the whole company */, p_month: first, p_amount: amount }))
      }
    },
    onSuccess: () => {
      toast.success(t('Targets saved for {month}', { month: formatMonth(first) }))
      void qc.invalidateQueries({ queryKey: ['kpi-panel', companyId] }); void qc.invalidateQueries({ queryKey: ['sales-targets', companyId] }); onClose()
    },
    onError: (e) => toast.error(describeError(e)),
  })
  const storeSum = stores.reduce((s, w) => s + num(values[w.id]), 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Sales targets')}</DialogTitle>
          <DialogDescription>{t('Sales without VAT the month should reach. The panel spreads each month over its days. Leave the company empty and it adds up the stores.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="kpi-month" className="text-xs">{t('Month')}</Label>
          <Input id="kpi-month" type="month" className="w-[180px]" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        {saved.isLoading ? <Skeleton className="h-40" /> : saved.isError ? <ErrorState compact error={saved.error} onRetry={() => void saved.refetch()} /> : (
          <div className="grid gap-2">
            {rows.map((id) => (
              <div key={id ?? ALL} className="grid grid-cols-[minmax(0,1fr)_160px] items-center gap-3">
                <Label htmlFor={`kpi-t-${id ?? ALL}`} className="truncate text-sm font-normal">{id ? storeName(id) : <span className="font-medium">{t('The whole company')}</span>}</Label>
                <Input id={`kpi-t-${id ?? ALL}`} inputMode="decimal" className="text-right tabular" value={values[id ?? ALL] ?? ''}
                  placeholder={id ? '0' : storeSum ? formatMoney(storeSum) : '0'} onChange={(e) => setValues((v) => ({ ...v, [id ?? ALL]: e.target.value }))} />
              </div>
            ))}
            {stores.length > 1 && <div className="text-right text-xs text-muted-foreground">{t('The stores add up to {amount}', { amount: formatMoney(storeSum, cur) })}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!saved.data} onClick={() => save.mutate()}>{t('Save targets')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
