import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, PackageCheck, Plus, RotateCcw, Send, Truck } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatQty, num } from '@/lib/utils'
import { useShipTransfer, useWarehouses } from '@/features/inventory/api'
import { useResolveCode } from '../api'
import { QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'
import { formatQtyOf } from '@/lib/units'

/*
 * Transfers between units on the floor. The sending unit packs on the scanner and ships; the receiving unit
 * counts what arrived without seeing what was sent. Two counts that still differ go to the manager.
 */
const WH_KEY = 'drispro.wms.warehouse'
const myUnit = () => { try { return localStorage.getItem(WH_KEY) } catch { return null } }
const KEY = (co: string | null | undefined) => ['wms', co, 'floor-transfers'] as const

type Head = { id: string; number: string; status: string; from_warehouse_id: string; to_warehouse_id: string; shipped_at: string | null; created_at: string
  receive_state: string | null; receive_rounds: number; from_wh: { name: string } | null; to_wh: { name: string } | null }
const HEAD = 'id, number, status, from_warehouse_id, to_warehouse_id, shipped_at, created_at, receive_state, receive_rounds, from_wh:warehouses!stock_transfers_company_id_from_warehouse_id_fkey(name), to_wh:warehouses!stock_transfers_company_id_to_warehouse_id_fkey(name)'

function useFloorTransfers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...KEY(companyId), 'list'], enabled: !!companyId, refetchInterval: 20_000,
    queryFn: async () => unwrap(await supabase.from('stock_transfers').select(`${HEAD}, lines:stock_transfer_lines(id)`)
      .eq('company_id', companyId!).in('status', ['draft', 'in_transit']).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)) as unknown as (Head & { lines: { id: string }[] })[],
  })
}

/* ------------------------------------------------------------------ send goods: the list and a new transfer */
export function SendListPage() {
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const warehouses = useWarehouses()
  const list = useFloorTransfers()
  const qc = useQueryClient()
  const whs = (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit')
  const [from, setFrom] = React.useState<string | null>(() => myUnit())
  const [to, setTo] = React.useState<string>('')
  const unit = from && whs.some((w) => w.id === from) ? from : whs.length === 1 ? whs[0]!.id : null
  const start = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('transfer_pack_start', { p_from: unit!, p_to: to })) as string,
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: KEY(companyId) }); navigate(`/wms/send/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  const mine = (list.data ?? []).filter((x) => !unit || x.from_warehouse_id === unit)
  return (
    <ScanShell title={t('Send goods')} back={{ href: '/wms', label: t('Warehouse floor') }}>
      <p className="text-[13px] text-muted-foreground">{t('Scan the goods for another unit; when everything is in, ship. The other unit counts what arrives without seeing your figures.')}</p>
      <Can perm="wms.write">
        <div className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1 text-[13px]"><span className="text-muted-foreground">{t('From')}</span>
            <Select value={unit ?? ''} onValueChange={(v) => { setFrom(v); try { localStorage.setItem(WH_KEY, v) } catch { /* ignore */ } }}>
              <SelectTrigger><SelectValue placeholder={t('Choose the unit')} /></SelectTrigger>
              <SelectContent>{whs.map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="grid gap-1 text-[13px]"><span className="text-muted-foreground">{t('To')}</span>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue placeholder={t('Choose the unit')} /></SelectTrigger>
              <SelectContent>{whs.filter((w) => w.id !== unit).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
            </Select></label>
          <Button disabled={!unit || !to} loading={start.isPending} onClick={() => start.mutate()}><Plus /> {t('Start packing')}</Button>
        </div>
      </Can>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <Skeleton className="h-32" /> : !mine.length
        ? <EmptyState compact icon={Truck} title={t('Nothing being packed')} description={t('Choose where the goods go and start packing.')} />
        : (
          <div className="grid gap-2">
            {mine.map((x) => (
              <Link key={x.id} to={x.status === 'draft' ? `/wms/send/${x.id}` : `/inventory/transfers/${x.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/50">
                <div className="min-w-0"><div className="font-semibold">{td(x.from_wh?.name ?? '')} → {td(x.to_wh?.name ?? '')}</div>
                  <div className="text-[13px] text-muted-foreground">{x.number} · {x.status === 'draft' ? t('being packed') : t('on the road since {date}', { date: formatDate(x.shipped_at, true) })}</div></div>
                <span className="text-[13px] tabular text-muted-foreground">{tn(x.lines.length, '{n} item', '{n} items')}</span>
              </Link>
            ))}
          </div>
        )}
    </ScanShell>
  )
}

