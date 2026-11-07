import { useQuery } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, ArrowDownToLine, Boxes, CalendarClock, Check, Clock, Columns3, Factory, Layers, List, PackageCheck, Play, Plus, Undo2, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { MoreMenu, type MoreItem } from '@/components/more-menu'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { cn, formatDate, formatMoney, formatQty, humanize, num } from '@/lib/utils'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import { useWarehouses } from '@/features/inventory/api'
import {
  useBackToDraft, useBomCost, useBomExplode, useCancelWorkOrder, useCloseWorkOrder, useCompleteWorkOrder, useConsume, useCreateWorkOrder, useLotsAt, useManufacturable,
  useMaterials, useProduce, useRecordOperation, useReleaseWorkOrder, useReturnMaterials, useUpdateWorkOrder, useWorkOrder, useWorkOrders,
  type MaterialRow, type WorkOrderDetail, type WorkOrderRow, mfgKeys,
} from '../api'

const ACTIVE = ['draft', 'released', 'in_progress', 'completed'] as const
const isLate = (w: { status: string; planned_end: string | null }) => ['draft', 'released', 'in_progress'].includes(w.status) && !!w.planned_end && new Date(w.planned_end) < new Date()
const toLocal = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
}

/* ================================================================== list + board */
export function WorkOrdersPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const wos = useWorkOrders()
  const { companyId } = useCompany()
  useRealtimeInvalidate('work_orders', companyId, [mfgKeys.all(companyId)])
  const view = params.get('view') === 'board' ? 'board' : 'list'
  const [newOpen, setNewOpen] = React.useState(params.get('new') === '1')
  const cols = React.useMemo<ColumnDef<WorkOrderRow>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Work order')} />, meta: { label: t('Work order') },
      cell: ({ row: { original: w } }) => <span className="font-medium">{w.number}{w.parent && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('for {number}', { number: w.parent.number })}</span>}</span> },
    { id: 'product', accessorFn: (w) => w.variant?.name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Product') } },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ row: { original: w } }) => <span className="flex items-center gap-1.5"><StatusBadge status={w.status} />{isLate(w) && <Badge variant="destructive">{t('Late')}</Badge>}</span> },
    { id: 'progress', accessorFn: (w) => num(w.quantity_produced) / num(w.quantity_planned), header: t('Made'), meta: { label: t('Made') },
      cell: ({ row: { original: w } }) => <div className="w-32"><div className="mb-1 text-xs tabular">{formatQty(w.quantity_produced)} / {formatQty(w.quantity_planned)}</div><ProgressBar done={num(w.quantity_produced)} total={num(w.quantity_planned)} /></div> },
    { accessorKey: 'planned_start', header: ({ column }) => <ColumnHeader column={column} title={t('Start')} />, meta: { label: t('Planned start') }, cell: ({ getValue }) => formatDate(getValue() as string, true) },
    { accessorKey: 'planned_end', header: t('Due'), meta: { label: t('Due') }, cell: ({ row: { original: w } }) => <span className={cn(isLate(w) && 'text-destructive')}>{formatDate(w.planned_end, true)}</span> },
    { accessorKey: 'priority', header: t('Priority'), meta: { label: t('Priority'), align: 'right' } },
    { id: 'cost', accessorFn: (w) => num(w.total_cost), header: t('Cost so far (without VAT)'), meta: { label: t('Cost so far (without VAT)'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { id: 'so', accessorFn: (w) => w.sales_order?.number ?? '', header: t('For order'), meta: { label: t('Sales order') } },
  ], [])
  return (
    <>
      <PageHeader title={t('Work orders')} description={t('What is being made, from planned to closed. Using materials and booking output move the stock; closing settles the cost in accounting.')}
        actions={<>
          <div className="flex max-w-full overflow-x-auto rounded-md border p-0.5" role="group" aria-label={t('View')}>
            <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} className="h-8" onClick={() => setParams((p) => { p.delete('view'); return p })}><List /> {t('List')}</Button>
            <Button size="sm" variant={view === 'board' ? 'secondary' : 'ghost'} className="h-8" onClick={() => setParams((p) => { p.set('view', 'board'); return p })}><Columns3 /> {t('Board')}</Button>
          </div>
          <Can perm="manufacturing.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('New work order')}</Button></Can>
        </>} />
      {view === 'list' ? (
        <DataTable tableKey="mfg.work-orders" columns={cols} data={wos.data} isLoading={wos.isLoading} error={wos.error} getRowId={(r) => r.id} exportName="work-orders"
          searchPlaceholder={t('Number, product…')} onRowClick={(r) => navigate(`/manufacturing/orders/${r.id}`)}
          initialFilters={[{ id: 'status', value: [...ACTIVE] }]}
          facets={[{ columnId: 'status', title: t('Status'), options: [...ACTIVE, 'closed', 'cancelled'].map((s) => ({ value: s, label: humanize(s) })) }]}
          empty={{ title: t('No work orders yet'), description: t('Create one from a recipe, or from the production plan when stock runs low.') }} />
      ) : <Board rows={wos.data ?? []} loading={wos.isLoading} error={wos.error} onRetry={() => void wos.refetch()} />}
      {newOpen && <NewWorkOrderDialog onClose={() => { setNewOpen(false); setParams((p) => { p.delete('new'); return p }) }} initialVariant={params.get('variant')} initialQty={params.get('qty')} />}
    </>
  )
}

