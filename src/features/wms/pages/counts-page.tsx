import { Hint } from '@/components/help'
import { ClipboardCheck, EyeOff, FileSpreadsheet, MapPin, Plus, Printer } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ScanInput, scanFeedback } from '@/components/scan-input'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tn } from '@/i18n'
import { cn, formatDate, formatQty, humanize } from '@/lib/utils'
import { useCategories, useLocations, useWarehouses, type LocationRow } from '@/features/inventory/api'
import { useCount, useCountItem, useCounts, useCreateCount, usePostCount, useResolveCode, useSubmitCount, wmsKeys, type CountLine } from '../api'
import { QtyDialog, ScanShell, useScanStatus } from '../components/scan-shell'
import { useCountPlan, useCreateCountDue } from '@/features/inventory/abc'
import { CountImportDialog, CountReviewPanel, printCountSheet } from '../components/count-tools'
import { MoreMenu } from '@/components/more-menu'

/** Count lists and screens refresh when someone else counts, submits or posts */
function useLiveCounts() {
  const { companyId } = useCompany()
  useRealtimeInvalidate('cycle_counts', companyId, [[...wmsKeys.all(companyId), 'counts'], [...wmsKeys.all(companyId), 'count']])
}

export function CountsPage() {
  const counts = useCounts()
  const [open, setOpen] = React.useState(false)
  useLiveCounts()
  return (
    <ScanShell title={t('Stock counts')} back={{ href: '/wms', label: t('Warehouse floor') }} actions={<Can perm="wms.write"><Button onClick={() => setOpen(true)}><Plus /> {t('New count')}</Button></Can>}>
      <p className="text-[13px] text-muted-foreground">{t('Count a few shelves every day instead of closing for a full inventory. Counters do not see the expected quantity; a manager reviews the differences and confirms them as one adjustment.')}</p>
      <CountPlan />
      {counts.isError ? <ErrorState error={counts.error} onRetry={() => void counts.refetch()} /> : counts.isLoading ? <Skeleton className="h-40" /> : !counts.data?.length ? <EmptyState icon={ClipboardCheck} title={t('No counts yet')} description={t('Start with the shelves that move the most.')} action={<Can perm="wms.write"><Button onClick={() => setOpen(true)}><Plus /> {t('New count')}</Button></Can>} /> : (
        <div className="grid gap-2">
          {counts.data.map((c) => {
            const counted = c.lines.filter((l) => l.counted_qty != null).length
            return (
              <Link key={c.id} to={`/wms/counts/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/50">
                <div><div className="flex items-center gap-2 font-semibold">{c.number} <StatusBadge status={c.status} />{c.blind_count && <EyeOff className="size-3.5 text-muted-foreground" aria-label={t('Blind count')} />}</div>
                  <div className="text-[13px] text-muted-foreground">{td(c.warehouse?.name)} · {humanize(c.scope)} · {formatDate(c.count_date)}</div></div>
                <div className="text-right text-[13px] tabular">{t('{done} / {total} counted', { done: counted, total: c.lines.length })}</div>
              </Link>
            )
          })}
        </div>
      )}
      {open && <NewCountDialog onClose={() => setOpen(false)} />}
    </ScanShell>
  )
}

/** what is due for counting by ABC class (A every month, B every three months, C once a year) */
function CountPlan() {
  const plan = useCountPlan()
  const due = useCreateCountDue()
  const navigate = useNavigate()
  const { can } = useCompany()
  const rows = (plan.data ?? []).filter((r) => r.classes)
  if (!rows.length) return null
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">{t('Due for counting, by class')}</div>
        <Link to="/inventory/abc" className="text-[13px] text-primary hover:underline">{t('ABC classification')}</Link>
      </div>
      <p className="text-[13px] text-muted-foreground">{t('The most valuable items are counted most often. Press "Count" and the program makes a count of what is due, A first.')}</p>
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.warehouse_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2">
            <span className="min-w-[10rem] flex-1 text-[14px] font-medium">{td(r.name)}</span>
            {(['A', 'B', 'C'] as const).map((k) => r.classes?.[k] && (
              <span key={k} className={cn('rounded-md px-2 py-0.5 text-xs tabular', r.classes[k]!.due ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
                <b className="font-mono">{k}</b> {t('{due} of {n} due', { due: r.classes[k]!.due, n: r.classes[k]!.items })}
              </span>))}
            {!r.due ? <span className="text-xs text-muted-foreground">{t('Nothing due')}</span> : can('wms.write') && (
              <Button size="sm" loading={due.isPending && due.variables?.warehouse === r.warehouse_id}
                onClick={async () => { try { const id = await due.mutateAsync({ warehouse: r.warehouse_id }); navigate(`/wms/counts/${id}`) } catch { /* toast */ } }}>
                <ClipboardCheck /> {t('Count {n}', { n: Math.min(r.due, 80) })}
              </Button>)}
          </div>
        ))}
      </div>
    </div>
  )
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const locations = useLocations()
  const categories = useCategories()
  const create = useCreateCount()
  const [wh, setWh] = React.useState<string | null>(null)
  const [bins, setBins] = React.useState<Set<string>>(new Set())
  const [category, setCategory] = React.useState<string | null>(null)
  const [blind, setBlind] = React.useState(true)
  React.useEffect(() => { if (!wh && warehouses.data?.length) setWh(warehouses.data[0]!.id) }, [warehouses.data, wh])
  const whBins = (locations.data ?? []).filter((l) => l.warehouse_id === wh && l.is_active && l.location_type !== 'view')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('New stock count')}</DialogTitle><DialogDescription>{t('Choose shelves (or a category). The expected quantity is taken now; counting can start straight away.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Warehouse')}</Label>
            <Select value={wh ?? ''} onValueChange={(v) => { setWh(v); setBins(new Set()) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{bins.size ? t('Shelves ({n})', { n: bins.size }) : t('Shelves — all when none is ticked')}</Label>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-3">
              {whBins.map((l) => (
                <label key={l.id} className="flex items-center gap-2 rounded px-1.5 py-1 font-mono text-[13px] hover:bg-muted">
                  <Checkbox checked={bins.has(l.id)} onCheckedChange={() => setBins((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })} />{l.code}</label>
              ))}
            </div></div>
          <div className="grid gap-1.5"><Label>{t('Only this category')}</Label>
            <SearchSelect value={category} onChange={setCategory} clearable placeholder={t('Any category')} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-[13px]"><span><span className="font-medium">{t('Blind count')}<Hint id="blind_count" /></span><span className="block text-muted-foreground">{t('Counters don’t see the expected quantity.')}</span></span>
            <Switch checked={blind} onCheckedChange={setBlind} /></label>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} disabled={!wh} onClick={async () => {
            try { const id = await create.mutateAsync({ warehouse: wh!, locations: [...bins], category, blind }); navigate(`/wms/counts/${id}`) } catch { /* toast */ }
          }}>{t('Start counting')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CountPage() {
  const { id } = useParams()
  const { can, company } = useCompany()
  const count = useCount(id)
  const [importing, setImporting] = React.useState(false)
  const resolve = useResolveCode()
  const countItem = useCountItem()
  const submit = useSubmitCount()
  const post = usePostCount()
  const st = useScanStatus()
  const [bin, setBin] = React.useState<LocationRow | null>(null)
  const [pendingLot, setPendingLot] = React.useState<{ variantId: string; sku: string; qty: number } | null>(null)
  const [edit, setEdit] = React.useState<CountLine | null>(null)
  const [zero, setZero] = React.useState(false)
  useLiveCounts()
  if (count.isError) return <ErrorState error={count.error} onRetry={() => void count.refetch()} />
  if (count.isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />
  if (!count.data) return <EmptyState title={t('Count not found')} action={<Button asChild variant="outline"><Link to="/wms/counts">{t('Back to stock counts')}</Link></Button>} />
  const c = count.data
  const counting = c.status === 'in_progress'
  const showSystem = !c.blind_count || c.status !== 'in_progress'
  const counted = c.lines.filter((l) => l.counted_qty != null).length

  const record = async (variantId: string, qty: number, lot: string | null, label: string, set = false) => {
    try {
      const r = await countItem.mutateAsync({ count: c.id, variant: variantId, location: bin!.id, qty, lot, set })
      scanFeedback('ok'); st.ok(t('{item} at {code}: {n}', { item: label, code: bin!.code, n: formatQty(r.counted_qty) }) + (r.offline ? ` · ${t('saved on this device')}` : ''))
    } catch (e) { scanFeedback('error'); st.error(describeError(e)) }
  }
  const onScan = async (code: string) => {
    if (!counting) return
    const r = await resolve(code)
    if (r.kind === 'location') {
      if (r.location.warehouse_id !== c.warehouse_id) { scanFeedback('error'); st.error(t('{code} is not in {warehouse}', { code: r.location.code, warehouse: td(c.warehouse?.name) })); return }
      setBin(r.location); scanFeedback('ok'); st.info(t('Counting {code} — scan every item', { code: r.location.code })); return
    }
    if (!bin) { scanFeedback('error'); st.error(t('Scan the shelf label first')); return }
    if (r.kind === 'lot') { await record(r.variantId, 1, r.lotId, r.lotNumber); return }
    if (r.kind === 'variant') {
      if (r.tracking !== 'none') { setPendingLot({ variantId: r.variantId, sku: r.sku, qty: r.qty }); scanFeedback('ok'); return }
      await record(r.variantId, r.qty, null, r.sku); return
    }
    scanFeedback('error'); st.error(t('Unknown code “{code}”', { code }))
  }
  const groups = new Map<string, CountLine[]>()
  for (const l of c.lines) groups.set(l.location?.code ?? '', [...(groups.get(l.location?.code ?? '') ?? []), l])

  return (
    <ScanShell title={c.number} back={{ href: '/wms/counts', label: t('Stock counts') }}
      meta={<><StatusBadge status={c.status} /><span className="text-[13px] text-muted-foreground">{td(c.warehouse?.name)} · {t('{done} of {total} counted', { done: counted, total: c.lines.length })}{c.blind_count ? ` · ${t('blind')}` : ''}</span></>}
      actions={<>
        {/* one button follows the count (finish → confirm → the adjustment); printing and Excel under More */}
        <MoreMenu items={[
          { label: t('Print the count sheet'), icon: Printer, onSelect: () => printCountSheet(c, company?.name ?? '') },
          { label: t('From Excel'), icon: FileSpreadsheet, hidden: !(counting && can('wms.write')), onSelect: () => setImporting(true) },
        ]} />
        {counting && <Can perm="wms.write"><ConfirmDialog trigger={<Button>{t('Finish counting')}</Button>} title={t('Finish counting?')}
          description={<span className="grid gap-3"><span>{tn(c.lines.length - counted, '{n} line is not counted.', '{n} lines are not counted.')}</span>
            <label className="flex items-center gap-2"><Checkbox checked={zero} onCheckedChange={(v) => setZero(!!v)} /> {t('Count the missing lines as zero (the shelf was checked and they are not there)')}</label></span>}
          confirmLabel={t('Send for review')} onConfirm={async () => { await submit.mutateAsync({ id: c.id, zero }); toast.success(t('Sent for review')) }} /></Can>}
        {c.status === 'review' && can('inventory.write') && <ConfirmDialog trigger={<Button>{t('Confirm differences')}</Button>} title={t('Confirm the count?')}
          description={t('Differences against the current stock become one stock adjustment (reason: count). Large adjustments may need approval.')}
          confirmLabel={t('Confirm')} onConfirm={async () => {
            const r = await post.mutateAsync(c.id)
            toast.success(r.lines ? tn(r.lines, '{n} difference confirmed', '{n} differences confirmed') : t('No differences — the stock was right'), { description: r.adjustment_status === 'pending_approval' ? t('The adjustment is waiting for approval.') : undefined })
          }} />}
        {c.adjustment_id && <Button variant="outline" asChild><Link to={`/inventory/adjustments/${c.adjustment_id}`}>{t('Open the adjustment')}</Link></Button>}
      </>}>
      {counting && <>
        <ScanInput onScan={onScan} placeholder={bin ? t('Counting {code}: scan items, or another shelf', { code: bin.code }) : t('Scan a shelf label to start')} status={st.status} />
        {bin && <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 font-mono text-lg font-semibold"><MapPin className="size-5 text-primary" />{bin.code}</div>}
      </>}
      {c.status === 'review' && <CountReviewPanel countId={c.id} />}
      <div className="grid gap-3">
        {[...groups.entries()].sort().map(([code, lines]) => (
          <div key={code} className="rounded-xl border bg-card">
            <div className="border-b px-3 py-2 font-mono text-[13px] font-semibold">{code}</div>
            {lines.map((l) => {
              const v = l.counted_qty == null ? null : Number(l.counted_qty) - Number(l.system_qty)
              return (
                <button key={l.id} type="button" disabled={!counting} onClick={() => { setBin((b) => b ?? null); setEdit(l) }}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-3 py-2 text-left text-[13px] last:border-0 enabled:hover:bg-muted/50">
                  <span className="min-w-0"><span className="block truncate font-medium">{l.variant?.name}</span><span className="text-muted-foreground">{l.variant?.sku}{l.lot ? ` · ${l.lot.lot_number}` : ''}</span>{l.recount && <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">{t('count again')}</span>}</span>
                  {showSystem ? <span className="text-right text-muted-foreground tabular">{t('expected {n}', { n: formatQty(l.system_qty) })}</span> : <span />}
                  <span className={cn('min-w-16 text-right text-lg font-semibold tabular', l.counted_qty == null && 'text-muted-foreground/50',
                    showSystem && v != null && v !== 0 && (v < 0 ? 'text-destructive' : 'text-warning'))}>
                    {l.counted_qty == null ? '—' : formatQty(l.counted_qty)}{showSystem && v ? <span className="ml-1 text-xs">({v > 0 ? '+' : ''}{formatQty(v)})</span> : null}</span>
                </button>
              )
            })}
          </div>
        ))}
        {!c.lines.length && <EmptyState title={t('No lines yet')} description={t('Scan a shelf and the items on it.')} compact />}
      </div>
      {importing && <CountImportDialog countId={c.id} onClose={() => setImporting(false)} />}
      {pendingLot && <LotPicker variantId={pendingLot.variantId} sku={pendingLot.sku} onClose={() => setPendingLot(null)}
        onPick={async (lot, num) => { const p = pendingLot; setPendingLot(null); await record(p.variantId, p.qty, lot, `${p.sku} · ${num}`) }} />}
      <QtyDialog open={!!edit} title={edit ? t('{sku} at {code}', { sku: edit.variant?.sku ?? '', code: edit.location?.code ?? '' }) : ''} description={t('Counted quantity')} initial={Number(edit?.counted_qty ?? 0)}
        onClose={() => setEdit(null)} onSubmit={async (q) => {
          const l = edit!; setEdit(null)
          try { await countItem.mutateAsync({ count: c.id, variant: l.variant_id, location: l.location_id, qty: q, lot: l.lot_id, set: true }); scanFeedback('ok') }
          catch (e) { scanFeedback('error'); st.error(describeError(e)) }
        }} />
    </ScanShell>
  )
}

function LotPicker({ variantId, sku, onClose, onPick }: { variantId: string; sku: string; onClose: () => void; onPick: (lot: string, number: string) => void }) {
  const [lots, setLots] = React.useState<{ id: string; lot_number: string; expiry_date: string | null }[] | null>(null)
  React.useEffect(() => { void supabase.from('lots').select('id, lot_number, expiry_date').eq('variant_id', variantId).is('deleted_at', null).order('expiry_date').then(({ data }) => setLots(data ?? [])) }, [variantId])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Which lot of {sku}?', { sku })}</DialogTitle><DialogDescription>{t('Or scan the lot label instead of the product barcode.')}</DialogDescription></DialogHeader>
        <div className="grid max-h-72 gap-1.5 overflow-y-auto">
          {lots?.map((l) => <Button key={l.id} variant="outline" className="justify-between" onClick={() => onPick(l.id, l.lot_number)}><span className="font-mono">{l.lot_number}</span><span className="text-xs text-muted-foreground">{formatDate(l.expiry_date)}</span></Button>)}
          {lots && !lots.length && <p className="text-[13px] text-muted-foreground">{t('No lots recorded for this item.')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
