import { MapPinned, Route as RouteIcon, Truck } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, msg, t, tn, tServer } from '@/i18n'
import { formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useLogisticsOverview, useRoutes, type RouteRow } from '../api'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const RANGES = {
  week: { label: msg('Last 7 days'), from: () => new Date(Date.now() - 6 * 864e5) },
  month: { label: msg('This month'), from: () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) } },
  quarter: { label: msg('Last 90 days'), from: () => new Date(Date.now() - 89 * 864e5) },
} as const
const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${num(v).toFixed(num(v) % 1 ? 1 : 0)}%`)

export function routeLoad(r: RouteRow) {
  const kg = r.stops.reduce((s, x) => s + num(x.shipment?.weight_kg), 0)
  const done = r.stops.filter((x) => !['pending', 'arrived'].includes(x.status)).length
  return { kg, done, total: r.stops.length, cap: r.vehicle?.capacity_kg ? num(r.vehicle.capacity_kg) : null }
}

export function LoadBar({ kg, cap }: { kg: number; cap: number | null }) {
  if (!cap) return <span className="text-xs text-muted-foreground tabular">{formatQty(kg)} kg</span>
  const p = Math.min(100, (kg / cap) * 100)
  return (
    <div className="min-w-28">
      <div className="mb-1 flex justify-between text-xs tabular text-muted-foreground"><span>{formatQty(Math.round(kg * 10) / 10)} kg</span><span>{t('of {n}', { n: formatQty(cap) })}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={p > 90 ? 'h-full rounded-full bg-warning' : 'h-full rounded-full bg-primary'} style={{ width: `${p}%` }} /></div>
    </div>
  )
}

export function LogisticsOverviewPage() {
  const { company } = useCompany()
  const [range, setRange] = React.useState<keyof typeof RANGES>('month')
  const from = iso(RANGES[range].from()); const to = todayISO()
  const ov = useLogisticsOverview(from, to)
  const today = useRoutes(todayISO())
  const d = ov.data
  const days = (d?.by_day ?? []).map((x) => ({ day: formatDateWith(new Date(`${x.day}T00:00:00`), { day: 'numeric', month: 'short' }), delivered: num(x.delivered) }))
  return (
    <>
      <PageHeader title={t('Logistics overview')} description={t('What is waiting to go out, what is on the road and how deliveries are going.')}
        actions={<>
          <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}><SelectTrigger className="w-[150px]" aria-label={t('Period')}><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(RANGES).map(([k, r]) => <SelectItem key={k} value={k}>{t(r.label)}</SelectItem>)}</SelectContent></Select>
          <Can perm="logistics.write"><Button asChild><Link to="/logistics/planning"><MapPinned /> {t('Plan deliveries')}</Link></Button></Can>
        </>} />
      {ov.isError && <Card className="mb-3"><ErrorState compact error={ov.error} onRetry={() => void ov.refetch()} /></Card>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('To dispatch')} value={d?.to_dispatch ?? 0} loading={ov.isLoading} href="/logistics/planning" tone={d?.to_dispatch ? 'warning' : 'default'}
          hint={t('Picked deliveries and shipments not on a route yet')} />
        <StatCard label={t('On the road')} value={d?.in_transit ?? 0} loading={ov.isLoading} href="/logistics/shipments" hint={tn(d?.routes_today ?? 0, '{n} route today', '{n} routes today')} />
        <StatCard label={t('Delivered')} value={d?.delivered ?? 0} loading={ov.isLoading} hint={t('{pct} by the day after shipping', { pct: pct(d?.on_time_pct) })} />
        <StatCard label={t('Delivered first time')} value={pct(d?.first_attempt_pct)} loading={ov.isLoading} tone={d?.first_attempt_pct !== null && d?.first_attempt_pct !== undefined && num(d.first_attempt_pct) < 90 ? 'warning' : 'default'}
          hint={tn(d?.failed ?? 0, '{n} failed attempt in the period', '{n} failed attempts in the period')} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <StatCard label={t('Cash on delivery to settle')} value={formatMoney(d?.cod_to_settle, company?.base_currency)} loading={ov.isLoading} href="/logistics/shipments?cod=collected"
          tone={num(d?.cod_to_settle) > 0 ? 'warning' : 'default'} hint={t('Collected by drivers, not yet in the cash box')} />
        <StatCard label={t('Cash on delivery still out')} value={formatMoney(d?.cod_outstanding, company?.base_currency)} loading={ov.isLoading}
          hint={t('On parcels that are not delivered yet')} />
      </div>

      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t("Today's routes")}</CardTitle><CardDescription>{t("Stops done and the load against each vehicle's capacity.")}</CardDescription></CardHeader>
          <CardContent className="p-0">
            {today.isLoading ? <Skeleton className="m-4 h-28" /> : !today.data?.length ? (
              <EmptyState compact icon={RouteIcon} title={t('No routes today')} description={t('Plan one from the delivery planning board.')} />
            ) : (
              <div className="divide-y">{today.data.map((r) => {
                const l = routeLoad(r)
                return (
                  <Link key={r.id} to={`/logistics/routes/${r.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 hover:bg-secondary/50">
                    <div className="min-w-44 flex-1">
                      <div className="flex items-center gap-2"><span className="font-medium">{r.number}</span><StatusBadge status={r.status} /></div>
                      <div className="text-xs text-muted-foreground">{r.vehicle ? `${r.vehicle.name} · ${r.vehicle.plate_number}` : t('No vehicle')} · {r.driver?.full_name ?? t('No driver')}</div>
                    </div>
                    <div className="w-36">
                      <div className="mb-1 text-xs tabular text-muted-foreground">{t('{done} of {total} stops', { done: l.done, total: l.total })}</div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${l.total ? (l.done / l.total) * 100 : 0}%` }} /></div>
                    </div>
                    <LoadBar kg={l.kg} cap={l.cap} />
                  </Link>
                )
              })}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>{t('Deliveries per day')}</CardTitle><CardDescription>{t(RANGES[range].label)}</CardDescription></CardHeader>
          <CardContent>
            {ov.isLoading ? <Skeleton className="h-48" /> : !days.length ? <p className="py-12 text-center text-[13px] text-muted-foreground">{t('Nothing delivered in this period.')}</p> : (
              <div className="h-48"><ResponsiveContainer><BarChart data={days} margin={{ left: -16, right: 4 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [v, t('Delivered')]} />
                <Bar dataKey="delivered" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle>{t('By carrier')}</CardTitle><CardDescription>{t('Shipments that left in the period.')}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {ov.isLoading ? <Skeleton className="m-4 h-24" /> : !d?.by_carrier.length ? <EmptyState compact icon={Truck} title={t('No shipments in this period')} /> : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Carrier')}</TableHead><TableHead className="text-right">{t('Shipments')}</TableHead>
                <TableHead className="text-right">{t('Delivered')}</TableHead><TableHead className="text-right">{t('Failed now')}</TableHead><TableHead className="text-right">{t('Average days to deliver')}</TableHead></TableRow></TableHeader>
              <TableBody>{d.by_carrier.map((c) => (
                <TableRow key={c.carrier} className="hover:bg-transparent">
                  <TableCell className="font-medium">{tServer(c.carrier)}</TableCell>
                  <TableCell className="text-right tabular">{c.shipments}</TableCell>
                  <TableCell className="text-right tabular">{c.delivered}</TableCell>
                  <TableCell className="text-right tabular">{c.failed || '—'}</TableCell>
                  <TableCell className="text-right tabular">{c.avg_days === null ? '—' : num(c.avg_days).toFixed(1)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
