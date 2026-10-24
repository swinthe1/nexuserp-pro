import type { ColumnDef } from '@tanstack/react-table'
import { Banknote, Check, ExternalLink, MessageSquarePlus, RotateCcw, Truck, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, selectColumn } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { msg, t, td, tn, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, humanize, num } from '@/lib/utils'
import { useBankAccounts } from '@/features/finance/api'
import { logKeys, trackingUrl, useSettleCod, useShipment, useShipments, useUpdateShipment, type ShipmentRow } from '../api'
import { OutcomeDialog, ShipWithCarrierDialog } from '../components/dialogs'

const codState = (s: ShipmentRow) => num(s.cod_amount) <= 0 ? 'none' : s.cod_settled_at ? 'settled' : s.cod_collected ? 'collected' : 'to_collect'
const COD_LABEL: Record<string, string> = { none: msg('No cash on delivery'), to_collect: msg('To collect'), collected: msg('Collected, not settled'), settled: msg('Settled') }
const STATUSES = ['draft', 'scheduled', 'in_transit', 'delivered', 'failed', 'cancelled']

export function ShipmentsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = useShipments()
  const { companyId } = useCompany()
  useRealtimeInvalidate('shipments', companyId, [logKeys.all(companyId)])
  const [settle, setSettle] = React.useState<ShipmentRow[] | null>(null)
  const cols = React.useMemo<ColumnDef<ShipmentRow>[]>(() => [
    selectColumn<ShipmentRow>(),
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Shipment')} />, meta: { label: t('Shipment') },
      cell: ({ row: { original: s } }) => <span className="font-medium">{s.number}</span> },
    { id: 'customer', accessorFn: (s) => s.partner?.name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Customer')} />, meta: { label: t('Customer') } },
    { accessorKey: 'city', header: t('City'), meta: { label: t('City') }, cell: ({ getValue }) => (getValue() as string) ?? '—' },
    { id: 'carrier', accessorFn: (s) => s.carrier?.name ?? (s.route ? t('Own fleet') : ''), filterFn: inFilter, header: t('Carrier'), meta: { label: t('Carrier') },
      cell: ({ row: { original: s } }) => s.carrier?.name ?? (s.route ? <Link onClick={(e) => e.stopPropagation()} className="hover:underline" to={`/logistics/routes/${s.route.id}`}>{s.route.number}</Link> : '—') },
    { accessorKey: 'tracking_number', header: t('Tracking|parcel'), meta: { label: t('Tracking|parcel') },
      cell: ({ row: { original: s } }) => { const u = trackingUrl(s.carrier?.tracking_url_template, s.tracking_number)
        return u ? <a href={u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-mono text-xs hover:underline">{s.tracking_number}<ExternalLink className="size-3" /></a>
          : <span className="font-mono text-xs">{s.tracking_number ?? '—'}</span> } },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ row: { original: s } }) => <StatusBadge status={s.status} /> },
    { id: 'cod', accessorFn: (s) => num(s.cod_amount), header: ({ column }) => <ColumnHeader column={column} title={t('Cash on delivery')} />, meta: { label: t('Cash on delivery'), align: 'right' },
      cell: ({ row: { original: s } }) => <span className="tabular">{num(s.cod_amount) ? formatMoney(s.cod_amount) : '—'}</span> },
    { id: 'cod_state', accessorFn: codState, filterFn: inFilter, header: t('Cash state'), meta: { label: t('Cash state') },
      cell: ({ row: { original: s } }) => { const c = codState(s); return c === 'none' ? <span className="text-muted-foreground">—</span>
        : <Badge variant={c === 'settled' ? 'success' : c === 'collected' ? 'warning' : 'secondary'}>{t(COD_LABEL[c]!)}</Badge> } },
    { accessorKey: 'ship_date', header: ({ column }) => <ColumnHeader column={column} title={t('Ship date')} />, meta: { label: t('Ship date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'delivered_at', header: t('Delivered'), meta: { label: t('Delivered') }, cell: ({ getValue }) => formatDate(getValue() as string, true) },
  ], [])
  const initial = [
    ...(params.get('cod') ? [{ id: 'cod_state', value: [params.get('cod')!] }] : []),
    ...(params.get('status') ? [{ id: 'status', value: [params.get('status')!] }] : []),
  ]
  const carriers = [...new Set((q.data ?? []).map((s) => s.carrier?.name ?? (s.route ? t('Own fleet') : '')).filter(Boolean))]
  return (
    <>
      <PageHeader title={t('Shipments')} description={t('Every parcel that leaves: on our vans or with a carrier, with tracking and cash on delivery.')} />
      <DataTable tableKey="log.shipments" columns={cols} data={q.data} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id} exportName="shipments"
        searchPlaceholder={t('Number, customer, tracking…')} onRowClick={(r) => navigate(`/logistics/shipments/${r.id}`)} initialFilters={initial}
        initialSorting={[{ id: 'number', desc: true }]} initialHidden={['delivered_at']}
        facets={[
          { columnId: 'status', title: t('Status'), options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'carrier', title: t('Carrier'), options: carriers.map((c) => ({ value: c, label: c })) },
          { columnId: 'cod_state', title: t('Cash on delivery'), options: Object.entries(COD_LABEL).map(([value, label]) => ({ value, label: t(label) })) },
        ]}
        bulkActions={(rows, clear) => {
          const ready = rows.map((r) => r.original).filter((s) => codState(s) === 'collected')
          return <Can perm="invoicing.write"><Button size="sm" disabled={!ready.length} onClick={() => { setSettle(ready); clear() }}>
            <Banknote /> {t('Settle cash on delivery')}{ready.length ? ` (${ready.length})` : ''}</Button></Can>
        }}
        empty={{ title: t('No shipments yet'), description: t('Create them from picked deliveries on the planning board.') }} />
      {settle && <SettleDialog shipments={settle} onClose={() => setSettle(null)} />}
    </>
  )
}