function Board({ rows, loading, error, onRetry }: { rows: WorkOrderRow[]; loading: boolean; error: unknown; onRetry: () => void }) {
  if (loading) return <Skeleton className="h-96" />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-4">
      {ACTIVE.map((s) => {
        const list = rows.filter((w) => w.status === s).sort((a, b) => a.priority - b.priority || (a.planned_start ?? '').localeCompare(b.planned_start ?? ''))
        return (
          <div key={s} className="min-w-[240px] rounded-lg bg-muted/40 p-2">
            <div className="mb-2 flex items-center justify-between px-1.5 text-[13px] font-medium"><span>{humanize(s)}</span><span className="tabular text-muted-foreground">{list.length}</span></div>
            <div className="grid gap-2">
              {list.map((w) => (
                <Link key={w.id} to={`/manufacturing/orders/${w.id}`} className="grid gap-1.5 rounded-md border bg-card p-3 text-[13px] transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{w.number}</span>{isLate(w) ? <Badge variant="destructive">{t('Late')}</Badge> : <span className="text-xs text-muted-foreground" title={t('Priority')}>P{w.priority}</span>}</div>
                  <div className="truncate">{w.variant?.name}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="tabular">{formatQty(w.quantity_produced)} / {formatQty(w.quantity_planned)}</span><span>{t('due {date}', { date: formatDate(w.planned_end) })}</span></div>
                  <ProgressBar done={num(w.quantity_produced)} total={num(w.quantity_planned)} />
                  {w.parent && <div className="text-xs text-muted-foreground"><Layers className="mr-1 inline size-3" />{t('for {number}', { number: w.parent.number })}</div>}
                </Link>
              ))}
              {!list.length && <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{t('None')}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ================================================================== new work order */
export function NewWorkOrderDialog({ onClose, initialBom, initialVariant, initialQty }: { onClose: () => void; initialBom?: string; initialVariant?: string | null; initialQty?: string | null }) {
  const navigate = useNavigate()
  const boms = useManufacturable()
  const warehouses = useWarehouses()
  const create = useCreateWorkOrder()
  const [bomId, setBomId] = React.useState<string | null>(initialBom ?? null)
  const [qty, setQty] = React.useState(initialQty ?? '')
  const [wh, setWh] = React.useState<string | null>(null)
  const [start, setStart] = React.useState(() => toLocal(new Date(Date.now() + 3600_000).toISOString()))
  const [priority, setPriority] = React.useState('3')
  const [subs, setSubs] = React.useState(true)
  const [notes, setNotes] = React.useState('')
  React.useEffect(() => {
    if (!bomId && initialVariant && boms.data) setBomId(boms.data.find((b) => b.variant?.id === initialVariant && b.is_default)?.id ?? boms.data.find((b) => b.variant?.id === initialVariant)?.id ?? null)
  }, [boms.data]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (!wh && warehouses.data?.length) setWh(warehouses.data.find((w) => w.warehouse_type !== 'store')?.id ?? warehouses.data[0]!.id) }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const bom = boms.data?.find((b) => b.id === bomId)
  React.useEffect(() => { if (bom && !qty) setQty(String(num(bom.quantity))) }, [bom?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const explode = useBomExplode(bomId ?? undefined, num(qty))
  const cost = useBomCost(bomId ?? undefined, num(qty), false)
  const first = (explode.data ?? []).filter((r) => r.depth === 1)
  const short = first.filter((r) => num(r.available) < num(r.quantity))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('New work order')}</DialogTitle><DialogDescription>{t('Materials and steps are copied from the recipe. Missing semi-finished products can get their own work orders, due before this one starts.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-3"><Label>{t('Product')}</Label>
            <SearchSelect value={bomId} onChange={setBomId} placeholder={t('What to make')} options={(boms.data ?? []).map((b) => ({ value: b.id, label: b.variant?.name ?? b.code, hint: `${b.code} v${b.version}${b.is_default ? '' : ` · ${t('alternative')}`}` }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="wo-qty">{t('Quantity')}</Label><Input id="wo-qty" inputMode="decimal" className="text-right tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Warehouse')}</Label>
            <Select value={wh ?? ''} onValueChange={setWh}><SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="wo-start">{t('Start')}</Label><Input id="wo-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Priority')}</Label>
            <Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['1', '2', '3', '4', '5'].map((p) => <SelectItem key={p} value={p}>{p === '1' ? t('1 · urgent') : p === '5' ? t('5 · when free') : p}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center justify-between gap-2 sm:col-span-4"><Label htmlFor="wo-subs">{t('Make missing semi-finished products as separate work orders')}</Label><Switch id="wo-subs" checked={subs} onCheckedChange={setSubs} /></div>
          <div className="grid gap-1.5 sm:col-span-4"><Label htmlFor="wo-notes">{t('Notes')}</Label><Input id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Optional')} /></div>
        </div>
        {bomId && num(qty) > 0 && (
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{t('What it needs')}</span>
              {cost.data && <span className="text-muted-foreground">{t('Estimated cost (without VAT)')} <b className="tabular text-foreground">{formatMoney(cost.data.total)}</b> · {t('{cost} each', { cost: formatMoney(cost.data.unit) })}</span>}</div>
            {first.map((r) => (
              <div key={r.path} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">{r.sub_bom_id && <Layers className="size-3.5 text-primary" />}{r.name}</span>
                <span className={cn('tabular', num(r.available) < num(r.quantity) ? 'text-destructive' : 'text-muted-foreground')}>{t('{a} needed · {b} available', { a: formatQty(r.quantity), b: formatQty(r.available) })}</span>
              </div>
            ))}
            {short.length > 0 && <p className="text-xs text-warning">{short.filter((r) => r.sub_bom_id).length ? `${t('Missing semi-finished products will get their own work orders.')} ` : ''}{short.some((r) => !r.sub_bom_id) ? t('Some materials are missing: buy them or move them here before production.') : ''}</p>}
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} disabled={!bomId || !(num(qty) > 0) || !wh} onClick={async () => {
            const id = await create.mutateAsync({ bom_id: bomId, quantity: num(qty), warehouse_id: wh, planned_start: start ? new Date(start).toISOString() : null,
                                                  priority: Number(priority), make_subassemblies: subs, notes: notes || null })
            toast.success(t('Work order created')); onClose(); navigate(`/manufacturing/orders/${id}`)
          }}>{t('Create work order')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================================================================== the work order */
export function WorkOrderPage() {
  const { id } = useParams()
  const q = useWorkOrder(id)
  if (q.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <EmptyState icon={Factory} title={t('Work order not found')} description={t('It may have been deleted.')} action={<Button variant="outline" asChild><Link to="/manufacturing/orders">{t('All work orders')}</Link></Button>} />
  return <WorkOrderView w={q.data} />
}

function WorkOrderView({ w }: { w: WorkOrderDetail }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const materials = useMaterials(w.id)
  const release = useReleaseWorkOrder()
  const consume = useConsume()
  const complete = useCompleteWorkOrder()
  const close = useCloseWorkOrder()
  const cancel = useCancelWorkOrder()
  const backToDraft = useBackToDraft()
  const [dlg, setDlg] = React.useState<null | 'consume' | 'return' | 'produce' | { op: string }>(null)
  const write = can('manufacturing.write')
  const live = w.status === 'released' || w.status === 'in_progress'
  const planned = num(w.planned_material_cost) + num(w.planned_labor_cost) + num(w.planned_overhead_cost)
  const wip = num(w.material_cost) + num(w.labor_cost) + num(w.overhead_cost) - num(w.output_value) - num(w.variance_value)
  const plannedUnit = num(w.quantity_planned) ? planned / num(w.quantity_planned) : 0
  const actualUnit = num(w.quantity_produced) ? num(w.output_value) / num(w.quantity_produced) : null
  const shortages = (materials.data ?? []).filter((m) => m.shortage > 0)

  // one main button for the next step of the order; the rest under More
  const more: MoreItem[] = [
    { label: t('Use materials'), icon: Boxes, hidden: !live, onSelect: () => setDlg('consume') },
    { label: t('Return unused material'), icon: Undo2, hidden: w.status !== 'completed', onSelect: () => setDlg('return') },
    { label: t('Finish early'), icon: Check, hidden: w.status !== 'in_progress',
      confirm: { title: t('Finish {number} with {a} of {b}?', { number: w.number, a: formatQty(w.quantity_produced), b: formatQty(w.quantity_planned) }),
        description: t('Open steps are marked done. When you close the order, any cost the output did not take is booked as a cost difference.'), confirmLabel: t('Finish') },
      onSelect: async () => { await complete.mutateAsync(w.id); toast.success(t('Work order finished')) } },
    { label: t('Back to draft'), icon: Undo2, hidden: !(w.status === 'released' && num(w.material_cost) === 0 && num(w.labor_cost) === 0),
      onSelect: async () => { await backToDraft.mutateAsync(w.id); toast.success(t('Back to draft')) } },
    { label: t('Cancel work order'), icon: X, destructive: true, separate: true, hidden: w.status !== 'draft',
      confirm: { title: t('Cancel {number}?', { number: w.number }), description: t('Nothing has been booked on it; orders for semi-finished products that have not started are cancelled too.'), confirmLabel: t('Cancel work order') },
      onSelect: async () => { await cancel.mutateAsync(w.id); toast.success(t('Work order cancelled')) } },
  ]
  const actions = write && <>
    <MoreMenu items={more} />
    {w.status === 'draft' &&
      <Button loading={release.isPending} onClick={async () => {
        const r = await release.mutateAsync(w.id)
        if (r.shortages.length) toast.warning(tn(r.shortages.length, 'Released with {n} missing material', 'Released with {n} missing materials'), { description: r.shortages.map((s) => t('{sku}: {qty} missing', { sku: s.sku, qty: formatQty(s.shortage) })).join(' · ') })
        else toast.success(t('Released to production'))
      }}><Play /> {t('Release')}</Button>}
    {live && <Button onClick={() => setDlg('produce')}><PackageCheck /> {t('Book output')}</Button>}
    {w.status === 'completed' &&
      <ConfirmDialog trigger={<Button><Check /> {t('Close and settle cost')}</Button>} title={t('Close {number}?', { number: w.number })}
        description={Math.abs(wip) < 0.005 ? t('All cost went into the finished goods; nothing is left in production.') : t('{amount} is still in production and will be booked as a cost difference.', { amount: formatMoney(wip) })}
        confirmLabel={t('Close')} onConfirm={async () => { const r = await close.mutateAsync(w.id); toast.success(num(r.variance) ? t('Closed · cost difference {amount}', { amount: formatMoney(r.variance) }) : t('Closed · no cost difference')) }} />}
  </>

  return (
    <div className="w-full">
      <PageHeader back={{ href: '/manufacturing/orders', label: t('Work orders') }} title={w.number}
        meta={<><StatusBadge status={w.status} />{isLate(w) && <Badge variant="destructive">{t('Late')}</Badge>}</>}
        description={<>{w.variant?.name} · {t('{qty} planned', { qty: formatQty(w.quantity_planned) })} · {w.warehouse?.code} ({w.component_location?.code} → {w.output_location?.code}) · {t('Recipe')} <Link className="text-primary hover:underline" to={`/manufacturing/boms/${w.bom_id}`}>{w.bom?.code}</Link></>}
        actions={<><PageTableExport />{actions}</>} />

      {(w.parent || w.children.length > 0 || w.sales_order) && (
        <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
          {w.parent && <Link to={`/manufacturing/orders/${w.parent.id}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 hover:border-primary/50"><Layers className="size-3.5 text-primary" /> {t('Feeds {number}', { number: w.parent.number })} <StatusBadge status={w.parent.status} /></Link>}
          {w.children.map((c) => <Link key={c.id} to={`/manufacturing/orders/${c.id}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 hover:border-primary/50"><Layers className="size-3.5 text-muted-foreground" /> {t('Semi-finished {number}', { number: c.number })} · {c.variant?.sku} {formatQty(c.quantity_produced)}/{formatQty(c.quantity_planned)} <StatusBadge status={c.status} /></Link>)}
          {w.sales_order && <Link to={`/sales/orders/${w.sales_order.id}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 hover:border-primary/50">{t('For {number}', { number: w.sales_order.number })}</Link>}
        </div>
      )}
      {live && shortages.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{t('Missing at {location}: {items}. Move stock there or receive it before using materials.', { location: w.component_location?.code ?? '', items: shortages.map((s) => `${s.sku} ${formatQty(s.shortage)}`).join(', ') })}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-[13px] text-muted-foreground">{t('Made')}</div>
          <div className="tabular text-2xl font-semibold">{formatQty(w.quantity_produced)} <span className="text-base font-normal text-muted-foreground">/ {formatQty(w.quantity_planned)}</span></div>
          <ProgressBar className="mt-2" done={num(w.quantity_produced)} total={num(w.quantity_planned)} />
          <div className="mt-1.5 text-xs text-muted-foreground">{num(w.quantity_scrapped) ? `${t('{qty} scrapped', { qty: formatQty(w.quantity_scrapped) })} · ` : ''}{w.output_lot ? <>{t('lot')} <Link className="text-primary hover:underline" to={`/wms/lots/${w.output_lot.id}`}>{w.output_lot.lot_number}</Link></> : t('no lot yet')}</div>
        </div>
        <StatCard label={t('Cost so far (without VAT)')} value={formatMoney(w.total_cost)} hint={t('Planned {amount}', { amount: formatMoney(planned) })} tone={num(w.total_cost) > planned * 1.05 && planned > 0 ? 'warning' : 'default'} />
        <StatCard label={t('Unit cost (without VAT)')} value={actualUnit == null ? '—' : formatMoney(actualUnit)} hint={t('Planned {amount} each', { amount: formatMoney(plannedUnit) })} />
        <StatCard label={w.status === 'closed' ? t('Cost difference booked (without VAT)') : t('Still in production (without VAT)')} value={formatMoney(w.status === 'closed' ? w.variance_value : wip)}
          tone={w.status === 'closed' && num(w.variance_value) > 0 ? 'warning' : 'default'}
          hint={w.status === 'closed' ? t('Cost the output did not take') : t('Cost not yet moved to finished goods')} />
      </div>

      <Tabs defaultValue="materials" className="mt-4">
        <TabsList>
          <TabsTrigger value="materials">{t('Materials')}</TabsTrigger><TabsTrigger value="operations">{t('Steps')}</TabsTrigger>
          <TabsTrigger value="output">{t('Output')} ({w.outputs.filter((o) => o.output_type === 'finished').length})</TabsTrigger>
          <TabsTrigger value="cost">{t('Cost')}</TabsTrigger><TabsTrigger value="planning">{t('Planning')}</TabsTrigger>
          <TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger>
        </TabsList>
        <TabsContent value="materials"><MaterialsTab w={w} rows={materials.data} loading={materials.isLoading} live={live && write} onConsumeAll={async () => {
          const r = await consume.mutateAsync({ id: w.id, items: null }); toast.success(tn(r.lines, 'Used {n} material · {amount}', 'Used {n} materials · {amount}', { amount: formatMoney(r.value) }))
        }} consuming={consume.isPending} /></TabsContent>
        <TabsContent value="operations"><OperationsTab w={w} live={live && write} onRecord={(op) => setDlg({ op })} /></TabsContent>
        <TabsContent value="output"><OutputTab w={w} /></TabsContent>
        <TabsContent value="cost"><CostTab w={w} /></TabsContent>
        <TabsContent value="planning"><PlanningTab w={w} editable={write && (w.status === 'draft' || w.status === 'released' || w.status === 'in_progress')} /></TabsContent>
        <TabsContent value="accounting"><AccountingTab sourceType="work_order" sourceId={w.id} emptyHint={t('Entries appear when materials are used, work time is reported and output is booked.')} /></TabsContent>
        <TabsContent value="activity"><ActivityTimeline table="work_orders" id={w.id} /></TabsContent>
      </Tabs>

      {dlg === 'consume' && <ConsumeDialog w={w} rows={materials.data ?? []} onClose={() => setDlg(null)} />}
      {dlg === 'return' && <ReturnDialog w={w} rows={materials.data ?? []} onClose={() => setDlg(null)} />}
      {dlg === 'produce' && <ProduceDialog w={w} onClose={() => setDlg(null)} onDone={(completed) => { setDlg(null); if (completed) toast.success(t('{number} finished — close it to settle the cost', { number: w.number })) }} />}
      {dlg && typeof dlg === 'object' && <OperationDialog w={w} opId={dlg.op} onClose={() => setDlg(null)} />}
      {w.status === 'cancelled' && <div className="mt-4"><Button variant="outline" onClick={() => navigate('/manufacturing/orders')}>{t('Back to work orders')}</Button></div>}
    </div>
  )
}

function MaterialsTab({ w, rows, loading, live, onConsumeAll, consuming }: { w: WorkOrderDetail; rows?: MaterialRow[]; loading: boolean; live: boolean; onConsumeAll: () => Promise<void>; consuming: boolean }) {
  const remainingValue = (rows ?? []).reduce((s, m) => s + m.remaining * num(m.unit_cost), 0)
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <div><CardTitle>{t('Materials')}</CardTitle><CardDescription>{t('Taken from {location}. Materials with lots are used first-to-expire first, unless you choose a lot.', { location: w.component_location?.code ?? '' })}</CardDescription></div>
          {live && (rows ?? []).some((m) => m.remaining > 0) && <ConfirmDialog trigger={<Button size="sm" variant="outline" loading={consuming}><ArrowDownToLine /> {t('Use everything still needed')}</Button>}
            title={t('Use all remaining materials?')} description={t('Takes what is still needed for the full {qty}, about {amount} at current cost.', { qty: formatQty(w.quantity_planned), amount: formatMoney(remainingValue) })} confirmLabel={t('Use materials')} onConfirm={onConsumeAll} />}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? <Skeleton className="m-4 h-32" /> : !rows?.length ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">{t('This order needs no materials.')}</p> : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Material')}</TableHead><TableHead className="text-right">{t('Required|qty')}</TableHead><TableHead className="text-right">{t('Used')}</TableHead>
                <TableHead className="w-40">{t('Progress')}</TableHead><TableHead className="text-right">{t('Free at {location}', { location: w.component_location?.code ?? '' })}</TableHead><TableHead className="text-right">{t('Unit cost (without VAT)')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {(rows ?? []).map((m) => (
                  <TableRow key={m.material_id} className="hover:bg-transparent">
                    <TableCell><div className="flex items-center gap-1.5">{m.sub_bom_id && <Layers className="size-3.5 text-primary" aria-label={t('Semi-finished product')} />}<span className="font-medium">{m.name}</span><span className="text-xs text-muted-foreground">{m.sku}</span>
                      {m.tracking !== 'none' && <Badge variant="outline" className="ml-1">{t('Lots')}</Badge>}</div>
                      {m.child_work_order && <div className="text-xs text-muted-foreground">{t('Made by {number}', { number: m.child_work_order })}</div>}</TableCell>
                    <TableCell className="text-right tabular">{formatQty(m.required)} <span className="text-xs text-muted-foreground">{td(m.uom)}</span></TableCell>
                    <TableCell className={cn('text-right tabular', m.consumed > m.required && 'text-warning')}>{formatQty(m.consumed)}</TableCell>
                    <TableCell><ProgressBar done={m.consumed} total={m.required} /></TableCell>
                    <TableCell className={cn('text-right tabular', m.shortage > 0 && 'font-medium text-destructive')}>{formatQty(m.available_at_location)}{m.shortage > 0 && <div className="text-xs font-normal">{t('{qty} missing', { qty: formatQty(m.shortage) })}</div>}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{formatMoney(m.unit_cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {w.consumptions.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle>{t('Used so far')}</CardTitle><CardDescription>{t('Each line is stock moved into production at the average cost of that moment.')}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('When')}</TableHead><TableHead>{t('Material')}</TableHead><TableHead>{t('Lot')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="text-right">{t('Cost (without VAT)')}</TableHead></TableRow></TableHeader>
              <TableBody>{[...w.consumptions].sort((a, b) => b.consumed_at.localeCompare(a.consumed_at)).map((c) => (
                <TableRow key={c.id} className="hover:bg-transparent"><TableCell className="text-[13px]">{formatDate(c.consumed_at, true)}</TableCell>
                  <TableCell>{c.variant?.name} <span className="text-xs text-muted-foreground">{c.variant?.sku}</span></TableCell>
                  <TableCell className="text-[13px]">{c.lot ? <Link className="text-primary hover:underline" to={`/wms/lots/${c.lot_id}`}>{c.lot.lot_number}</Link> : '—'}</TableCell>
                  <TableCell className="text-right tabular">{formatQty(c.quantity)}</TableCell><TableCell className="text-right tabular">{formatMoney(num(c.quantity) * num(c.unit_cost))}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function OperationsTab({ w, live, onRecord }: { w: WorkOrderDetail; live: boolean; onRecord: (op: string) => void }) {
  const ops = [...w.operations].sort((a, b) => a.sequence - b.sequence)
  if (!ops.length) return <EmptyState icon={Clock} title={t('No steps')} description={t('The recipe records no work time; only materials make up the cost.')} />
  return (
    <Card><CardContent className="overflow-x-auto p-0">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Step')}</TableHead><TableHead>{t('Work center')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead className="text-right">{t('Planned')}</TableHead>
          <TableHead className="text-right">{t('Actual')}</TableHead><TableHead className="text-right">{t('Labour')}</TableHead><TableHead className="text-right">{t('Overhead')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
        <TableBody>{ops.map((o) => (
          <TableRow key={o.id} className="hover:bg-transparent">
            <TableCell><span className="tabular text-muted-foreground">{o.sequence}</span> <span className="font-medium">{o.name}</span></TableCell>
            <TableCell className="text-[13px]">{td(o.work_center?.name)}<div className="text-xs text-muted-foreground">{t('{a}/h + {b}/h', { a: formatMoney(o.work_center?.cost_per_hour), b: formatMoney(o.work_center?.overhead_per_hour) })}</div></TableCell>
            <TableCell><StatusBadge status={o.status} /></TableCell>
            <TableCell className="text-right tabular">{t('{n} min', { n: formatQty(o.planned_minutes) })}</TableCell>
            <TableCell className={cn('text-right tabular', num(o.actual_minutes) > num(o.planned_minutes) * 1.1 && 'text-warning')}>{t('{n} min', { n: formatQty(o.actual_minutes) })}</TableCell>
            <TableCell className="text-right tabular">{formatMoney(o.labor_cost)}</TableCell><TableCell className="text-right tabular">{formatMoney(o.overhead_cost)}</TableCell>
            <TableCell>{live && o.status !== 'done' && <Button size="sm" variant="outline" onClick={() => onRecord(o.id)}><Clock /> {t('Report work')}</Button>}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </CardContent></Card>
  )
}

function OutputTab({ w }: { w: WorkOrderDetail }) {
  const outs = [...w.outputs].sort((a, b) => b.produced_at.localeCompare(a.produced_at))
  if (!outs.length) return <EmptyState icon={PackageCheck} title={t('Nothing produced yet')} description={t('Book output as it comes off the line; materials and time can be recorded automatically at the same moment.')} />
  return (
    <Card><CardContent className="overflow-x-auto p-0">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('When')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead>{t('Lot')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="text-right">{t('Unit cost (without VAT)')}</TableHead><TableHead className="text-right">{t('Value at cost (without VAT)')}</TableHead></TableRow></TableHeader>
        <TableBody>{outs.map((o) => (
          <TableRow key={o.id} className="hover:bg-transparent"><TableCell className="text-[13px]">{formatDate(o.produced_at, true)}</TableCell>
            <TableCell>{o.output_type === 'scrap' ? <Badge variant="destructive">{t('Scrap')}</Badge> : <Badge variant="success">{t('Finished')}</Badge>}</TableCell>
            <TableCell className="text-[13px]">{o.lot ? <Link className="text-primary hover:underline" to={`/wms/lots/${o.lot_id}`}>{o.lot.lot_number}</Link> : '—'}{o.lot?.expiry_date ? <span className="text-muted-foreground"> · {t('best before {date}', { date: formatDate(o.lot.expiry_date) })}</span> : ''}</TableCell>
            <TableCell className="text-right tabular">{formatQty(o.quantity)}</TableCell><TableCell className="text-right tabular">{o.output_type === 'scrap' ? '—' : formatMoney(o.unit_cost)}</TableCell>
            <TableCell className="text-right tabular">{o.output_type === 'scrap' ? '—' : formatMoney(num(o.quantity) * num(o.unit_cost))}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </CardContent></Card>
  )
}

function CostTab({ w }: { w: WorkOrderDetail }) {
  const rows = [
    { k: t('Materials'), p: num(w.planned_material_cost), a: num(w.material_cost) },
    { k: t('Labour'), p: num(w.planned_labor_cost), a: num(w.labor_cost) },
    { k: t('Overhead'), p: num(w.planned_overhead_cost), a: num(w.overhead_cost) },
  ]
  const tp = rows.reduce((s, r) => s + r.p, 0); const ta = rows.reduce((s, r) => s + r.a, 0)
  const scale = num(w.quantity_planned) ? num(w.quantity_produced || w.quantity_planned) / num(w.quantity_planned) : 1
  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle>{t('Planned against actual (without VAT)')}</CardTitle><CardDescription>{t('Planned cost is the recipe at release for {qty}. “Planned for output” scales it to what was actually made.', { qty: formatQty(w.quantity_planned) })}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead /><TableHead className="text-right">{t('Planned')}</TableHead><TableHead className="text-right">{t('Planned for output')}</TableHead><TableHead className="text-right">{t('Actual')}</TableHead><TableHead className="text-right">{t('Difference')}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r) => { const d = r.a - r.p * scale; return (
              <TableRow key={r.k} className="hover:bg-transparent"><TableCell className="font-medium">{r.k}</TableCell><TableCell className="text-right tabular">{formatMoney(r.p)}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{formatMoney(r.p * scale)}</TableCell><TableCell className="text-right tabular">{formatMoney(r.a)}</TableCell>
                <TableCell className={cn('text-right tabular', d > 0.005 ? 'text-destructive' : d < -0.005 ? 'text-success' : 'text-muted-foreground')}>{d > 0 ? '+' : ''}{formatMoney(d)}</TableCell></TableRow>) })}
            </TableBody>
            <TableFooter><TableRow className="hover:bg-transparent"><TableCell className="font-semibold">{t('Total')}</TableCell><TableCell className="text-right tabular font-semibold">{formatMoney(tp)}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(tp * scale)}</TableCell><TableCell className="text-right tabular font-semibold">{formatMoney(ta)}</TableCell>
              <TableCell className={cn('text-right tabular font-semibold', ta - tp * scale > 0.005 ? 'text-destructive' : 'text-success')}>{ta - tp * scale > 0 ? '+' : ''}{formatMoney(ta - tp * scale)}</TableCell></TableRow></TableFooter>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle>{t('Where the cost went (without VAT)')}</CardTitle></CardHeader>
        <CardContent className="grid gap-1.5 text-[13px]">
          <Row k={t('Booked into production')} v={formatMoney(ta)} />
          <Row k={t('Moved to finished goods')} v={`−${formatMoney(w.output_value)}`} />
          <Row k={t('Cost difference')} v={num(w.variance_value) ? `−${formatMoney(w.variance_value)}` : '—'} />
          <div className="my-1 border-t" />
          <Row k={t('Still in production')} v={formatMoney(ta - num(w.output_value) - num(w.variance_value))} strong />
          <p className="mt-2 text-xs text-muted-foreground">{t('Partial output is valued at the planned unit cost; the last output takes whatever is left, so finished goods carry the actual cost. Closing books any remainder as a cost difference.')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className={cn('flex justify-between gap-3', strong && 'font-semibold')}><span className="text-muted-foreground">{k}</span><span className="tabular">{v}</span></div>
)

function PlanningTab({ w, editable }: { w: WorkOrderDetail; editable: boolean }) {
  const update = useUpdateWorkOrder()
  const [start, setStart] = React.useState(toLocal(w.planned_start))
  const [end, setEnd] = React.useState(toLocal(w.planned_end))
  const [priority, setPriority] = React.useState(String(w.priority))
  const [notes, setNotes] = React.useState(w.notes ?? '')
  return (
    <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-4">
      <div className="grid gap-1.5"><Label htmlFor="pl-s">{t('Planned start')}</Label><Input id="pl-s" type="datetime-local" value={start} disabled={!editable} onChange={(e) => setStart(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="pl-e">{t('Due')}</Label><Input id="pl-e" type="datetime-local" value={end} disabled={!editable} onChange={(e) => setEnd(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label>{t('Priority')}</Label>
        <Select value={priority} onValueChange={setPriority} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{['1', '2', '3', '4', '5'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5 text-[13px]"><Label>{t('Actual')}</Label><div className="text-muted-foreground">{w.actual_start ? `${formatDate(w.actual_start, true)} → ${w.actual_end ? formatDate(w.actual_end, true) : t('now')}` : t('Not started')}</div></div>
      <div className="grid gap-1.5 sm:col-span-3"><Label htmlFor="pl-n">{t('Notes')}</Label><Input id="pl-n" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="flex items-end text-[13px] text-muted-foreground">{t('Responsible: {name}', { name: w.responsible?.full_name ?? '—' })}</div>
      {editable && <div className="sm:col-span-4"><Button loading={update.isPending} disabled={!!start && !!end && end < start} onClick={async () => {
        await update.mutateAsync({ id: w.id, planned_start: start ? new Date(start).toISOString() : null, planned_end: end ? new Date(end).toISOString() : null, priority: Number(priority), notes: notes || null })
        toast.success(t('Planning saved'))
      }}><CalendarClock /> {t('Save planning')}</Button></div>}
    </CardContent></Card>
  )
}

/* ------------------------------------------------------------------ dialogs */
function LotPicker({ variantId, locationId, value, onChange }: { variantId: string; locationId: string; value: string | null; onChange: (v: string | null) => void }) {
  const lots = useLotsAt(variantId, locationId)
  return (
    <Select value={value ?? '__fefo'} onValueChange={(v) => onChange(v === '__fefo' ? null : v)}>
      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="__fefo">{t('First to expire')}</SelectItem>
        {(lots.data ?? []).map((l) => <SelectItem key={l.lot_id} value={l.lot_id}>{l.lot?.lot_number} · {formatQty(num(l.on_hand) - num(l.reserved))}{l.lot?.expiry_date ? ` · ${formatDate(l.lot.expiry_date)}` : ''}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function ConsumeDialog({ w, rows, onClose }: { w: WorkOrderDetail; rows: MaterialRow[]; onClose: () => void }) {
  const consume = useConsume()
  const [qty, setQty] = React.useState<Record<string, string>>(() => Object.fromEntries(rows.map((m) => [m.material_id, m.remaining ? String(m.remaining) : ''])))
  const [lot, setLot] = React.useState<Record<string, string | null>>({})
  const items = rows.map((m) => ({ material_id: m.material_id, quantity: num(qty[m.material_id]), lot_id: lot[m.material_id] ?? null })).filter((i) => i.quantity > 0)
  const value = rows.reduce((s, m) => s + num(qty[m.material_id]) * num(m.unit_cost), 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{t('Use materials')}</DialogTitle><DialogDescription>{t('From {location} into production. Using more than needed is allowed and shows in the cost.', { location: w.component_location?.code ?? '' })}</DialogDescription></DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Material')}</TableHead><TableHead className="text-right">{t('Still needed')}</TableHead><TableHead className="w-28 text-right">{t('Use now')}</TableHead><TableHead className="w-56">{t('Lot')}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((m) => (
              <TableRow key={m.material_id} className="hover:bg-transparent">
                <TableCell><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.sku} · {t('{qty} free', { qty: formatQty(m.available_at_location) })}</div></TableCell>
                <TableCell className="text-right tabular">{formatQty(m.remaining)}</TableCell>
                <TableCell><Input aria-label={t('Quantity of {sku}', { sku: m.sku })} inputMode="decimal" className={cn('h-9 text-right tabular', num(qty[m.material_id]) > m.available_at_location && 'border-destructive')} value={qty[m.material_id] ?? ''}
                  onChange={(e) => setQty((s) => ({ ...s, [m.material_id]: e.target.value.replace(',', '.') }))} /></TableCell>
                <TableCell>{m.tracking !== 'none' ? <LotPicker variantId={m.variant_id} locationId={w.component_location_id} value={lot[m.material_id] ?? null} onChange={(v) => setLot((s) => ({ ...s, [m.material_id]: v }))} /> : <span className="text-xs text-muted-foreground">{t('No lots')}</span>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
        <DialogFooter className="items-center"><span className="mr-auto text-[13px] text-muted-foreground">{t('About {amount} at current cost', { amount: formatMoney(value) })}</span>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={consume.isPending} disabled={!items.length} onClick={async () => { const r = await consume.mutateAsync({ id: w.id, items }); toast.success(t('Materials used · {amount}', { amount: formatMoney(r.value) })); onClose() }}>{tn(items.length, 'Use {n} material', 'Use {n} materials')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReturnDialog({ w, rows, onClose }: { w: WorkOrderDetail; rows: MaterialRow[]; onClose: () => void }) {
  const ret = useReturnMaterials()
  const [qty, setQty] = React.useState<Record<string, string>>({})
  const items = rows.map((m) => ({ material_id: m.material_id, quantity: num(qty[m.material_id]) })).filter((i) => i.quantity > 0)
  const bad = rows.some((m) => num(qty[m.material_id]) > m.consumed)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t('Return unused material')}</DialogTitle><DialogDescription>{t('Material goes back to {location} at the cost it left with, lowering this order\'s cost.', { location: w.component_location?.code ?? '' })}</DialogDescription></DialogHeader>
        <div className="grid gap-2">{rows.filter((m) => m.consumed > 0).map((m) => (
          <div key={m.material_id} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{t('{qty} used', { qty: formatQty(m.consumed) })}</div></div>
            <Input aria-label={t('Return quantity of {sku}', { sku: m.sku })} inputMode="decimal" className={cn('h-9 w-24 text-right tabular', num(qty[m.material_id]) > m.consumed && 'border-destructive')} value={qty[m.material_id] ?? ''}
              onChange={(e) => setQty((s) => ({ ...s, [m.material_id]: e.target.value.replace(',', '.') }))} placeholder="0" />
          </div>
        ))}</div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={ret.isPending} disabled={!items.length || bad} onClick={async () => { const r = await ret.mutateAsync({ id: w.id, items }); toast.success(t('Returned · {amount}', { amount: formatMoney(r.value) })); onClose() }}>{t('Return')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OperationDialog({ w, opId, onClose }: { w: WorkOrderDetail; opId: string; onClose: () => void }) {
  const rec = useRecordOperation()
  const op = w.operations.find((o) => o.id === opId)!
  const left = Math.max(num(op.planned_minutes) - num(op.actual_minutes), 0)
  const [min, setMin] = React.useState(String(left || ''))
  const [finish, setFinish] = React.useState(true)
  const cost = (num(min) / 60) * (num(op.work_center?.cost_per_hour) + num(op.work_center?.overhead_per_hour))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Report work · {step}', { step: op.name })}</DialogTitle><DialogDescription>{td(op.work_center?.name)} · {t('{a} of {b} planned minutes recorded.', { a: formatQty(op.actual_minutes), b: formatQty(op.planned_minutes) })}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); await rec.mutateAsync({ op: op.id, minutes: num(min), finish }); toast.success(t('Work reported')); onClose() }}>
          <div className="grid gap-1.5"><Label htmlFor="op-min">{t('Minutes worked')}</Label><Input id="op-min" autoFocus inputMode="decimal" className="h-12 text-right text-lg tabular" value={min} onChange={(e) => setMin(e.target.value.replace(',', '.'))} /></div>
          <div className="flex items-center justify-between"><Label htmlFor="op-fin">{t('This step is finished')}</Label><Switch id="op-fin" checked={finish} onCheckedChange={setFinish} /></div>
          <p className="text-[13px] text-muted-foreground">{t('Adds {amount} of labour and overhead to the production cost.', { amount: formatMoney(cost) })}</p>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={rec.isPending} disabled={num(min) < 0 || (!num(min) && !finish)}>{t('Report work')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProduceDialog({ w, onClose, onDone }: { w: WorkOrderDetail; onClose: () => void; onDone: (completed: boolean) => void }) {
  const produce = useProduce()
  const tracking = useTracking(w.variant_id)
  const left = Math.max(num(w.quantity_planned) - num(w.quantity_produced), 0)
  const [qty, setQty] = React.useState(String(left || ''))
  const [scrap, setScrap] = React.useState('')
  const [lot, setLot] = React.useState(w.output_lot?.lot_number ?? w.number)
  const [expiry, setExpiry] = React.useState(w.output_lot?.expiry_date ?? '')
  const [backflush, setBackflush] = React.useState(true)
  const needsLot = !!tracking.data && tracking.data.tracking !== 'none'
  const needsExpiry = needsLot && !!tracking.data?.track_expiry && !w.output_lot?.expiry_date
  const final = num(qty) >= left
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Book output')}</DialogTitle><DialogDescription>{t('{product} into {location}. {qty} still to make.', { product: w.variant?.name ?? '', location: w.output_location?.code ?? '', qty: formatQty(left) })}</DialogDescription></DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
          e.preventDefault()
          const r = await produce.mutateAsync({ id: w.id, qty: num(qty), scrap: num(scrap), lot: needsLot ? lot : null, expiry: needsLot && expiry ? expiry : null, backflush })
          toast.success(t('{qty} made · {cost} each', { qty: formatQty(num(qty)), cost: formatMoney(r.unit_cost) })); onDone(r.completed)
        }}>
          <div className="grid gap-1.5"><Label htmlFor="pr-q">{t('Good quantity')}</Label><Input id="pr-q" autoFocus inputMode="decimal" className="h-11 text-right text-lg tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pr-s">{t('Scrapped')}</Label><Input id="pr-s" inputMode="decimal" className="h-11 text-right text-lg tabular" value={scrap} placeholder="0" onChange={(e) => setScrap(e.target.value.replace(',', '.'))} /></div>
          {needsLot && <>
            <div className="grid gap-1.5"><Label htmlFor="pr-l">{t('Lot')}</Label><Input id="pr-l" className="font-mono" value={lot} onChange={(e) => setLot(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pr-e">{t('Best before')}{needsExpiry ? '' : ` ${t('(optional)')}`}</Label><Input id="pr-e" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          </>}
          <div className="col-span-2 flex items-start justify-between gap-3 rounded-md border p-3">
            <div><Label htmlFor="pr-b">{t('Record materials and time automatically')}</Label><p className="text-xs text-muted-foreground">{t('Uses the materials and records the work time for this part of the order, if not reported already.')}</p></div>
            <Switch id="pr-b" checked={backflush} onCheckedChange={setBackflush} />
          </div>
          <p className="col-span-2 text-[13px] text-muted-foreground">{final ? t('This completes the order: the output takes all the cost still in production.') : t('Partial output is valued at the planned unit cost; the last output takes the rest.')}</p>
          <DialogFooter className="col-span-2"><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" loading={produce.isPending} disabled={!(num(qty) > 0) || num(scrap) < 0 || (needsLot && !lot.trim()) || (needsExpiry && !expiry)}><Factory /> {t('Book output')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useTracking(variantId: string) {
  return useQueryLite(['mfg', 'tracking', variantId], async () =>
    unwrap(await supabase.from('product_variants').select('product:products(tracking, track_expiry)').eq('id', variantId).single()
      .returns<{ product: { tracking: string; track_expiry: boolean } | null }>()).product)
}
function useQueryLite<T>(key: unknown[], fn: () => Promise<T>) { return useQuery({ queryKey: key, queryFn: fn, staleTime: 5 * 60_000 }) }

