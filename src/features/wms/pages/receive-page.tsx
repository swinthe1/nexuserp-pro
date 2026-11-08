import { AlertTriangle, Check, PackageCheck, Plus, RotateCcw, Truck } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ErrorState } from '@/components/error-state'
import { t, td, tn } from '@/i18n'
import { cn, formatDate, formatQty, todayISO } from '@/lib/utils'
import { useLocations, useVendors, useWarehouses } from '@/features/inventory/api'
import { SearchSelect } from '@/components/search-select'
import { useEnsureLot, useFinishReceipt, useOpenReceipts, useStartDockReceipt, useReceiptForScan, useResolveCode, type DockCount, type ReceiptLine } from '../api'
import { Progress, QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'

/** transfers from another unit, shipped and on the way: received on the transfer's page */
function useIncomingTransfers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['inv', companyId, 'incoming-transfers'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('stock_transfers').select('id, number, shipped_at, from_wh:warehouses!stock_transfers_company_id_from_warehouse_id_fkey(name), to_wh:warehouses!stock_transfers_company_id_to_warehouse_id_fkey(id, name), lines:stock_transfer_lines(quantity_done)')
      .eq('company_id', companyId!).eq('status', 'in_transit').is('deleted_at', null).order('shipped_at').limit(100)) as unknown as
      { id: string; number: string; shipped_at: string | null; from_wh: { name: string } | null; to_wh: { id: string; name: string } | null; lines: { quantity_done: number }[] }[],
  })
}

