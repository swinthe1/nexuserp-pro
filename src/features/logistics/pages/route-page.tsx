import { ArrowDown, ArrowUp, Check, CircleSlash, Flag, MapPin, Navigation, Play, Printer, X } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { printHtml } from '@/lib/print'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { logKeys, useCompleteRoute, useReorderRoute, useRoute, useStartRoute, type RouteRow, type StopRow } from '../api'
import { OutcomeDialog } from '../components/dialogs'
import { LoadBar, routeLoad } from './logistics-overview-page'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function printSheet(r: RouteRow, company: string) {
  const rows = r.stops.map((s) => `<tr><td class="n">${s.sequence}</td><td><b>${esc(s.shipment?.partner?.name)}</b><br>${esc(s.address_text)}</td>
    <td>${esc(s.shipment?.number)}</td><td class="r">${s.shipment?.packages ?? ''}</td><td class="r">${formatQty(s.shipment?.weight_kg)}</td>
    <td class="r">${num(s.shipment?.cod_amount) ? formatMoney(s.shipment?.cod_amount) : ''}</td><td class="sig"></td></tr>`).join('')
  const cod = r.stops.reduce((t, s) => t + num(s.shipment?.cod_amount), 0)
  printHtml(`<h1>${esc(t('Route {number}', { number: r.number }))} · ${formatDate(r.route_date)}</h1>
    <p>${esc(company)} · ${esc(t('from {place}', { place: td(r.warehouse?.name) }))} · ${esc(r.vehicle ? `${r.vehicle.name} ${r.vehicle.plate_number}` : t('No vehicle'))} · ${esc(t('Driver'))}: ${esc(r.driver?.full_name ?? '—')}</p>
    <table><thead><tr><th>#</th><th>${esc(t('Customer and address'))}</th><th>${esc(t('Shipment'))}</th><th class="r">${esc(t('Parcels'))}</th><th class="r">kg</th><th class="r">${esc(t('Cash to collect'))}</th><th>${esc(t('Signature'))}</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="tot">${esc(t('Cash to collect'))}: <b>${formatMoney(cod)}</b> · ${esc(t('km at start'))}: ________ · ${esc(t('km at end'))}: ________</p>`,
  `body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:18px;margin:0 0 4px}p{color:#444}table{width:100%;border-collapse:collapse;margin-top:12px}
   th,td{border-bottom:1px solid #ccc;padding:8px 6px;text-align:left;vertical-align:top}th{font-size:11px;color:#555}.r{text-align:right}.n{width:20px;font-weight:600}
   .sig{width:120px}.tot{margin-top:16px}`)
}

