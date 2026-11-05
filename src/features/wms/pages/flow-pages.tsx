import { PackageOpen, Printer, ShoppingBasket, Truck } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatQty } from '@/lib/utils'
import { useLocations } from '@/features/inventory/api'
import { useConfirmShipment, useCreatePickList, useCreatePutaway, useCreateTransferPickList, useOutboundDeliveries, useShippedToday, useTasks, useTransfersToPick, wmsKeys, type DeliveryRow, type TaskRow } from '../api'
import { ScanShell, useScanStatus } from '../components/scan-shell'

/** Task lists refresh by themselves when someone else starts or finishes a task */
function useLiveTasks() {
  const { companyId } = useCompany()
  useRealtimeInvalidate('warehouse_tasks', companyId, [[...wmsKeys.all(companyId), 'tasks'], [...wmsKeys.all(companyId), 'deliveries'], [...wmsKeys.all(companyId), 'overview']])
}

function TaskCard({ task }: { task: TaskRow }) {
  const done = task.lines.reduce((s, l) => s + Number(l.quantity_done), 0)
  const total = task.lines.reduce((s, l) => s + Number(l.quantity), 0)
  return (
    <Link to={`/wms/tasks/${task.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
      <div className="min-w-0"><div className="flex items-center gap-2 font-semibold">{task.number} <StatusBadge status={task.status} /></div>
        <div className="truncate text-[13px] text-muted-foreground">{[task.reference, task.warehouse?.code, tn(task.lines.length, '{n} line', '{n} lines')].filter(Boolean).join(' · ')}</div></div>
      <div className="text-right text-[13px] tabular"><div className="font-medium">{formatQty(done)} / {formatQty(total)}</div><div className="text-muted-foreground">{formatDate(task.created_at)}</div></div>
    </Link>
  )
}

/* ------------------------------------------------------------------ putaway list */
export function PutawayListPage() {
  const navigate = useNavigate()
  const tasks = useTasks('putaway')
  const locations = useLocations()
  const sweep = useCreatePutaway()
  const receiving = (locations.data ?? []).filter((l) => ['receiving', 'quality'].includes(l.location_type) && l.warehouse_id)
  useLiveTasks()
  return (
    <ScanShell title={t('Put away')} back={{ href: '/wms', label: t('Warehouse floor') }}
      actions={<Can perm="wms.write">{receiving.map((l) => (
        <Button key={l.id} variant="outline" size="sm" loading={sweep.isPending} onClick={async () => { try { navigate(`/wms/tasks/${await sweep.mutateAsync(l.id)}`) } catch { /* toast */ } }}>{t('Collect all from {location}', { location: l.code })}</Button>
      ))}</Can>}>
      <p className="text-[13px] text-muted-foreground">{t('A task is created for every receipt that arrives in the receiving area. “Collect all” makes one task for whatever is still lying there.')}</p>
      {tasks.isError ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /> : tasks.isLoading ? <Skeleton className="h-40" /> : !tasks.data?.length
        ? <EmptyState icon={PackageOpen} title={t('Nothing to put away')} description={t('The receiving area is empty.')} />
        : <div className="grid gap-2">{tasks.data.map((x) => <TaskCard key={x.id} task={x} />)}</div>}
    </ScanShell>
  )
}

/* ------------------------------------------------------------------ picking */
export function PickingPage() {
  const navigate = useNavigate()
  const deliveries = useOutboundDeliveries(['draft'])
  const tasks = useTasks('pick')
  const create = useCreatePickList()
  const transfers = useTransfersToPick()
  const createT = useCreateTransferPickList()
  const [selT, setSelT] = React.useState<Set<string>>(new Set())
  const freeT = (transfers.data ?? []).filter((x) => !x.pick_list && x.lines.length)
  const selectedT = freeT.filter((x) => selT.has(x.id))
  const mixedT = new Set(selectedT.map((x) => x.from_warehouse_id)).size > 1
  const [sel, setSel] = React.useState<Set<string>>(new Set())
  const free = (deliveries.data ?? []).filter((d) => !d.pick_list && d.lines.length)
  const selected = free.filter((d) => sel.has(d.id))
  const mixed = new Set(selected.map((d) => d.warehouse_id)).size > 1
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  useLiveTasks()
  return (
    <ScanShell title={t('Pick')} back={{ href: '/wms', label: t('Warehouse floor') }}>
      <Tabs defaultValue={tasks.data?.length ? 'lists' : 'todo'}>
        <TabsList><TabsTrigger value="todo">{t('To pick ({n})', { n: free.length })}</TabsTrigger>
          {freeT.length > 0 && <TabsTrigger value="transfers">{t('Transfers to the shops ({n})', { n: freeT.length })}</TabsTrigger>}<TabsTrigger value="lists">{t('Pick lists ({n})', { n: tasks.data?.length ?? 0 })}</TabsTrigger></TabsList>
        <TabsContent value="todo" className="grid gap-2">
          {deliveries.isError ? <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} /> : deliveries.isLoading ? <Skeleton className="h-40" /> : !free.length ? <EmptyState icon={ShoppingBasket} title={t('No deliveries waiting')} description={t('Deliveries are created from confirmed sales orders.')} /> : <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <button type="button" className="text-primary hover:underline" onClick={() => setSel(new Set(free.map((d) => d.id)))}>{t('Select all')}</button>
              <span className="text-muted-foreground">{t('Pick several orders in one walk through the warehouse.')}</span>
            </div>
            {free.map((d) => (
              <label key={d.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4', sel.has(d.id) && 'border-primary ring-1 ring-primary/40')}>
                <Checkbox checked={sel.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={t('Select {number}', { number: d.number })} className="size-5" />
                <div className="min-w-0 flex-1"><div className="font-semibold">{d.partner?.name}</div>
                  <div className="text-[13px] text-muted-foreground">{[d.number, d.order?.number, d.warehouse?.code].filter(Boolean).join(' · ')}</div></div>
                <div className="text-right text-[13px]"><div className="font-medium tabular">{t('{n} units', { n: formatQty(d.lines.reduce((s, l) => s + Number(l.quantity), 0)) })}</div>
                  <div className={cn('text-muted-foreground', d.scheduled_date < new Date().toISOString().slice(0, 10) && 'text-warning')}>{formatDate(d.scheduled_date)}</div></div>
              </label>
            ))}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur lg:left-[244px]">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">{mixed ? t('A pick list covers one warehouse at a time') : t('{n} selected', { n: selected.length })}</span>
                <Can perm="wms.write"><Button size="lg" disabled={!selected.length || mixed} loading={create.isPending}
                  onClick={async () => { try { const id = await create.mutateAsync(selected.map((d) => d.id)); navigate(`/wms/tasks/${id}`) } catch { /* toast */ } }}>
                  <ShoppingBasket /> {t('Start picking')}</Button></Can>
              </div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value="transfers" className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <button type="button" className="text-primary hover:underline" onClick={() => setSelT(new Set(freeT.map((x) => x.id)))}>{t('Select all')}</button>
            <span className="text-muted-foreground">{t('Pick the shops\' transfers bin by bin; each transfer then leaves with what was picked.')}</span>
          </div>
          {freeT.map((x) => (
            <label key={x.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4', selT.has(x.id) && 'border-primary ring-1 ring-primary/40')}>
              <Checkbox checked={selT.has(x.id)} onCheckedChange={() => setSelT((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n })} aria-label={t('Select {number}', { number: x.number })} className="size-5" />
              <div className="min-w-0 flex-1"><div className="font-semibold">{x.to?.name}</div>
                <div className="text-[13px] text-muted-foreground">{[x.number, x.from?.code && t('from {code}', { code: x.from.code }), x.picked_at && t('picked {date}', { date: formatDate(x.picked_at, true) })].filter(Boolean).join(' · ')}</div></div>
              <div className="text-right text-[13px]"><div className="font-medium tabular">{t('{n} units', { n: formatQty(x.lines.reduce((s, l) => s + Number(l.quantity), 0)) })}</div>
                {x.expected_date && <div className={cn('text-muted-foreground', x.expected_date < new Date().toISOString().slice(0, 10) && 'text-warning')}>{formatDate(x.expected_date)}</div>}</div>
            </label>
          ))}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur lg:left-[244px]">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">{mixedT ? t('A pick list covers one warehouse at a time') : t('{n} selected', { n: selectedT.length })}</span>
              <Can perm="wms.write"><Button size="lg" disabled={!selectedT.length || mixedT} loading={createT.isPending}
                onClick={async () => { try { const id = await createT.mutateAsync(selectedT.map((x) => x.id)); navigate(`/wms/tasks/${id}`) } catch { /* toast */ } }}>
                <ShoppingBasket /> {t('Start picking')}</Button></Can>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="lists" className="grid gap-2">
          {tasks.isError ? <ErrorState compact error={tasks.error} onRetry={() => void tasks.refetch()} /> : !tasks.data?.length ? <EmptyState icon={ShoppingBasket} title={t('No pick lists in progress')} compact /> : tasks.data.map((x) => <TaskCard key={x.id} task={x} />)}
        </TabsContent>
      </Tabs>
    </ScanShell>
  )
}

/* ------------------------------------------------------------------ shipping */
export function ShippingPage() {
  const ready = useOutboundDeliveries(['ready'])
  const shipped = useShippedToday()
  const [ship, setShip] = React.useState<DeliveryRow | null>(null)
  const st = useScanStatus()
  const onScan = (code: string) => {
    const hit = (ready.data ?? []).find((d) => d.number.toUpperCase() === code.toUpperCase() || d.order?.number.toUpperCase() === code.toUpperCase())
    if (hit) { scanFeedback('ok'); setShip(hit) } else { scanFeedback('error'); st.error(t('No delivery ready to ship for “{code}”', { code })) }
  }
  return (
    <ScanShell title={t('Ship')} back={{ href: '/wms', label: t('Warehouse floor') }}>
      <ScanInput onScan={onScan} placeholder={t('Scan the delivery or order number')} status={st.status} />
      {ready.isError ? <ErrorState error={ready.error} onRetry={() => void ready.refetch()} /> : ready.isLoading ? <Skeleton className="h-40" /> : !ready.data?.length ? <EmptyState icon={Truck} title={t('Nothing waiting to ship')} description={t('Deliveries come here when their pick list is finished.')} /> : (
        <div className="grid gap-2">
          {ready.data.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0"><div className="font-semibold">{d.partner?.name}</div>
                <div className="text-[13px] text-muted-foreground">{[d.number, d.order?.number, t('{n} units', { n: formatQty(d.lines.reduce((s, l) => s + Number(l.quantity), 0)) }), d.picked_at && t('picked {date}', { date: formatDate(d.picked_at, true) })].filter(Boolean).join(' · ')}</div></div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => printPackingSlip(d.id)}><Printer /> {t('Packing slip')}</Button>
                <Can perm="wms.write"><Button onClick={() => setShip(d)}><Truck /> {t('Ship')}</Button></Can>
              </div>
            </div>
          ))}
        </div>
      )}
      {!!shipped.data?.length && <>
        <h2 className="mt-2 text-sm font-semibold">{t('Recently shipped')}</h2>
        <div className="grid gap-1.5">
          {shipped.data.map((d) => (
            <Link key={d.id} to={`/sales/deliveries/${d.id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-[13px] hover:border-primary/50">
              <span><span className="font-medium">{d.number}</span> · {d.partner?.name}</span>
              <span className="text-muted-foreground">{[d.carrier_name, d.tracking_number, d.package_count && tn(d.package_count, '{n} parcel', '{n} parcels'), formatDate(d.done_at, true)].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
        </div>
      </>}
      {ship && <ShipDialog delivery={ship} onClose={() => setShip(null)} />}
    </ScanShell>
  )
}

function ShipDialog({ delivery, onClose }: { delivery: DeliveryRow; onClose: () => void }) {
  const confirm = useConfirmShipment()
  const carriersKey = 'drispro.wms.carriers'
  const known: string[] = (() => { try { return JSON.parse(localStorage.getItem(carriersKey) ?? '[]') } catch { return [] } })()
  const [carrier, setCarrier] = React.useState(known[0] ?? '')
  const [tracking, setTracking] = React.useState('')
  const [packages, setPackages] = React.useState('1')
  const [weight, setWeight] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Ship {number}', { number: delivery.number })}</DialogTitle><DialogDescription>{delivery.partner?.name}. {t('Confirming takes the goods out of stock and records the cost of the goods sold.')}</DialogDescription></DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
          e.preventDefault()
          try {
            await confirm.mutateAsync({ id: delivery.id, carrier, tracking, packages: Number(packages) || null, weight: weight ? Number(weight) : null })
            if (carrier.trim()) { try { localStorage.setItem(carriersKey, JSON.stringify([carrier.trim(), ...known.filter((k) => k !== carrier.trim())].slice(0, 8))) } catch { /* ignore */ } }
            scanFeedback('ok'); toast.success(t('{number} shipped', { number: delivery.number })); onClose()
          } catch { scanFeedback('error') }
        }}>
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="sh-car">{t('Carrier')}</Label>
            <Input id="sh-car" list="sh-carriers" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t('Own van, DHL, Post…')} />
            <datalist id="sh-carriers">{known.map((k) => <option key={k} value={k} />)}</datalist></div>
          <div className="col-span-2 grid gap-1.5"><Label htmlFor="sh-tr">{t('Tracking number')}</Label><Input id="sh-tr" autoFocus className="font-mono" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={t('Scan the label')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="sh-pk">{t('Parcels')}</Label><Input id="sh-pk" inputMode="numeric" value={packages} onChange={(e) => setPackages(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="sh-kg">{t('Weight (kg)')}</Label><Input id="sh-kg" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(',', '.'))} /></div>
          <DialogFooter className="col-span-2"><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={confirm.isPending}><Truck /> {t('Confirm shipment')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Packing slip: printed from a hidden frame, A5-friendly */
export async function printPackingSlip(deliveryId: string) {
  const { data: d } = await supabase.from('deliveries')
    .select('number, scheduled_date, notes, partner:business_partners(name, phone), order:sales_orders(number, customer_reference), company:companies(name), warehouse:warehouses(name)')
    .eq('id', deliveryId).single()
  const { data: lines } = await supabase.from('delivery_lines').select('quantity, variant:product_variants(sku, name), lot:lots(lot_number, expiry_date), location:warehouse_locations(code)').eq('delivery_id', deliveryId)
  if (!d) return
  const x = d as unknown as { number: string; scheduled_date: string; notes: string | null; partner: { name: string; phone: string | null } | null; order: { number: string; customer_reference: string | null } | null; company: { name: string } | null; warehouse: { name: string } | null }
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const rows = ((lines ?? []) as unknown as { quantity: number; variant: { sku: string; name: string } | null; lot: { lot_number: string; expiry_date: string | null } | null; location: { code: string } | null }[])
    .map((l) => `<tr><td>${esc(l.variant?.sku)}</td><td>${esc(l.variant?.name)}${l.lot ? `<br><small>${esc(t('Lot {lot}', { lot: l.lot.lot_number }))}${l.lot.expiry_date ? ` · ${esc(t('expires {date}', { date: formatDate(l.lot.expiry_date) }))}` : ''}</small>` : ''}</td><td class="r">${esc(formatQty(l.quantity))}</td><td>☐</td></tr>`).join('')
  printHtml(`<h1>${esc(t('Packing slip {number}', { number: x.number }))}</h1>
    <p><b>${esc(x.partner?.name)}</b>${x.partner?.phone ? ` · ${esc(x.partner.phone)}` : ''}<br>${esc(t('Order {number}', { number: x.order?.number ?? '—' }))}${x.order?.customer_reference ? ` · ${esc(t('your reference {ref}', { ref: x.order.customer_reference }))}` : ''}<br>
    ${esc(t('From {company}', { company: x.company?.name ?? '' }))} · ${esc(td(x.warehouse?.name))} · ${esc(formatDate(x.scheduled_date))}</p>
    <table><thead><tr><th>${esc(t('Code'))}</th><th>${esc(t('Item'))}</th><th class="r">${esc(t('Qty'))}</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
    ${x.notes ? `<p>${esc(x.notes)}</p>` : ''}<p class="sig">${esc(t('Received in good condition:'))} ____________________</p>`,
    `@page{size:A5;margin:12mm} body{font:12px/1.4 system-ui,sans-serif;color:#000} h1{font-size:18px;margin:0 0 8px} table{width:100%;border-collapse:collapse;margin-top:10px}
     th,td{border-bottom:1px solid #999;padding:5px 4px;text-align:left;vertical-align:top} .r{text-align:right} .sig{margin-top:28px}`)
}