/* ------------------------------------------------------------------ packing one transfer */
type PackLine = { id: string; variant_id: string; lot_id: string | null; quantity: number; variant: { sku: string; name: string } | null; lot: { lot_number: string } | null }
export function PackPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const resolve = useResolveCode()
  const st = useScanStatus()
  const ship = useShipTransfer()
  const [edit, setEdit] = React.useState<PackLine | null>(null)
  const q = useQuery({
    queryKey: [...KEY(companyId), 'pack', id], enabled: !!id && !!companyId,
    queryFn: async () => unwrap(await supabase.from('stock_transfers').select(`${HEAD}, lines:stock_transfer_lines(id, variant_id, lot_id, quantity, variant:product_variants(sku, name), lot:lots(lot_number))`)
      .eq('id', id!).single()) as unknown as Head & { lines: PackLine[] },
  })
  const add = async (variant: string, qty: number, lot: string | null, set = false) => {
    try {
      const r = unwrap(await supabase.rpc('transfer_pack_add', { p_transfer: id!, p_variant: variant, p_qty: qty, p_lot: (lot ?? null) as unknown as string, p_set: set })) as unknown as { quantity: number; name: string }
      scanFeedback('ok'); st.ok(t('{item}: {n}', { item: r.name, n: formatQtyOf(r.quantity, variant) }))
      void qc.invalidateQueries({ queryKey: KEY(companyId) })
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }
  const onScan = async (code: string) => {
    const r = await resolve(code)
    if (r.kind === 'variant') { if (r.tracking !== 'none') { scanFeedback('error'); st.error(t('Scan the lot label of this item')); return } await add(r.variantId, r.qty, null); return }
    if (r.kind === 'lot') { await add(r.variantId, 1, r.lotId); return }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  const tr = q.data
  if (tr.status !== 'draft') return <EmptyState title={t('{number} is on its way', { number: tr.number })} action={<Button asChild variant="outline"><Link to="/wms/send">{t('Back to the list')}</Link></Button>} />
  const units = tr.lines.reduce((a, l) => a + num(l.quantity), 0)
  return (
    <ScanShell title={`${td(tr.from_wh?.name ?? '')} → ${td(tr.to_wh?.name ?? '')}`} back={{ href: '/wms/send', label: t('Send goods') }}
      meta={<span className="text-[13px] text-muted-foreground">{tr.number} · {tn(tr.lines.length, '{n} item', '{n} items')} · {t('{n} units', { n: formatQty(units) })}</span>}
      actions={<ConfirmDialog trigger={<Button disabled={!tr.lines.length}><Send /> {t('Ship')}</Button>} title={t('Ship the goods?')}
        description={t('The goods leave this unit now and are on the road until the other unit counts and receives them.')}
        confirmLabel={t('Ship')} onConfirm={async () => { await ship.mutateAsync(tr.id); toast.success(t('Shipped')); navigate('/wms/send') }} />}>
      <ScanInput onScan={onScan} placeholder={t('Scan each item: one scan, one piece (a box adds its pieces)')} status={st.status} />
      {!tr.lines.length ? <EmptyState compact title={t('Nothing packed yet')} description={t('Scan the first item.')} /> : (
        <div className="divide-y rounded-xl border bg-card">
          {tr.lines.map((l) => (
            <button key={l.id} type="button" onClick={() => setEdit(l)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-muted/50">
              <span className="min-w-0"><span className="block truncate font-medium">{l.variant?.name}</span>
                <span className="text-muted-foreground">{l.variant?.sku}{l.lot ? ` · ${l.lot.lot_number}` : ''}</span></span>
              <span className="text-lg font-semibold tabular">{formatQtyOf(l.quantity, l.variant_id)}</span>
            </button>
          ))}
        </div>
      )}
      <QtyDialog open={!!edit} title={edit?.variant?.name ?? ''} description={t('Write how many go; 0 takes the item off.')} initial={num(edit?.quantity)}
        onClose={() => setEdit(null)} onSubmit={(n) => { const l = edit!; setEdit(null); void add(l.variant_id, n, l.lot_id, true) }} />
    </ScanShell>
  )
}

/* ------------------------------------------------------------------ receiving one transfer, blind */
type CountLine = { id: string; variant_id: string; lot_id: string | null; quantity_counted: number | null; recount: boolean; variant: { sku: string; name: string } | null }
export function BlindReceivePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const resolve = useResolveCode()
  const st = useScanStatus()
  const [edit, setEdit] = React.useState<CountLine | null>(null)
  const [again, setAgain] = React.useState<string[] | null>(null)
  // only what the receiver may see: the items and their own counts, never the quantities sent
  const q = useQuery({
    queryKey: [...KEY(companyId), 'count', id], enabled: !!id && !!companyId,
    queryFn: async () => unwrap(await supabase.from('stock_transfers').select(`${HEAD}, lines:stock_transfer_lines(id, variant_id, lot_id, quantity_counted, recount, variant:product_variants(sku, name))`)
      .eq('id', id!).single()) as unknown as Head & { lines: CountLine[] },
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY(companyId) })
  const count = async (variant: string, qty: number, lot: string | null, set = false) => {
    try {
      const r = unwrap(await supabase.rpc('transfer_count_add', { p_transfer: id!, p_variant: variant, p_qty: qty, p_lot: (lot ?? null) as unknown as string, p_set: set })) as unknown as { name: string; counted: number }
      scanFeedback('ok'); st.ok(t('{item}: {n}', { item: r.name, n: formatQtyOf(r.counted, variant) })); refresh()
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }
  const finish = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('transfer_receive_blind', { p_transfer: id! })) as unknown as { ok: boolean; recount?: boolean; to_manager?: boolean; items?: string[] },
    onSuccess: (r) => {
      refresh()
      if (r.ok) { scanFeedback('ok'); toast.success(t('Received: everything agrees with what was sent')); navigate('/wms/receive'); return }
      scanFeedback('error')
      if (r.recount) { setAgain(r.items ?? []); st.error(t('Some items do not agree: count them again')) }
      else toast.warning(t('Still different: the manager decides'), { description: t('The transfer waits for the manager, who sees both counts.') })
    },
    onError: (e) => { scanFeedback('error'); st.error(describeError(e)) },
  })
  const onScan = async (code: string) => {
    const r = await resolve(code)
    if (r.kind === 'variant') { await count(r.variantId, r.qty, null); return }
    if (r.kind === 'lot') { await count(r.variantId, 1, r.lotId); return }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading || !q.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  const tr = q.data
  if (tr.status !== 'in_transit') return <EmptyState title={t('{number} is already received', { number: tr.number })} action={<Button asChild variant="outline"><Link to="/wms/receive">{t('Back to the list')}</Link></Button>} />
  const waiting = tr.receive_state === 'differences'
  // the same item may sit on several lines (shelves or lots): one row per item
  const items = [...tr.lines.reduce((m, l) => {
    const k = l.variant_id
    const prev = m.get(k)
    m.set(k, { variant_id: k, name: l.variant?.name ?? '', sku: l.variant?.sku ?? '', lot: l.lot_id,
      counted: l.quantity_counted == null && !prev?.counted ? null : num(prev?.counted) + num(l.quantity_counted), recount: (prev?.recount ?? false) || l.recount })
    return m
  }, new Map<string, { variant_id: string; name: string; sku: string; lot: string | null; counted: number | null; recount: boolean }>()).values()]
  const done = items.filter((x) => x.counted != null).length
  return (
    <ScanShell title={`${td(tr.from_wh?.name ?? '')} → ${td(tr.to_wh?.name ?? '')}`} back={{ href: '/wms/receive', label: t('Receive goods') }}
      meta={<span className="text-[13px] text-muted-foreground">{tr.number} · {t('shipped {date}', { date: formatDate(tr.shipped_at, true) })} · {t('{done} of {total} items counted', { done, total: items.length })}</span>}
      actions={!waiting && <Can perm="wms.write"><ConfirmDialog trigger={<Button><Check /> {t('Finish receiving')}</Button>} title={t('Finish receiving?')}
        description={items.length - done ? tn(items.length - done, '{n} item is not counted: it counts as not arrived.', '{n} items are not counted: they count as not arrived.') : t('The program compares your count with what was sent.')}
        confirmLabel={t('Finish')} onConfirm={() => finish.mutateAsync().then(() => undefined)} /></Can>}>
      {waiting ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px]">{t('Counted twice and still different: the transfer waits for the manager, who sees both counts and decides.')}</div>
      ) : <>
        <ScanInput onScan={onScan} placeholder={t('Scan every item that arrived: one scan, one piece (a box adds its pieces)')} status={st.status} />
        <p className="text-[12.5px] text-muted-foreground">{t('You do not see how many were sent: count what you have in front of you. When everything agrees the goods are received at once.')}</p>
        {again && again.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
            <div className="flex items-center gap-1.5 font-medium text-destructive"><RotateCcw className="size-4" />{t('Count these again, from the start:')}</div>
            <div>{again.join(', ')}</div>
          </div>
        )}
      </>}
      <div className="divide-y rounded-xl border bg-card">
        {items.map((x) => (
          <button key={x.variant_id} type="button" disabled={waiting} onClick={() => setEdit(tr.lines.find((l) => l.variant_id === x.variant_id) ?? null)}
            className={cn('flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] enabled:hover:bg-muted/50', x.recount && x.counted == null && 'bg-destructive/5')}>
            <span className="min-w-0"><span className="block truncate font-medium">{x.name}</span>
              <span className="text-muted-foreground">{x.sku}</span>
              {x.recount && x.counted == null && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive">{t('count again')}</span>}</span>
            <span className={cn('text-lg font-semibold tabular', x.counted == null && 'text-muted-foreground/50')}>{x.counted == null ? '—' : formatQtyOf(x.counted, x.variant_id)}</span>
          </button>
        ))}
      </div>
      {!items.length && <EmptyState compact icon={PackageCheck} title={t('No items')} />}
      <QtyDialog open={!!edit} title={edit?.variant?.name ?? ''} description={t('Write how many you counted in all.')} initial={num(items.find((x) => x.variant_id === edit?.variant_id)?.counted)}
        onClose={() => setEdit(null)} onSubmit={(n) => { const l = edit!; setEdit(null); void count(l.variant_id, n, null, true) }} />
    </ScanShell>
  )
}