export function ReceiveListPage() {
  const navigate = useNavigate()
  const receipts = useOpenReceipts()
  const incoming = useIncomingTransfers()
  // the floor's own unit first (chosen on the floor's home)
  const myWh = (() => { try { return localStorage.getItem('drispro.wms.warehouse') } catch { return null } })()
  const transfers = (incoming.data ?? []).filter((x) => !myWh || x.to_wh?.id === myWh)
  // the floor's own unit, as with the transfers
  const mine = (receipts.data ?? []).filter((r) => !myWh || !r.warehouse_id || r.warehouse_id === myWh)
  const { status, error } = useScanStatus()
  const open = (code: string) => {
    const c = code.toUpperCase()
    const hit = mine.find((r) => r.number.toUpperCase() === c || r.po?.number.toUpperCase() === c || r.vendor_delivery_note?.toUpperCase() === c)
    if (hit) { scanFeedback('ok'); navigate(`/wms/receive/${hit.id}`) } else { scanFeedback('error'); error(t('No open receipt for “{code}”', { code })) }
  }
  const [starting, setStarting] = React.useState(false)
  return (
    <ScanShell title={t('Receive goods')} back={{ href: '/wms', label: t('Warehouse floor') }}
      actions={<Can perm="wms.write"><Button onClick={() => setStarting(true)}><Plus /> {t('Truck without an order')}</Button></Can>}>
      <ScanInput onScan={open} placeholder={t('Scan the order, receipt or delivery note number')} status={status} />
      {starting && <StartDockReceipt defaultWarehouse={myWh} onClose={() => setStarting(false)} onStarted={(id) => navigate(`/wms/receive/${id}`)} />}
      {transfers.length > 0 && (
        <div className="grid gap-2">
          <div className="text-[13px] font-medium text-muted-foreground">{t('Goods waiting to be received from other units')}</div>
          {transfers.map((x) => (
            <Link key={x.id} to={`/inventory/transfers/${x.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 hover:border-primary">
              <div className="min-w-0"><div className="font-semibold">{td(x.from_wh?.name ?? '')} → {td(x.to_wh?.name ?? '')}</div>
                <div className="text-[13px] text-muted-foreground">{x.number}{x.shipped_at ? ` · ${t('shipped {date}', { date: formatDate(x.shipped_at, true) })}` : ''}</div></div>
              <div className="text-right text-[13px] font-medium tabular">{t('{n} units', { n: formatQty(x.lines.reduce((a, l) => a + Number(l.quantity_done), 0)) })}</div>
            </Link>
          ))}
        </div>
      )}
      {receipts.isError ? <ErrorState error={receipts.error} onRetry={() => void receipts.refetch()} /> : receipts.isLoading ? <Skeleton className="h-40" /> : !mine.length ? (
        <EmptyState icon={PackageCheck} title={t('Nothing to receive')} description={t('Receipts appear here when a purchase order is ready to be received, or when someone starts a receipt in the office.')} />
      ) : (
        <div className="grid gap-2">
          {mine.map((r) => (
            <Link key={r.id} to={`/wms/receive/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring">
              <div className="min-w-0">
                <div className="font-semibold">{r.vendor?.name ?? t('No vendor')}</div>
                <div className="text-[13px] text-muted-foreground">{[r.number, r.po?.number, r.vendor_delivery_note, r.warehouse?.code].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right text-[13px]"><div className="font-medium tabular">{t('{n} units', { n: formatQty(r.lines.reduce((s, l) => s + Number(l.quantity), 0)) })}</div>
                <div className="text-muted-foreground">{formatDate(r.receipt_date)}</div></div>
            </Link>
          ))}
        </div>
      )}
    </ScanShell>
  )
}

/** a truck that came without an order: the supplier, the delivery note and the unit, then scan the goods */
function StartDockReceipt({ defaultWarehouse, onClose, onStarted }: { defaultWarehouse: string | null; onClose: () => void; onStarted: (id: string) => void }) {
  const { companyId } = useCompany()
  const vendors = useVendors()
  const warehouses = useWarehouses()
  const start = useStartDockReceipt()
  const [vendor, setVendor] = React.useState<string | null>(null)
  const [wh, setWh] = React.useState<string | null>(defaultWarehouse)
  const [note, setNote] = React.useState('')
  const whs = (warehouses.data ?? []).filter((w) => w.is_active)
  React.useEffect(() => { if (!wh && whs.length === 1) setWh(whs[0]!.id) }, [whs.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Truck className="size-5" /> {t('Truck without an order')}</DialogTitle>
          <DialogDescription>{t('Choose the supplier and write the delivery note number; then scan every item. The office links it to the supplier’s invoice later.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Supplier')}</Label>
            <SearchSelect value={vendor} onChange={setVendor} placeholder={t('Choose the supplier')} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="dock-note">{t('Delivery note number')}</Label><Input id="dock-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {whs.length > 1 && <div className="grid gap-1.5"><Label>{t('Unit|store')}</Label>
            <SearchSelect value={wh} onChange={setWh} placeholder={t('Choose the unit')} options={whs.map((w) => ({ value: w.id, label: td(w.name) }))} /></div>}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!vendor || !wh} loading={start.isPending} onClick={async () => {
            try { onStarted(await start.mutateAsync({ company: companyId!, vendor: vendor!, warehouse: wh!, note })) } catch (e) { toast.error(describeError(e)) }
          }}>{t('Start scanning')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Entry = DockCount & { key: string; sku: string; name: string; expected: number; lotNumber: string | null; expiry: string | null; tracking: string; trackExpiry: boolean }

export function ReceiveScanPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const receipt = useReceiptForScan(id)
  const locations = useLocations()
  const resolve = useResolveCode()
  const ensureLot = useEnsureLot()
  const finish = useFinishReceipt()
  const st = useScanStatus()
  const storeKey = `drispro.dock.${id}`
  const [entries, setEntries] = React.useState<Entry[] | null>(null)
  const [lotFor, setLotFor] = React.useState<{ variantId: string; qty: number } | null>(null)
  const [qtyFor, setQtyFor] = React.useState<Entry | null>(null)
  const [lastKey, setLastKey] = React.useState<string | null>(null)

  // expected lines from the receipt; counts survive a refresh or a dead battery
  React.useEffect(() => {
    if (!receipt.data || entries) return
    let saved: Entry[] | null = null
    try { saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') } catch { /* ignore */ }
    const base: Entry[] = receipt.data.lines.map((l) => ({
      key: l.id, lineId: l.id, variantId: l.variant_id, poLineId: l.po_line_id, lotId: l.lot_id, qty: 0, sku: l.variant?.sku ?? '', name: l.variant?.name ?? '',
      expected: Number(l.quantity), lotNumber: l.lot?.lot_number ?? null, expiry: l.lot?.expiry_date ?? null,
      tracking: l.variant?.product?.tracking ?? 'none', trackExpiry: !!l.variant?.product?.track_expiry, unitCost: l.unit_cost,
    }))
    setEntries(saved && saved.length ? saved : base)
  }, [receipt.data, entries, storeKey])
  React.useEffect(() => { if (entries) { try { localStorage.setItem(storeKey, JSON.stringify(entries)) } catch { /* ignore */ } } }, [entries, storeKey])

  const add = React.useCallback((variantId: string, qty: number, lot?: { id: string; number: string; expiry: string | null }) => {
    setEntries((list) => {
      if (!list) return list
      const forVariant = list.filter((e) => e.variantId === variantId)
      const first = forVariant[0]!
      // same lot (or untracked): add up; a new lot of a tracked item gets its own row on the same order line
      const target = lot ? forVariant.find((e) => e.lotId === lot.id) ?? forVariant.find((e) => !e.lotId && e.qty === 0) : first
      if (target) {
        setLastKey(target.key)
        return list.map((e) => e.key === target.key ? { ...e, qty: e.qty + qty, ...(lot ? { lotId: lot.id, lotNumber: lot.number, expiry: lot.expiry } : {}) } : e)
      }
      const key = `${variantId}:${lot!.id}`
      setLastKey(key)
      return [...list, { ...first, key, lineId: null, qty, expected: 0, lotId: lot!.id, lotNumber: lot!.number, expiry: lot!.expiry }]
    })
  }, [])

  const onScan = async (code: string) => {
    if (!entries) return
    const r = await resolve(code)
    if (r.kind === 'variant' || r.kind === 'lot') {
      const variantId = r.variantId
      let e = entries.find((x) => x.variantId === variantId)
      if (!e && !receipt.data?.po && r.kind === 'variant') {
        // a receipt without an order (a truck at the door): every item scanned goes on it
        e = { key: `new:${variantId}`, lineId: null, variantId, poLineId: null, lotId: null, qty: 0, sku: r.sku, name: r.name, expected: 0,
              lotNumber: null, expiry: null, tracking: r.tracking, trackExpiry: false, unitCost: null }
        const fresh = e
        setEntries((list) => (list ? [...list, fresh] : list))
        if (r.tracking !== 'none') { scanFeedback('ok'); setLotFor({ variantId, qty: r.qty }); return }
        scanFeedback('ok'); setLastKey(fresh.key)
        setEntries((list) => (list ? list.map((x) => (x.key === fresh.key ? { ...x, qty: x.qty + r.qty } : x)) : list))
        st.ok(`+${formatQty(r.qty)} ${r.sku} · ${r.name}`); return
      }
      if (!e) { scanFeedback('error'); st.error(t('{code} is not on this receipt', { code: r.kind === 'variant' ? r.sku : r.lotNumber })); return }
      if (r.kind === 'lot') {
        scanFeedback('ok'); add(variantId, 1, { id: r.lotId, number: r.lotNumber, expiry: r.expiry }); st.ok(t('+1 {sku} · lot {lot}', { sku: e.sku, lot: r.lotNumber })); return
      }
      if (e.tracking !== 'none') { scanFeedback('ok'); setLotFor({ variantId, qty: r.qty }); return }
      scanFeedback('ok'); add(variantId, r.qty); st.ok(`+${formatQty(r.qty)} ${e.sku} · ${e.name}`)
      return
    }
    scanFeedback('error'); st.error(r.kind === 'location' ? t('{code} is a shelf — scan the product', { code: r.location.code }) : t('Unknown code “{code}”', { code }))
  }

  if (receipt.isError) return <ErrorState error={receipt.error} onRetry={() => void receipt.refetch()} />
  if (receipt.isLoading || (receipt.data && !entries)) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  if (!receipt.data || !entries) return <EmptyState title={t('Receipt not found')} action={<Button asChild variant="outline"><Link to="/wms/receive">{t('Back to the list')}</Link></Button>} />
  const rc = receipt.data
  if (rc.status !== 'draft') return <EmptyState title={t('{number} is already received', { number: rc.number })} action={<Button asChild variant="outline"><Link to={`/inventory/receipts/${rc.id}`}>{t('Open the receipt')}</Link></Button>} />

  const byVariant = new Map<string, { expected: number; counted: number }>()
  for (const e of entries) { const v = byVariant.get(e.variantId) ?? { expected: 0, counted: 0 }; v.expected += e.expected; v.counted += e.qty; byVariant.set(e.variantId, v) }
  const expected = entries.reduce((s, e) => s + e.expected, 0)
  const counted = entries.reduce((s, e) => s + e.qty, 0)
  const shorts = [...byVariant.values()].filter((v) => v.counted < v.expected).length
  const overs = [...byVariant.values()].filter((v) => v.counted > v.expected).length
  const missingLot = entries.some((e) => e.qty > 0 && e.tracking !== 'none' && !e.lotId)
  const receivingLoc = rc.lines[0]?.location_id ?? (locations.data ?? []).find((l) => l.warehouse_id === rc.warehouse_id && l.location_type === 'receiving')?.id
    ?? (locations.data ?? []).find((l) => l.warehouse_id === rc.warehouse_id && l.location_type === 'internal' && l.is_active)?.id ?? ''

  const doFinish = async () => {
    try {
      const res = await finish.mutateAsync({ receiptId: rc.id, counts: entries, lines: rc.lines as ReceiptLine[], defaultLocation: receivingLoc })
      try { localStorage.removeItem(storeKey) } catch { /* ignore */ }
      const { data: task } = await supabase.from('warehouse_tasks').select('id').eq('source_doc_id', rc.id).eq('task_type', 'putaway').maybeSingle()
      toast.success(t('{number} received · {lines}', { number: rc.number, lines: tn(res.lines, '{n} line', '{n} lines') }), { description: task ? t('A put-away task was created — the goods are waiting in the receiving area.') : undefined })
      navigate(task ? `/wms/tasks/${task.id}` : '/wms/receive')
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }

  return (
    <ScanShell title={rc.vendor?.name ?? rc.number} back={{ href: '/wms/receive', label: t('Receive goods') }}
      meta={<span className="text-[13px] text-muted-foreground">{[rc.number, rc.po?.number, rc.vendor_delivery_note].filter(Boolean).join(' · ')}</span>}
      actions={<Button variant="ghost" size="sm" onClick={() => { try { localStorage.removeItem(storeKey) } catch { /* ignore */ } setEntries(null) }}><RotateCcw /> {t('Start over')}</Button>}>
      <ScanInput onScan={onScan} placeholder={t('Scan each item (or its lot label)')} status={st.status} />
      <Progress done={counted} total={expected} />
      <div className="grid gap-2">
        {entries.map((e) => {
          const v = byVariant.get(e.variantId)!
          const firstOfVariant = entries.find((x) => x.variantId === e.variantId) === e
          const state = v.counted === v.expected ? 'ok' : v.counted > v.expected ? 'over' : v.counted > 0 ? 'short' : 'none'
          return (
            <button key={e.key} type="button" onClick={() => setQtyFor(e)}
              className={cn('flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/50',
                lastKey === e.key && 'ring-2 ring-primary/40', state === 'ok' && 'border-success/50 bg-success/5')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="font-mono text-[13px] text-muted-foreground">{e.sku}</span>
                  {state === 'ok' && <Check className="size-4 text-success" />}{state === 'over' && <AlertTriangle className="size-4 text-warning" />}</div>
                <div className="truncate font-medium">{e.name}</div>
                {e.tracking !== 'none' && <div className={cn('text-xs', e.lotId ? 'text-muted-foreground' : 'text-destructive')}>
                  {e.lotId ? (e.expiry ? t('Lot {lot} · expires {date}', { lot: e.lotNumber, date: formatDate(e.expiry) }) : t('Lot {lot}', { lot: e.lotNumber })) : t('Lot needed — scan the item to enter it')}</div>}
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular">{formatQty(e.qty)}</div>
                {firstOfVariant && <div className={cn('text-xs tabular', state === 'short' ? 'text-warning' : 'text-muted-foreground')}>{t('of {n}', { n: formatQty(v.expected) })}</div>}
              </div>
            </button>
          )
        })}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur lg:left-[244px]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="text-[13px] text-muted-foreground">{shorts ? t('{n} short', { n: shorts }) : ''}{shorts && overs ? ' · ' : ''}{overs ? t('{n} over', { n: overs }) : ''}{!shorts && !overs && counted ? t('Everything matches') : ''}</div>
          <Can perm="wms.write">
            <ConfirmDialog trigger={<Button size="lg" disabled={!counted || missingLot}>{t('Receive {n} units', { n: formatQty(counted) })}</Button>}
              title={t('Receive {number}?', { number: rc.number })}
              description={shorts || overs ? t('Quantities differ from what was expected ({short} short, {over} over). The purchase order keeps what is still open; receiving too much beyond the allowed difference is refused.', { short: shorts, over: overs }) : t('Stock goes into the receiving area and a put-away task is created.')}
              confirmLabel={t('Receive goods')} onConfirm={doFinish} />
          </Can>
        </div>
      </div>
      {lotFor && <LotDialog variant={entries.find((e) => e.variantId === lotFor.variantId)!} vendorId={rc.vendor_id}
        onClose={() => setLotFor(null)}
        onLot={async (number, expiry) => {
          try {
            const lotId = await ensureLot.mutateAsync({ variant: lotFor.variantId, lot: number, expiry, vendor: rc.vendor_id })
            add(lotFor.variantId, lotFor.qty, { id: lotId, number, expiry })
            st.ok(t('+{n} · lot {lot}', { n: formatQty(lotFor.qty), lot: number })); setLotFor(null)
          } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
        }} />}
      <QtyDialog open={!!qtyFor} title={qtyFor ? `${qtyFor.sku} · ${qtyFor.name}` : ''} description={qtyFor?.lotNumber ? t('Lot {lot}', { lot: qtyFor.lotNumber }) : t('Counted quantity')}
        initial={qtyFor?.qty ?? 0} onClose={() => setQtyFor(null)}
        onSubmit={(q) => { setEntries((l) => l!.map((e) => e.key === qtyFor!.key ? { ...e, qty: q } : e)); setQtyFor(null) }} />
    </ScanShell>
  )
}

function LotDialog({ variant, onClose, onLot }: { variant: Entry; vendorId: string | null; onClose: () => void; onLot: (n: string, expiry: string | null) => Promise<void> }) {
  const lastKey = `drispro.dock.lastlot.${variant.variantId}`
  const [number, setNumber] = React.useState(() => { try { return localStorage.getItem(lastKey) ?? '' } catch { return '' } })
  const [expiry, setExpiry] = React.useState(variant.expiry ?? '')
  const [busy, setBusy] = React.useState(false)
  const needsExpiry = variant.trackExpiry && !expiry
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{variant.tracking === 'serial' ? t('Serial number for {sku}', { sku: variant.sku }) : t('Lot for {sku}', { sku: variant.sku })}</DialogTitle>
          <DialogDescription>{variant.name}. {t('Scan the label or type it; the same lot keeps adding up.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (!number.trim() || needsExpiry) return; setBusy(true); try { localStorage.setItem(lastKey, number.trim()) } catch { /* ignore */ } await onLot(number.trim(), expiry || null); setBusy(false) }}>
          <div className="grid gap-1.5"><Label htmlFor="lot-no">{variant.tracking === 'serial' ? t('Serial number') : t('Lot number')}</Label>
            <Input id="lot-no" autoFocus className="h-12 font-mono text-base" value={number} onChange={(e) => setNumber(e.target.value)} onFocus={(e) => e.target.select()} /></div>
          {variant.trackExpiry && <div className="grid gap-1.5"><Label htmlFor="lot-exp">{t('Expiry date')}</Label>
            <Input id="lot-exp" type="date" min={todayISO()} className="h-12" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>}
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={busy} disabled={!number.trim() || needsExpiry}>{t('Add')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
