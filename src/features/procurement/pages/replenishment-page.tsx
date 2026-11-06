import { ArrowLeftRight, Bot, Factory, Gauge, Play, RefreshCw, ShoppingCart, X } from 'lucide-react'
import { PageTableExport } from '@/components/page-table-export'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
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
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { msg, t, td, tn } from '@/i18n'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useWarehouses } from '@/features/inventory/api'
import {
  procKeys, useActiveVendors, useAutomationSettings, useCreateTransfers, useCreateWorkOrders, useGenerateReplenishment, useOrderSuggestions, useReplenishmentRuns, useRunReplenishment,
  useSaveAutomation, useSuggestions, useUpdateSuggestion, type RunAction, type RunResult, type SuggestionRow,
} from '../api'

const ACTIONS: { value: RunAction; label: string; hint: string }[] = [
  { value: 'suggest', label: msg('Suggestions only'), hint: msg('Recalculate what to order; create nothing.') },
  { value: 'draft_po', label: msg('Draft purchase orders'), hint: msg('One draft per vendor and warehouse, plus draft transfers between warehouses.') },
  { value: 'submit_po', label: msg('Submit purchase orders'), hint: msg('As drafts, then sent for approval (approved straight away when no approval is needed).') },
]

export function ReplenishmentPage() {
  const navigate = useNavigate()
  const { can, companyId } = useCompany()
  useRealtimeInvalidate('replenishment_runs', companyId, [procKeys.all(companyId)])
  const [params] = useSearchParams()
  const suggestions = useSuggestions()
  const warehouses = useWarehouses()
  const vendors = useActiveVendors()
  const generate = useGenerateReplenishment()
  const order = useOrderSuggestions()
  const transfer = useCreateTransfers()
  const makeWos = useCreateWorkOrders()
  const update = useUpdateSuggestion()
  const [warehouse, setWarehouse] = React.useState<string>('all')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [runOpen, setRunOpen] = React.useState(false)
  const [result, setResult] = React.useState<RunResult | null>(null)
  const [fromSales, setFromSales] = React.useState(false)
  const writable = can('procurement.write') || can('oms.write')

  const open = (suggestions.data ?? []).filter((s) => s.status === 'open' && (warehouse === 'all' || s.warehouse_id === warehouse))
  const recent = (suggestions.data ?? []).filter((s) => s.status === 'converted').slice(0, 12)
  const selectable = open
  const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id))
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const generatedAt = open[0]?.generated_at
  const selBuy = open.filter((s) => selected.has(s.id) && s.replenish_method === 'buy')
  const selTransfer = open.filter((s) => selected.has(s.id) && s.replenish_method === 'transfer')
  const selMake = open.filter((s) => selected.has(s.id) && s.replenish_method === 'manufacture')
  const vendorCount = new Set(selBuy.map((s) => `${s.vendor_id}|${s.warehouse_id}`)).size

  return (
    <>
      <PageHeader
        title={t('Replenishment|menu')}
        description={t('Items at or below their reorder point. Expected stock = on hand − reserved − ordered by customers but not yet reserved + already on order. Suggested quantities fill up to the maximum, respecting vendor minimums.')}
        actions={<><PageTableExport />{<>
          <Select value={warehouse} onValueChange={setWarehouse}>
            <SelectTrigger className="w-[180px]" aria-label={t('Warehouse')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All warehouses')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
          </Select>
          {writable && <Button variant="outline" loading={generate.isPending} onClick={async () => {
            const n = await generate.mutateAsync(warehouse === 'all' ? null : warehouse)
            setSelected(new Set())
            toast.success(n ? tn(n, '{n} item needs replenishing', '{n} items need replenishing') : t('Everything is above its reorder point'))
          }}><RefreshCw /> {t('Check stock now')}</Button>}
          <Can perm="procurement.read"><Button variant="outline" onClick={() => setFromSales(true)}><Gauge /> {t('Min and max from sales')}</Button></Can>
          <Can perm="procurement.write"><Button onClick={() => setRunOpen(true)}><Play /> {t('Run replenishment')}</Button></Can>
        </>}</>}
      />
      {result && <RunResultCard result={result} onClose={() => setResult(null)} />}
      {fromSales && <FromSalesDialog warehouses={(warehouses.data ?? []).map((w) => ({ id: w.id, name: td(w.name) }))} initial={warehouse === 'all' ? null : warehouse} onClose={() => setFromSales(false)} />}
      {suggestions.isLoading ? <Skeleton className="h-64" /> : suggestions.isError ? <Card><ErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} /></Card> : open.length === 0 ? (
        <Card><EmptyState title={t('Nothing to reorder')} description={generatedAt ? undefined : t('Check stock to calculate what needs ordering. Reorder points are set per product and warehouse on the product page.')}
          action={writable && <Button onClick={() => generate.mutate(warehouse === 'all' ? null : warehouse)}><RefreshCw /> {t('Check stock now')}</Button>} /></Card>
      ) : (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
            <CardTitle className="flex items-center gap-2">{t('To replenish')} <Badge variant="warning">{open.length}</Badge>{generatedAt && <span className="text-xs font-normal text-muted-foreground">{t('calculated {date}', { date: formatDate(generatedAt, true) })}</span>}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 && <span className="text-[13px] text-muted-foreground">{t('{n} selected', { n: selected.size })}</span>}
              {writable && <Button variant="ghost" size="sm" disabled={!selected.size} onClick={() => update.mutate({ ids: [...selected], values: { status: 'dismissed' } }, { onSuccess: () => setSelected(new Set()) })}><X /> {t('Dismiss')}</Button>}
              <Can perm="inventory.write">
                <Button variant="outline" size="sm" disabled={!selTransfer.length} loading={transfer.isPending} onClick={async () => {
                  const r = await transfer.mutateAsync(selTransfer.map((s) => s.id))
                  setSelected(new Set())
                  toast.success(tn(r.length, '{n} draft transfer created', '{n} draft transfers created'), { description: r.map((x) => x.number).join(', ') })
                  if (r.length === 1) navigate(`/inventory/transfers/${r[0]!.id}`)
                }}><ArrowLeftRight /> {t('Create transfers')}{selTransfer.length ? ` (${selTransfer.length})` : ''}</Button>
              </Can>
              <Can perm="manufacturing.write">
                <Button variant="outline" size="sm" disabled={!selMake.length} loading={makeWos.isPending} onClick={async () => {
                  const r = await makeWos.mutateAsync(selMake.map((s) => s.id))
                  setSelected(new Set())
                  toast.success(tn(r.length, '{n} work order created', '{n} work orders created'), { description: r.map((x) => x.number).join(', ') })
                  if (r.length === 1) navigate(`/manufacturing/orders/${r[0]!.id}`)
                }}><Factory /> {t('Create work orders')}{selMake.length ? ` (${selMake.length})` : ''}</Button>
              </Can>
              <Can perm="procurement.write">
                <Button size="sm" disabled={!selBuy.length} loading={order.isPending} onClick={async () => {
                  const r = await order.mutateAsync(selBuy.map((s) => s.id))
                  setSelected(new Set())
                  toast.success(tn(r.orders.length, '{n} draft purchase order created', '{n} draft purchase orders created'), { description: t('Review and submit them.') })
                  if (r.orders.length === 1) navigate(`/procurement/orders/${r.orders[0]}`)
                }}><ShoppingCart /> {t('Create purchase orders')}{selBuy.length ? ` (${vendorCount})` : ''}</Button>
              </Can>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[1080px]">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead className="w-10"><Checkbox aria-label={t('Select all')} checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(selectable.map((s) => s.id)) : new Set())} /></TableHead>
                <TableHead>{t('Item')}</TableHead><TableHead>{t('Warehouse')}</TableHead>
                <TableHead className="text-right">{t('On hand')}</TableHead><TableHead className="text-right">{t('Reserved')}</TableHead>
                <TableHead className="text-right" title={t('Ordered by customers, not delivered and not yet reserved')}>{t('Ordered by customers')}</TableHead>
                <TableHead className="text-right">{t('Incoming')}</TableHead>
                <TableHead className="text-right">{t('Expected|stock')}</TableHead><TableHead className="text-right">{t('Min / max')}</TableHead>
                <TableHead className="w-28 text-right">{t('Quantity')}</TableHead><TableHead className="w-56">{t('Source')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {open.map((s) => <SuggestionLine key={s.id} s={s} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} writable={can('procurement.write')}
                  vendors={(vendors.data ?? []).filter((v) => v.is_active).map((v) => ({ value: v.id, label: v.name }))}
                  onChange={(values) => update.mutate({ ids: [s.id], values })} />)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RunHistory highlight={params.get('run')} />
        <AutomationCard />
      </div>
      {recent.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="py-3"><CardTitle>{t('Recently ordered')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {recent.map((s) => (
                <li key={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-[13px]">
                  <span><span className="font-medium">{s.variant?.sku}</span> <span className="text-muted-foreground">· {t('{qty} for {warehouse}', { qty: formatQty(s.suggested_qty), warehouse: td(s.warehouse?.name) })}</span></span>
                  {s.purchase_order_id && <Link className="text-primary hover:underline" to={`/procurement/orders/${s.purchase_order_id}`}>{s.order?.number}</Link>}
                  {s.transfer_id && <Link className="text-primary hover:underline" to={`/inventory/transfers/${s.transfer_id}`}>{s.transfer?.number}</Link>}
                  {s.work_order_id && <Link className="text-primary hover:underline" to={`/manufacturing/orders/${s.work_order_id}`}>{t('Work order')}</Link>}
                  {s.order ? <StatusBadge status={s.order.status} /> : s.transfer ? <StatusBadge status={s.transfer.status} /> : <span />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <RunDialog open={runOpen} onOpenChange={setRunOpen} onDone={(r) => { setResult(r); setSelected(new Set()) }} />
    </>
  )
}

function SuggestionLine({ s, selected, onToggle, onChange, vendors, writable }: {
  s: SuggestionRow; selected: boolean; onToggle: () => void; onChange: (v: Record<string, unknown>) => void
  vendors: { value: string; label: string }[]; writable: boolean
}) {
  const [qty, setQty] = React.useState(String(s.suggested_qty))
  const method = s.replenish_method
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell><Checkbox aria-label={t('Select {number}', { number: s.variant?.sku })} checked={selected} onCheckedChange={onToggle} /></TableCell>
      <TableCell><div className="font-medium">{s.variant?.sku}</div><div className="text-xs text-muted-foreground">{s.variant?.name}</div></TableCell>
      <TableCell className="text-[13px]">{td(s.warehouse?.name)}</TableCell>
      <TableCell className="text-right tabular">{formatQty(s.on_hand)}</TableCell>
      <TableCell className="text-right tabular">{num(s.reserved) ? formatQty(s.reserved) : '—'}</TableCell>
      <TableCell className="text-right tabular">{num(s.demand) ? formatQty(s.demand) : '—'}</TableCell>
      <TableCell className="text-right tabular">{num(s.incoming) ? formatQty(s.incoming) : '—'}</TableCell>
      <TableCell className="text-right tabular font-medium text-warning"
        title={`${formatQty(s.on_hand)} − ${formatQty(s.reserved)} − ${formatQty(s.demand)} + ${formatQty(s.incoming)}`}>{formatQty(s.projected)}</TableCell>
      <TableCell className="text-right tabular text-muted-foreground">{s.rule ? `${formatQty(s.rule.min_qty)} / ${formatQty(s.rule.max_qty)}` : '—'}</TableCell>
      <TableCell>
        <Input type="number" step="any" className="h-8 text-right tabular" value={qty} disabled={!writable} aria-label={t('Quantity for {sku}', { sku: s.variant?.sku })}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => { if (num(qty) > 0 && num(qty) !== num(s.suggested_qty)) onChange({ suggested_qty: num(qty) }); else setQty(String(s.suggested_qty)) }} />
      </TableCell>
      <TableCell>
        {method === 'buy' ? <SearchSelect value={s.vendor_id} onChange={(v) => onChange({ vendor_id: v })} disabled={!writable} placeholder={t('Choose a vendor')} options={vendors} aria-invalid={!s.vendor_id} />
          : method === 'transfer' ? <span className="inline-flex items-center gap-1.5 text-[13px]"><ArrowLeftRight className="size-3.5 text-muted-foreground" /> {t('Transfer from {warehouse}', { warehouse: s.source?.name ? td(s.source.name) : '—' })}</span>
          : <Link to="/manufacturing" className="text-[13px] text-primary hover:underline">{t('Make (production plan)')}</Link>}
      </TableCell>
    </TableRow>
  )
}

function RunDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (r: RunResult) => void }) {
  const run = useRunReplenishment()
  const [action, setAction] = React.useState<RunAction>('draft_po')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Run replenishment')}</DialogTitle>
          <DialogDescription>{t('Recalculates every reorder rule for all warehouses, then does what you choose below.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label={t('What the run does')}>
          {ACTIONS.map((a) => (
            <button key={a.value} type="button" role="radio" aria-checked={action === a.value} onClick={() => setAction(a.value)}
              className={cn('rounded-md border px-3 py-2 text-left transition-colors', action === a.value ? 'border-primary bg-accent/50' : 'hover:bg-secondary/60')}>
              <div className="text-sm font-medium">{t(a.label)}</div>
              <div className="text-xs text-muted-foreground">{t(a.hint)}</div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button loading={run.isPending} onClick={async () => { const r = await run.mutateAsync(action); onOpenChange(false); onDone(r) }}><Play /> {t('Run')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RunResultCard({ result, onClose }: { result: RunResult; onClose: () => void }) {
  const { company } = useCompany()
  return (
    <Card className="mb-4 border-primary/40">
      <CardHeader className="flex-row items-start justify-between space-y-0 py-3">
        <div>
          <CardTitle>{t('Replenishment run finished')}</CardTitle>
          <CardDescription>{[tn(result.suggestions, '{n} item below its reorder point', '{n} items below their reorder point'), tn(result.purchase_orders.length, '{n} purchase order', '{n} purchase orders'), tn(result.transfers.length, '{n} transfer', '{n} transfers')].join(' · ')}</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('Close')} onClick={onClose}><X /></Button>
      </CardHeader>
      {(result.purchase_orders.length > 0 || result.transfers.length > 0 || result.skipped.length > 0) && (
        <CardContent className="grid gap-1.5 text-[13px]">
          {result.purchase_orders.map((po) => (
            <div key={po.id} className="flex flex-wrap items-center gap-2">
              <Link className="font-medium text-primary hover:underline" to={`/procurement/orders/${po.id}`}>{po.number}</Link>
              <span className="text-muted-foreground">{po.vendor}</span><StatusBadge status={po.status} />
              <span className="ml-auto tabular">{t('{amount} with VAT', { amount: formatMoney(po.total, company?.base_currency) })}</span>
            </div>
          ))}
          {result.transfers.map((x) => <div key={x.id}><Link className="font-medium text-primary hover:underline" to={`/inventory/transfers/${x.id}`}>{x.number}</Link> <span className="text-muted-foreground">{t('draft transfer')}</span></div>)}
          {result.skipped.length > 0 && <p className="text-warning">{t('Not ordered, no vendor: {items}. Set a preferred vendor on the reorder rule or in vendor prices.', { items: result.skipped.map((x) => x.sku).join(', ') })}</p>}
        </CardContent>
      )}
    </Card>
  )
}

const ACTION_LABEL: Record<string, string> = { suggest: msg('Suggestions only'), draft_po: msg('Draft orders'), submit_po: msg('Submitted orders') }

function RunHistory({ highlight }: { highlight: string | null }) {
  const runs = useReplenishmentRuns()
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{t('Run history')}</CardTitle><CardDescription>{t('Manual runs and the daily job.')}</CardDescription></CardHeader>
      <CardContent className="p-0">
        {runs.isLoading ? <Skeleton className="m-4 h-24" /> : runs.isError ? <ErrorState compact error={runs.error} onRetry={() => void runs.refetch()} /> : !runs.data?.length ? <p className="px-4 pb-4 text-[13px] text-muted-foreground">{t('No runs yet.')}</p> : (
          <ul className="divide-y">
            {runs.data.map((r) => {
              const pos = (r.purchase_orders as RunResult['purchase_orders']) ?? []
              const trs = (r.transfers as RunResult['transfers']) ?? []
              return (
                <li key={r.id} className={cn('grid gap-1 px-4 py-2 text-[13px]', highlight === r.id && 'bg-accent/50')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatDate(r.run_at, true)}</span>
                    <Badge variant={r.trigger_kind === 'schedule' ? 'secondary' : 'default'}>{r.trigger_kind === 'schedule' ? t('Daily job') : t('Manual')}</Badge>
                    <span className="text-muted-foreground">{ACTION_LABEL[r.action] ? t(ACTION_LABEL[r.action]!) : r.action}{r.by ? ` · ${r.by.full_name ?? r.by.email}` : ''}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {t('{n} below reorder point', { n: r.suggestions })}
                    {pos.length > 0 && <> · {pos.map((p, i) => <React.Fragment key={p.id}>{i ? ', ' : ' · '}<Link className="text-primary hover:underline" to={`/procurement/orders/${p.id}`}>{p.number}</Link></React.Fragment>)}</>}
                    {trs.length > 0 && <> · {trs.map((x, i) => <React.Fragment key={x.id}>{i ? ', ' : ' · '}<Link className="text-primary hover:underline" to={`/inventory/transfers/${x.id}`}>{x.number}</Link></React.Fragment>)}</>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AutomationCard() {
  const { can } = useCompany()
  const settings = useAutomationSettings()
  const save = useSaveAutomation()
  const editable = can('procurement.write')
  const s = settings.data
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> {t('Automatic replenishment')}</CardTitle>
        <CardDescription>{t('Once a day, at the hour you choose, every reorder rule is recalculated and draft purchase orders and transfers are created; people review and submit them.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!s ? <Skeleton className="h-20" /> : <>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="auto-on">{t('Run every day')}</Label>
            <Switch id="auto-on" checked={s.auto_replenish_enabled} disabled={!editable || save.isPending} onCheckedChange={(v) => save.mutate({ auto_replenish_enabled: v })} />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
            <div className="grid gap-1.5">
              <Label>{t('The daily job')}</Label>
              <Select value={s.auto_replenish_action === 'suggest' ? 'suggest' : 'draft_po'} disabled={!editable} onValueChange={(v) => save.mutate({ auto_replenish_action: v as RunAction })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="suggest">{t('Recalculates suggestions')}</SelectItem><SelectItem value="draft_po">{t('Creates draft orders')}</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('Preferred hour')}</Label>
              <Select value={String(s.auto_replenish_hour)} disabled={!editable} onValueChange={(v) => save.mutate({ auto_replenish_hour: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 border-t pt-3">
            <div className="grid gap-0.5">
              <Label htmlFor="from-units">{t('Take from other units before buying')}</Label>
              <p className="text-xs text-muted-foreground">{t('When another store or warehouse has more than its minimum, that is moved first and only the rest is bought.')}</p>
            </div>
            <Switch id="from-units" checked={s.replenish_from_units} disabled={!editable || save.isPending} onCheckedChange={(v) => save.mutate({ replenish_from_units: v })} />
          </div>
          {!editable && <p className="text-xs text-muted-foreground">{t('People who manage purchasing can change these settings.')}</p>}
        </>}
      </CardContent>
    </Card>
  )
}

type FromSalesRow = { variant_id: string; sku: string; name: string; sold: number; per_day: number; lead: number; cur_min: number | null; cur_max: number | null
  new_min: number; new_max: number; has_rule: boolean }
/**
 * Min and max for many items at once, from how fast they sold: min = daily sales × (delivery days + safety
 * days), max = min + daily sales × days of cover. Shown first; written to the items' reorder rules on request.
 */
function FromSalesDialog({ warehouses, initial, onClose }: { warehouses: { id: string; name: string }[]; initial: string | null; onClose: () => void }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const [wh, setWh] = React.useState<string>(initial ?? warehouses[0]?.id ?? '')
  const [days, setDays] = React.useState('28')
  const [lead, setLead] = React.useState('')
  const [safety, setSafety] = React.useState('2')
  const [cover, setCover] = React.useState('7')
  const [method, setMethod] = React.useState<'buy' | 'transfer'>('buy')
  const [source, setSource] = React.useState<string>('')
  const [rows, setRows] = React.useState<FromSalesRow[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const params = (apply: boolean) => ({ days: num(days) || 28, lead_days: lead === '' ? null : num(lead), safety_days: num(safety), cover_days: num(cover) || 7,
    method, source_warehouse_id: method === 'transfer' ? source || null : null, apply })
  const run = async (apply: boolean) => {
    setBusy(true)
    try {
      const r = unwrap(await supabase.rpc('replenishment_from_sales', { p_company: companyId!, p_warehouse: wh, p: params(apply) as never })) as unknown as { rows: FromSalesRow[]; written: number }
      setRows(r.rows)
      if (apply) {
        toast.success(tn(r.written, '{n} reorder rule written', '{n} reorder rules written'))
        void qc.invalidateQueries({ queryKey: procKeys.all(companyId) })
        onClose()
      }
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t('Min and max from sales')}</DialogTitle>
          <DialogDescription>{t('For every item the unit sold: minimum = daily sales × (delivery days + safety days); maximum = the minimum + daily sales × days of cover. Look first, then write them.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label>{t('Warehouse or store')}</Label>
            <Select value={wh} onValueChange={(v) => { setWh(v); setRows(null) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="fs-days">{t('Sales of the last days')}</Label><Input id="fs-days" type="number" min="7" value={days} onChange={(e) => { setDays(e.target.value); setRows(null) }} /></div>
          <div className="grid gap-1.5"><Label htmlFor="fs-lead" optional>{t('Delivery days')}</Label><Input id="fs-lead" type="number" min="0" placeholder={t('Each item\'s own, else 2')} value={lead} onChange={(e) => { setLead(e.target.value); setRows(null) }} /></div>
          <div className="grid gap-1.5"><Label htmlFor="fs-safety">{t('Safety days')}</Label><Input id="fs-safety" type="number" min="0" value={safety} onChange={(e) => { setSafety(e.target.value); setRows(null) }} /></div>
          <div className="grid gap-1.5"><Label htmlFor="fs-cover">{t('Days of cover above the minimum')}</Label><Input id="fs-cover" type="number" min="1" value={cover} onChange={(e) => { setCover(e.target.value); setRows(null) }} /></div>
          <div className="grid gap-1.5"><Label>{t('New rules fill from')}</Label>
            <Select value={method} onValueChange={(v) => { setMethod(v as 'buy' | 'transfer'); setRows(null) }}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="buy">{t('A supplier')}</SelectItem><SelectItem value="transfer">{t('Another warehouse')}</SelectItem></SelectContent></Select></div>
          {method === 'transfer' && (
            <div className="grid gap-1.5 sm:col-span-3"><Label>{t('The warehouse the goods come from')}</Label>
              <Select value={source} onValueChange={(v) => { setSource(v); setRows(null) }}><SelectTrigger className="sm:w-72"><SelectValue placeholder={t('Choose…')} /></SelectTrigger>
                <SelectContent>{warehouses.filter((w) => w.id !== wh).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
          )}
        </div>
        {rows && (rows.length === 0 ? <p className="text-[13px] text-muted-foreground">{t('Nothing sold here in those days.')}</p> : (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('Sold')}</TableHead>
                <TableHead className="text-right">{t('A day')}</TableHead><TableHead className="text-right">{t('Now|min max')}</TableHead><TableHead className="text-right">{t('New|min max')}</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map((r) => (
                <TableRow key={r.variant_id}>
                  <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.sku} · {tn(r.lead, '{n} delivery day', '{n} delivery days')}</div></TableCell>
                  <TableCell className="text-right tabular">{formatQty(r.sold)}</TableCell>
                  <TableCell className="text-right tabular">{formatQty(Math.round(num(r.per_day) * 10) / 10)}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{r.has_rule ? `${formatQty(num(r.cur_min))} / ${formatQty(num(r.cur_max))}` : '—'}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatQty(r.new_min)} / {formatQty(r.new_max)}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </div>
        ))}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button variant="outline" loading={busy && !rows} disabled={!wh || (method === 'transfer' && !source)} onClick={() => void run(false)}>{t('Show')}</Button>
          {can('procurement.write') && <Button loading={busy && !!rows} disabled={!rows?.length} onClick={() => void run(true)}>{t('Write {n} rules', { n: rows?.length ?? 0 })}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