function SettleDialog({ shipments, onClose }: { shipments: ShipmentRow[]; onClose: () => void }) {
  const banks = useBankAccounts()
  const settle = useSettleCod()
  const [bank, setBank] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const total = shipments.reduce((t, s) => t + num(s.cod_amount), 0)
  const options = (banks.data ?? []).filter((b) => b.account_kind === 'cash' || b.account_kind === 'bank')
  React.useEffect(() => { if (!bank && options.length) setBank((options.find((b) => b.account_kind === 'cash') ?? options[0]!).id) }, [options, bank])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Settle cash on delivery')}</DialogTitle>
          <DialogDescription>{tn(shipments.length, '{n} shipment, {amount} handed in by drivers.', '{n} shipments, {amount} handed in by drivers.', { amount: formatMoney(total) })} {t("Each becomes a customer receipt, applied to the order's open invoices.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5"><Label>{t('Paid into')}</Label>
          <Select value={bank} onValueChange={setBank}><SelectTrigger><SelectValue placeholder={t('Cash box or bank account')} /></SelectTrigger>
            <SelectContent>{options.map((b) => <SelectItem key={b.id} value={b.id}>{td(b.name)} · {b.currency_code}</SelectItem>)}</SelectContent></Select></div>
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!bank} loading={settle.isPending} onClick={async () => {
            setError(null)
            try {
              const res = await settle.mutateAsync({ shipments: shipments.map((s) => s.id), bank })
              const open = res.filter((x) => num(x.unallocated) > 0)
              toast.success(tn(res.length, '{n} receipt recorded', '{n} receipts recorded'), { description: open.length ? tn(open.length, '{n} with an amount not matched to an invoice yet', '{n} with amounts not matched to an invoice yet') : undefined })
              onClose()
            } catch (e) { setError(describeError(e)) }
          }}>{t('Record receipts')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const EVENT_DOT: Record<string, string> = { delivered: 'bg-success', failed: 'bg-destructive', in_transit: 'bg-primary', scheduled: 'bg-primary/50', cancelled: 'bg-muted-foreground' }

export function ShipmentPage() {
  const { id } = useParams()
  const q = useShipment(id)
  const upd = useUpdateShipment()
  const [outcome, setOutcome] = React.useState<React.ComponentProps<typeof OutcomeDialog>['target']>(null)
  const [carrierFor, setCarrierFor] = React.useState<{ id: string; number: string } | null>(null)
  const [noteOpen, setNoteOpen] = React.useState(false)
  const { companyId } = useCompany()
  useRealtimeInvalidate('shipments', companyId, [logKeys.all(companyId)])
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  if (!s) return <EmptyState title={t('Shipment not found')} action={<Link to="/logistics/shipments" className="text-sm text-primary hover:underline">{t('All shipments')}</Link>} />
  const url = trackingUrl(s.carrier?.tracking_url_template, s.tracking_number)
  const cod = num(s.cod_amount)
  const rows: [string, React.ReactNode][] = [
    [t('Customer'), s.partner?.name],
    [t('Address'), s.address_text ?? '—'],
    [t('Delivery'), s.delivery ? <Link className="text-primary hover:underline" to={`/sales/deliveries/${s.delivery.id}`}>{s.delivery.number}</Link> : '—'],
    [t('Sales order'), s.order ? <Link className="text-primary hover:underline" to={`/sales/orders/${s.order.id}`}>{s.order.number}</Link> : '—'],
    [t('Carrier'), s.carrier?.name ?? (s.route ? <Link className="text-primary hover:underline" to={`/logistics/routes/${s.route.id}`}>{t('Own fleet')} · {s.route.number}</Link> : '—')],
    [t('Tracking|parcel'), url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">{s.tracking_number}<ExternalLink className="size-3" /></a> : (s.tracking_number ?? '—')],
    [t('Parcels'), `${s.packages}${s.weight_kg ? ` · ${num(s.weight_kg)} kg` : ''}`],
    [t('Ship date'), formatDate(s.ship_date)],
    [t('Delivered'), formatDate(s.delivered_at, true)],
    [t('Attempts'), s.attempts],
    [t('Cash on delivery'), cod ? <span>{formatMoney(cod)} · {s.cod_settled_at ? <>{t('settled')}{s.payment && <> · <Link className="text-primary hover:underline" to={`/finance/payments/${s.payment.id}`}>{s.payment.number}</Link></>}</>
      : s.cod_collected ? t('collected, not settled') : t('to collect')}</span> : t('None')],
  ]
  return (
    <>
      <PageHeader back={{ href: '/logistics/shipments', label: t('Shipments') }} title={s.number} meta={<StatusBadge status={s.status} />}
        description={s.failure_reason && s.status === 'failed' ? t('Not delivered: {reason}', { reason: tServer(s.failure_reason) }) : undefined}
        actions={<Can perm="logistics.write">
          {['draft', 'scheduled'].includes(s.status) && <Button variant="outline" onClick={() => setCarrierFor({ id: s.id, number: s.number })}><Truck /> {t('Send with a carrier')}</Button>}
          {s.status === 'in_transit' && <>
            <Button variant="outline" onClick={() => setOutcome({ kind: 'shipment', id: s.id, number: s.number, outcome: 'failed', cod: 0, partner: s.partner?.name })}><X /> {t('Not delivered')}</Button>
            <Button onClick={() => setOutcome({ kind: 'shipment', id: s.id, number: s.number, outcome: 'delivered', cod: s.cod_collected ? 0 : cod, partner: s.partner?.name })}><Check /> {t('Mark delivered')}</Button>
          </>}
          {s.status === 'failed' && <>
            <Button variant="outline" loading={upd.isPending} onClick={async () => {
              try { await upd.mutateAsync({ shipment: s.id, status: 'cancelled', note: 'Cancelled after a failed delivery' }); toast.success(t('Shipment cancelled')) } catch (e) { toast.error(describeError(e)) }
            }}>{t('Cancel shipment')}</Button>
            <Button loading={upd.isPending} onClick={async () => {
              try { await upd.mutateAsync({ shipment: s.id, status: 'scheduled', note: 'Rescheduled' }); toast.success(t('Back on the planning board')) } catch (e) { toast.error(describeError(e)) }
            }}><RotateCcw /> {t('Reschedule')}</Button>
          </>}
          <Button variant="ghost" onClick={() => setNoteOpen(true)}><MessageSquarePlus /> {t('Add note')}</Button>
        </Can>} />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start"><CardContent className="p-0">
          <dl className="divide-y text-[13px]">{rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v ?? '—'}</dd></div>
          ))}</dl>
        </CardContent></Card>
        <Card className="self-start">
          <CardHeader className="pb-2"><CardTitle>{t('Tracking|parcel')}</CardTitle></CardHeader>
          <CardContent>
            {!s.events.length ? <p className="text-[13px] text-muted-foreground">{t('No updates yet.')}</p> : (
              <ol className="relative ml-2 border-l pl-5">{[...s.events].reverse().map((e) => (
                <li key={e.id} className="relative pb-4 last:pb-0">
                  <span className={cn('absolute -left-[26px] top-1 size-2.5 rounded-full ring-4 ring-card', EVENT_DOT[e.status] ?? 'bg-muted-foreground/60')} />
                  <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="font-medium">{humanize(e.status)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(e.event_at, true)} · {humanize(e.source)}{e.location ? ` · ${e.location}` : ''}</span></div>
                  {e.note && <p className="text-[13px] text-muted-foreground">{tServer(e.note)}</p>}
                </li>
              ))}</ol>
            )}
          </CardContent>
        </Card>
      </div>
      <OutcomeDialog target={outcome} onClose={() => setOutcome(null)} />
      <ShipWithCarrierDialog shipment={carrierFor} onClose={() => setCarrierFor(null)} />
      {noteOpen && <NoteDialog shipment={s.id} onClose={() => setNoteOpen(false)} />}
    </>
  )
}

function NoteDialog({ shipment, onClose }: { shipment: string; onClose: () => void }) {
  const upd = useUpdateShipment()
  const [note, setNote] = React.useState('')
  const [loc, setLoc] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Add a tracking note')}</DialogTitle><DialogDescription>{t('For updates from the carrier or the customer, without changing the status.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="n">{t('Note')}</Label><Textarea id="n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Arrived at the sorting centre')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="l">{t('Location')} <span className="font-normal text-muted-foreground">{t('(optional)')}</span></Label><Input id="l" value={loc} onChange={(e) => setLoc(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!note.trim()} loading={upd.isPending} onClick={async () => {
            try { await upd.mutateAsync({ shipment, status: 'note', note: note.trim(), location: loc.trim() || undefined }); onClose() } catch (e) { toast.error(describeError(e)) }
          }}>{t('Add note')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
