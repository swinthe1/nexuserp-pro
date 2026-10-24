import { ArrowRight, MapPin, PackagePlus, Plus, Route as RouteIcon, Truck, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import {
  logKeys, useAssignToRoute, useCreateRoute, useDispatchQueue, useDrivers, useRemoveFromRoute, useRoutes, useVehicles, type QueueRow, type RouteRow,
} from '../api'
import { CreateShipmentDialog, ShipWithCarrierDialog } from '../components/dialogs'
import { LoadBar, routeLoad } from './logistics-overview-page'

export function PlanningPage() {
  const { can, companyId } = useCompany()
  useRealtimeInvalidate('shipments', companyId, [logKeys.all(companyId)])
  useRealtimeInvalidate('delivery_routes', companyId, [logKeys.all(companyId)])
  useRealtimeInvalidate('deliveries', companyId, [logKeys.all(companyId)])
  const [date, setDate] = React.useState(todayISO())
  const queue = useDispatchQueue()
  const routes = useRoutes(date)
  const [selected, setSelected] = React.useState<string[]>([])
  const [newShipment, setNewShipment] = React.useState<QueueRow | null>(null)
  const [carrierFor, setCarrierFor] = React.useState<{ id: string; number: string } | null>(null)
  const [newRoute, setNewRoute] = React.useState(false)
  const [assignError, setAssignError] = React.useState<string | null>(null)
  const assign = useAssignToRoute()
  const write = can('logistics.write')

  const rows = queue.data ?? []
  const shipmentsById = new Map(rows.filter((r) => r.kind === 'shipment').map((r) => [r.id!, r]))
  React.useEffect(() => { setSelected((s) => s.filter((id) => shipmentsById.has(id))) }, [queue.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = React.useMemo(() => {
    const m = new Map<string, QueueRow[]>()
    for (const r of rows) { const k = r.city?.trim() || ''; m.set(k, [...(m.get(k) ?? []), r]) }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
  }, [rows])
  const selKg = selected.reduce((s, id) => s + num(shipmentsById.get(id)?.weight_kg), 0)
  const plannedRoutes = (routes.data ?? []).filter((r) => r.status === 'planned')
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))

  const addTo = async (route: RouteRow) => {
    setAssignError(null)
    try {
      const n = await assign.mutateAsync({ route: route.id, shipments: selected })
      toast.success(tn(n, '{n} shipment added to {route}', '{n} shipments added to {route}', { route: route.number })); setSelected([])
    } catch (e) { setAssignError(describeError(e)) }
  }

  return (
    <>
      <PageHeader title={t('Delivery planning')} description={t('Turn picked deliveries into shipments, then put them on a van or hand them to a carrier.')}
        actions={<>
          <div className="flex items-center gap-2"><Label htmlFor="plan-date" className="text-muted-foreground">{t('Routes for')}</Label>
            <Input id="plan-date" type="date" className="w-[160px]" value={date} min={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
          <Can perm="logistics.write"><Button onClick={() => setNewRoute(true)}><Plus /> {t('New route')}</Button></Can>
        </>} />

      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle>{t('Waiting to go out')}</CardTitle>
            <CardDescription>{t('Deliveries without a shipment, and shipments not on a route yet, by city.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {queue.isLoading ? <Skeleton className="m-4 h-60" /> : queue.isError ? <ErrorState compact error={queue.error} onRetry={() => void queue.refetch()} /> : !rows.length ? (
              <EmptyState compact icon={Truck} title={t('Nothing waiting')} description={t('Picked deliveries appear here once the warehouse has them ready.')} />
            ) : groups.map(([city, items]) => (
              <section key={city} className="border-t first:border-t-0">
                <div className="flex items-center justify-between bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" />{city || t('No city')}</span>
                  <span className="tabular">{formatQty(Math.round(items.reduce((s, r) => s + num(r.weight_kg), 0) * 10) / 10)} kg</span>
                </div>
                <ul className="divide-y">{items.map((r) => (
                  <li key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    {r.kind === 'shipment' && write
                      ? <Checkbox checked={selected.includes(r.id!)} onCheckedChange={(v) => toggle(r.id!, !!v)} aria-label={t('Select {number}', { number: r.number })} />
                      : <span className="size-4" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {r.kind === 'shipment'
                          ? <Link to={`/logistics/shipments/${r.id}`} className="font-medium hover:underline">{r.number}</Link>
                          : <Link to={`/sales/deliveries/${r.id}`} className="font-medium hover:underline">{r.number}</Link>}
                        <span className="truncate">{r.partner}</span>
                        {r.kind === 'delivery' ? <Badge variant="secondary">{t('No shipment yet')}</Badge> : <StatusBadge status={r.status} />}
                        {num(r.cod_amount) > 0 && <Badge variant="warning">{t('Cash on delivery {amount}', { amount: formatMoney(r.cod_amount) })}</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.address ?? t('No address')}{r.scheduled_date ? ` · ${t('for {date}', { date: formatDate(r.scheduled_date) })}` : ''}{r.kind === 'shipment' && r.delivery_number ? ` · ${r.delivery_number}` : ''}
                      </div>
                    </div>
                    <span className="hidden w-16 text-right text-xs tabular text-muted-foreground sm:block">{r.weight_kg ? `${formatQty(Math.round(num(r.weight_kg) * 10) / 10)} kg` : '—'}</span>
                    <Can perm="logistics.write">{r.kind === 'delivery'
                      ? <Button size="sm" variant="outline" onClick={() => setNewShipment(r)}><PackagePlus /> {t('Create shipment')}</Button>
                      : <Button size="sm" variant="ghost" onClick={() => setCarrierFor({ id: r.id!, number: r.number! })}>{t('Carrier')}</Button>}</Can>
                  </li>
                ))}</ul>
              </section>
            ))}
          </CardContent>
          {write && selected.length > 0 && (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card px-4 py-3">
              <span className="text-[13px]"><span className="font-medium">{t('{n} selected', { n: selected.length })}</span> · {formatQty(Math.round(selKg * 10) / 10)} kg</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}><X /> {t('Clear')}</Button>
                {plannedRoutes.map((r) => <Button key={r.id} size="sm" variant="outline" loading={assign.isPending} onClick={() => void addTo(r)}>{t('Add to {route}', { route: r.number })}</Button>)}
                <Button size="sm" onClick={() => setNewRoute(true)}><Plus /> {t('New route')}</Button>
              </div>
              {assignError && <p role="alert" className="basis-full text-[13px] text-destructive">{assignError}</p>}
            </div>
          )}
        </Card>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t('Routes on {date}', { date: formatDate(date) })}</h2>
          {routes.isLoading ? <Skeleton className="h-40" /> : routes.isError ? <Card><ErrorState compact error={routes.error} onRetry={() => void routes.refetch()} /></Card> : !routes.data?.length ? (
            <Card><EmptyState compact icon={RouteIcon} title={t('No routes this day')} description={t('Select shipments on the left and create a route for a van and driver.')} /></Card>
          ) : routes.data.map((r) => <RouteCard key={r.id} route={r} />)}
        </div>
      </div>

      <CreateShipmentDialog delivery={newShipment && { id: newShipment.id!, number: newShipment.number!, partner: newShipment.partner }} onClose={() => setNewShipment(null)} />
      <ShipWithCarrierDialog shipment={carrierFor} onClose={() => setCarrierFor(null)} />
      {newRoute && <NewRouteDialog date={date} shipments={selected} kg={selKg} onClose={(created) => { setNewRoute(false); if (created) setSelected([]) }} />}
    </>
  )
}

function RouteCard({ route: r }: { route: RouteRow }) {
  const l = routeLoad(r)
  const remove = useRemoveFromRoute()
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2"><Link to={`/logistics/routes/${r.id}`} className="hover:underline">{r.number}</Link><StatusBadge status={r.status} /></CardTitle>
          <CardDescription>{r.vehicle ? `${r.vehicle.name} · ${r.vehicle.plate_number}` : t('No vehicle')} · {r.driver?.full_name ?? t('No driver')} · {t('from {place}', { place: r.warehouse?.code ?? '' })}</CardDescription>
        </div>
        <LoadBar kg={l.kg} cap={l.cap} />
      </CardHeader>
      <CardContent className="p-0">
        {!r.stops.length ? <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('No stops yet.')}</p> : (
          <ol className="divide-y border-t">{r.stops.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular">{s.sequence}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate"><span className="font-medium">{s.shipment?.partner?.name}</span> <span className="text-muted-foreground">{s.shipment?.number}</span></div>
                <div className="truncate text-xs text-muted-foreground">{s.address_text}</div>
              </div>
              {num(s.shipment?.cod_amount) > 0 && <Badge variant="warning">{t('Cash on delivery')}</Badge>}
              <span className="w-14 text-right text-xs tabular text-muted-foreground">{formatQty(Math.round(num(s.shipment?.weight_kg) * 10) / 10)} kg</span>
              {r.status === 'planned' ? (
                <Can perm="logistics.write"><Button size="icon-sm" variant="ghost" aria-label={t('Remove {number}', { number: s.shipment?.number })} loading={remove.isPending}
                  onClick={() => s.shipment && remove.mutate(s.shipment.id)}><X /></Button></Can>
              ) : <StatusBadge status={s.status} />}
            </li>
          ))}</ol>
        )}
        <div className="border-t px-4 py-2 text-right"><Button size="sm" variant="ghost" asChild><Link to={`/logistics/routes/${r.id}`}>{t('Open route sheet')} <ArrowRight /></Link></Button></div>
      </CardContent>
    </Card>
  )
}