export function RoutePage() {
  const { id } = useParams()
  const { company, can } = useCompany()
  const q = useRoute(id)
  const start = useStartRoute()
  const reorder = useReorderRoute()
  const [outcome, setOutcome] = React.useState<React.ComponentProps<typeof OutcomeDialog>['target']>(null)
  const [complete, setComplete] = React.useState(false)
  const { companyId } = useCompany()
  useRealtimeInvalidate('route_stops', companyId, [logKeys.all(companyId)])
  useRealtimeInvalidate('delivery_routes', companyId, [logKeys.all(companyId)])
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const r = q.data
  if (!r) return <EmptyState title={t('Route not found')} action={<Link to="/logistics/planning" className="text-sm text-primary hover:underline">{t('Back to planning')}</Link>} />
  const l = routeLoad(r)
  const write = can('logistics.write')
  const cod = r.stops.reduce((t, s) => t + num(s.shipment?.cod_amount), 0)
  const codCollected = r.stops.reduce((t, s) => t + (s.shipment?.cod_collected ? num(s.shipment.cod_amount) : 0), 0)
  const allDone = r.stops.every((s) => !['pending', 'arrived'].includes(s.status))
  const move = (i: number, d: -1 | 1) => {
    const ids = r.stops.map((s) => s.id); const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorder.mutate({ route: r.id, stops: ids })
  }
  return (
    <>
      <PageHeader back={{ href: '/logistics/planning', label: t('Delivery planning') }} title={r.number} meta={<StatusBadge status={r.status} />}
        description={<>{formatDate(r.route_date)} · {r.vehicle ? `${r.vehicle.name} · ${r.vehicle.plate_number}` : t('No vehicle')} · {r.driver?.full_name ?? t('No driver')} · {t('from {place}', { place: td(r.warehouse?.name) })}</>}
        actions={<>
          <Button variant="outline" onClick={() => printSheet(r, company?.name ?? '')}><Printer /> {t('Driver sheet')}</Button>
          <Can perm="logistics.write">
            {r.status === 'planned' && <Button disabled={!r.stops.length} loading={start.isPending}
              onClick={async () => { const n = await start.mutateAsync(r.id); toast.success(tn(n, 'Route started: {n} shipment out for delivery', 'Route started: {n} shipments out for delivery')) }}><Play /> {t('Start route')}</Button>}
            {r.status === 'in_progress' && <Button disabled={!allDone} onClick={() => setComplete(true)}><Flag /> {t('Complete route')}</Button>}
          </Can>
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-[13px] text-muted-foreground">{t('Stops')}</div><div className="text-xl font-semibold tabular">{l.done} / {l.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="mb-1 text-[13px] text-muted-foreground">{t('Load')}</div><LoadBar kg={l.kg} cap={l.cap} /></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[13px] text-muted-foreground">{t('Cash on delivery')}</div>
          {cod ? <><div className="text-xl font-semibold tabular">{formatMoney(codCollected)}</div><div className="text-xs text-muted-foreground">{t('of {amount} collected', { amount: formatMoney(cod) })}</div></>
            : <><div className="text-xl font-semibold">{t('None')}</div><div className="text-xs text-muted-foreground">{t('Every stop is already paid')}</div></>}</CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[13px] text-muted-foreground">{t('Distance')}</div>
          <div className="text-xl font-semibold tabular">{r.actual_distance_km ? `${formatQty(r.actual_distance_km)} km` : r.planned_distance_km ? `~${formatQty(r.planned_distance_km)} km` : '—'}</div>
          <div className="text-xs text-muted-foreground">{r.actual_distance_km ? t('planned {km} km', { km: formatQty(r.planned_distance_km) }) : t('planned')}</div></CardContent></Card>
      </div>

      {!r.stops.length ? <Card><EmptyState compact icon={MapPin} title={t('No stops on this route')} description={t('Add shipments from the planning board.')} action={<Button variant="outline" size="sm" asChild><Link to="/logistics/planning">{t('Open the planning board')}</Link></Button>} /></Card> : (
        <ol className="grid gap-2">{r.stops.map((s, i) => (
          <StopCard key={s.id} stop={s} index={i} count={r.stops.length} routeStatus={r.status} canWrite={write} busy={reorder.isPending}
            onMove={(d) => move(i, d)}
            onOutcome={(o) => s.shipment && setOutcome({ kind: 'stop', id: s.id, number: s.shipment.number, outcome: o, cod: s.shipment.cod_collected ? 0 : num(s.shipment.cod_amount), partner: s.shipment.partner?.name })} />
        ))}</ol>
      )}
      {r.notes && <p className="mt-4 text-[13px] text-muted-foreground">{r.notes}</p>}
      <OutcomeDialog target={outcome} onClose={() => setOutcome(null)} />
      {complete && <CompleteDialog route={r} onClose={() => setComplete(false)} />}
    </>
  )
}

function StopCard({ stop: s, index, count, routeStatus, canWrite, busy, onMove, onOutcome }: {
  stop: StopRow; index: number; count: number; routeStatus: string; canWrite: boolean; busy: boolean
  onMove: (d: -1 | 1) => void; onOutcome: (o: 'delivered' | 'failed' | 'skipped') => void
}) {
  const open = ['pending', 'arrived'].includes(s.status)
  const maps = s.latitude && s.longitude ? `https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address_text)}`
  return (
    <li className={cn('rounded-lg border bg-card p-3 sm:p-4', !open && 'bg-muted/30')}>
      <div className="flex items-start gap-3">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular',
          s.status === 'delivered' ? 'bg-success/15 text-success' : s.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary')}>
          {s.status === 'delivered' ? <Check className="size-4" /> : s.status === 'failed' ? <X className="size-4" /> : s.sequence}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{s.shipment?.partner?.name ?? t('Stop')}</span>
            {!open && <StatusBadge status={s.status} />}
            {num(s.shipment?.cod_amount) > 0 && (
              <Badge variant={s.shipment?.cod_collected ? 'success' : 'warning'}>{s.shipment?.cod_collected ? t('Cash collected') : t('Collect {amount}', { amount: formatMoney(s.shipment?.cod_amount) })}</Badge>
            )}
          </div>
          <a href={maps} target="_blank" rel="noreferrer" className="mt-0.5 flex items-start gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <Navigation className="mt-0.5 size-3.5 shrink-0" /><span>{s.address_text}</span>
          </a>
          <div className="mt-1 text-xs text-muted-foreground">
            {s.shipment && <Link to={`/logistics/shipments/${s.shipment.id}`} className="hover:underline">{s.shipment.number}</Link>}
            {' · '}{tn(s.shipment?.packages ?? 1, '{n} parcel', '{n} parcels')} · {formatQty(Math.round(num(s.shipment?.weight_kg) * 10) / 10)} kg
            {s.actual_arrival ? ` · ${formatDate(s.actual_arrival, true)}` : ''}
          </div>
          {s.outcome_note && <p className="mt-1 text-[13px]">{s.outcome_note}</p>}
        </div>
        {routeStatus === 'planned' && canWrite && (
          <div className="flex flex-col gap-1">
            <Button size="icon-sm" variant="ghost" disabled={index === 0 || busy} onClick={() => onMove(-1)} aria-label={t('Move up')}><ArrowUp /></Button>
            <Button size="icon-sm" variant="ghost" disabled={index === count - 1 || busy} onClick={() => onMove(1)} aria-label={t('Move down')}><ArrowDown /></Button>
          </div>
        )}
      </div>
      {routeStatus === 'in_progress' && open && canWrite && (
        <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
          <Button className="h-11" onClick={() => onOutcome('delivered')}><Check /> {t('Delivered')}</Button>
          <Button className="h-11" variant="outline" onClick={() => onOutcome('failed')}><X /> {t('Not delivered')}</Button>
          <Button className="h-11" variant="ghost" onClick={() => onOutcome('skipped')} aria-label={t('Skip this stop')}><CircleSlash /> {t('Skip')}</Button>
        </div>
      )}
    </li>
  )
}

function CompleteDialog({ route, onClose }: { route: RouteRow; onClose: () => void }) {
  const done = useCompleteRoute()
  const [km, setKm] = React.useState(route.planned_distance_km ? String(route.planned_distance_km) : '')
  const failed = route.stops.filter((s) => s.status !== 'delivered').length
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Complete {number}', { number: route.number })}</DialogTitle>
          <DialogDescription>{failed ? tn(failed, '{n} stop was not delivered; it goes back to the planning board to be rescheduled.', '{n} stops were not delivered; they go back to the planning board to be rescheduled.') : t('Every stop was delivered.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="km">{t('Kilometres driven')}</Label>
          <Input id="km" type="number" min={0} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={done.isPending} onClick={async () => { await done.mutateAsync({ route: route.id, km: num(km) || null }); toast.success(t('{number} completed', { number: route.number })); onClose() }}>
            {t('Complete route')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