function NewRouteDialog({ date, shipments, kg, onClose }: { date: string; shipments: string[]; kg: number; onClose: (created: boolean) => void }) {
  const navigate = useNavigate()
  const vehicles = useVehicles()
  const drivers = useDrivers()
  const warehouses = useWarehouses()
  const create = useCreateRoute()
  const [vehicle, setVehicle] = React.useState('')
  const [driver, setDriver] = React.useState('')
  const [wh, setWh] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const whs = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'store')
  React.useEffect(() => { if (!wh && whs[0]) setWh((whs.find((w) => w.code === 'WH') ?? whs[0]).id) }, [whs, wh])
  const v = (vehicles.data ?? []).find((x) => x.id === vehicle)
  const over = v?.capacity_kg ? kg > num(v.capacity_kg) : false
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New route for {date}', { date: formatDate(date) })}</DialogTitle>
          <DialogDescription>{shipments.length ? `${tn(shipments.length, '{n} shipment', '{n} shipments')} · ${formatQty(Math.round(kg * 10) / 10)} kg. ${t('Stops are ordered by city; you can reorder them on the route sheet.')}` : t('An empty route; add shipments from the board.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Vehicle')}</Label>
            <Select value={vehicle} onValueChange={(id) => { setVehicle(id); const d = vehicles.data?.find((x) => x.id === id)?.driver_employee_id; if (d) setDriver(d) }}>
              <SelectTrigger><SelectValue placeholder={t('Choose a vehicle')} /></SelectTrigger>
              <SelectContent>{(vehicles.data ?? []).filter((x) => x.is_active).map((x) => (
                <SelectItem key={x.id} value={x.id}>{x.name} · {x.plate_number}{x.capacity_kg ? ` · ${formatQty(x.capacity_kg)} kg` : ''}</SelectItem>
              ))}</SelectContent></Select>
            {over && <p className="text-[13px] text-destructive">{t('{kg} kg is more than the {cap} kg this vehicle carries.', { kg: formatQty(Math.round(kg)), cap: formatQty(v!.capacity_kg) })}</p>}
          </div>
          <div className="grid gap-1.5"><Label>{t('Driver')}</Label>
            <Select value={driver} onValueChange={setDriver}><SelectTrigger><SelectValue placeholder={t('Choose a driver')} /></SelectTrigger>
              <SelectContent>{(drivers.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Leaves from')}</Label>
            <Select value={wh} onValueChange={setWh}><SelectTrigger><SelectValue placeholder={t('Warehouse')} /></SelectTrigger>
              <SelectContent>{whs.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>{t('Cancel')}</Button>
          <Button disabled={!wh} loading={create.isPending} onClick={async () => {
            setError(null)
            try {
              const id = await create.mutateAsync({ date, warehouse: wh, vehicle: vehicle || null, driver: driver || null, shipments })
              toast.success(t('Route created')); onClose(true); navigate(`/logistics/routes/${id}`)
            } catch (e) { setError(describeError(e)) }
          }}>{t('Create route')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
