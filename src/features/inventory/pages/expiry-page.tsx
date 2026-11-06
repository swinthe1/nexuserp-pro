import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, PackageX, Percent, Plus, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getLocale, msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useCategories, usePriceRules, useVariantOptions, useWarehouses } from '../api'
import { MultiPick } from '@/components/multi-pick'

type Lot = { lot_id: string | null; lot_number: string; from_invoice?: boolean; variant_id: string; sku: string; name: string; warehouse_id: string; warehouse: string; expiry_date: string
  days_left: number; on_hand: number; value: number; price: number | null; markdown: { id: string; status: 'proposed' | 'approved'; discount_pct: number } | null
  supplier_id?: string | null; supplier?: string | null; category_id?: string | null; group_id?: string | null }
type Markdown = { id: string; status: 'proposed' | 'approved' | 'rejected' | 'written_off'; variant_id: string; sku: string; name: string; warehouse_id: string; warehouse: string
  lot_number: string | null; expiry_date: string; days_left: number; quantity: number; discount_pct: number; note: string | null; price: number | null
  proposed_by: string | null; decided_by: string | null; created_at: string; decided_at: string | null; mine: boolean; adjustment_number: string | null; adjustment_status: string | null
  level_id?: string | null; level_number?: string | null; end_level_id?: string | null; end_level_number?: string | null
  supplier_id?: string | null; supplier?: string | null; category_id?: string | null; group_id?: string | null }
type Overview = { today: string; can: { propose: boolean; decide: boolean; write_off: boolean }; lots: Lot[]; markdowns: Markdown[] }

const KEY = 'expiry'
function useOverview(warehouse: string | null, days: number) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [KEY, companyId, warehouse, days], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('expiry_overview', { p_company: companyId!, p_warehouse: warehouse ?? undefined, p_days: days })) as unknown as Overview,
  })
}
function useExpiryAction<A, R = unknown>(fn: (a: A) => Promise<R>, done?: string) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { if (done) toast.success(done); void qc.invalidateQueries({ queryKey: [KEY, companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

const daysLabel = (d: number) => d < 0 ? tn(-d, 'expired {n} day ago', 'expired {n} days ago') : d === 0 ? t('expires today') : tn(d, 'in {n} day', 'in {n} days')
function DaysBadge({ d }: { d: number }) {
  return <Badge variant="outline" className={cn('whitespace-nowrap font-medium', d < 0 ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : d <= 2 ? 'border-warning/40 bg-warning/10 text-warning' : 'text-muted-foreground')}>{daysLabel(d)}</Badge>
}
const STATUS: Record<Markdown['status'], string> = { proposed: msg('Waiting for the manager'), approved: msg('Discounted'), rejected: msg('Rejected'), written_off: msg('Taken off the shelf') }

/** Short dates: the shelf worker proposes a discount, the manager approves it, what expired comes off the shelf */
export function ExpiryPage() {
  const { companyId } = useCompany()
  const [params, setParams] = useSearchParams()
  const warehouses = useWarehouses()
  const [warehouse, setWarehouse] = React.useState<string | null>(null)
  const [days, setDays] = React.useState(7)
  const q = useOverview(warehouse, days)
  const o = q.data
  const tab = (params.get('tab') as 'soon' | 'proposals' | 'expired' | null) ?? 'soon'
  const [propose, setPropose] = React.useState<{ lot?: Lot } | null>(null)
  const [decide, setDecide] = React.useState<Markdown | null>(null)
  const [writeOff, setWriteOff] = React.useState<{ lot?: Lot; markdown?: Markdown } | null>(null)

  // filters by supplier, group and sub-group (from the meeting with the staff)
  const cats = useCategories()
  const [sups, setSups] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [subs, setSubs] = React.useState<string[]>([])
  const keep = (x: { supplier_id?: string | null; group_id?: string | null; category_id?: string | null }) =>
    (!sups.length || sups.includes(x.supplier_id ?? '')) && (!groups.length || groups.includes(x.group_id ?? '')) && (!subs.length || subs.includes(x.category_id ?? ''))
  const supOptions = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const x of [...(o?.lots ?? []), ...(o?.markdowns ?? [])]) if (x.supplier_id) m.set(x.supplier_id, x.supplier ?? '')
    return [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
  }, [o])
  const groupOptions = (cats.data ?? []).filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: td(c.name) }))
  const subOptions = (cats.data ?? []).filter((c) => c.parent_id && (!groups.length || groups.includes(c.parent_id)))
    .map((c) => ({ value: c.id, label: td(c.name), hint: td((cats.data ?? []).find((p) => p.id === c.parent_id)?.name ?? '') }))
  const lots = (o?.lots ?? []).filter(keep)
  const soon = lots.filter((l) => l.days_left >= 0)
  const expiredLots = lots.filter((l) => l.days_left < 0)
  const md = (o?.markdowns ?? []).filter(keep)
  const waiting = md.filter((m) => m.status === 'proposed')
  // a discounted item whose date passed (without a lot): it also comes off the shelf
  const expiredMd = md.filter((m) => m.status === 'approved' && m.days_left < 0 && !expiredLots.some((l) => l.markdown?.id === m.id))
  const expiredValue = expiredLots.reduce((s, l) => s + num(l.value), 0)

  return (
    <div className="grid gap-4">
      <PageHeader title={t('Short dates|menu')}
        description={t('Items about to expire in each store: the shelf worker proposes a discount, the manager approves it and the till sells it at that price until the date. What expired comes off the shelf as a loss.')}
        actions={<>
          <Select value={warehouse ?? '__all'} onValueChange={(v) => setWarehouse(v === '__all' ? null : v)}>
            <SelectTrigger className="w-48" aria-label={t('Warehouse')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all">{t('All units')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-40" aria-label={t('Look ahead')}><SelectValue /></SelectTrigger>
            <SelectContent>{[3, 7, 14, 30].map((d) => <SelectItem key={d} value={String(d)}>{tn(d, 'Next {n} day', 'Next {n} days')}</SelectItem>)}</SelectContent>
          </Select>
          {o?.can.propose && <Button onClick={() => setPropose({})}><Plus /> {t('Note a short date')}</Button>}
        </>} />

      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <MultiPick label={t('Suppliers')} value={sups} onChange={setSups} options={supOptions} />
        <MultiPick label={t('Groups')} value={groups} onChange={(v) => { setGroups(v); setSubs((x) => x.filter((id) => !v.length || v.includes((cats.data ?? []).find((c) => c.id === id)?.parent_id ?? ''))) }} options={groupOptions} />
        <MultiPick label={t('Sub-groups')} value={subs} onChange={setSubs} options={subOptions} />
        {(sups.length > 0 || groups.length > 0 || subs.length > 0) && <Button variant="ghost" size="sm" onClick={() => { setSups([]); setGroups([]); setSubs([]) }}><X /> {t('Clear filters')}</Button>}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !o ? <Skeleton className="h-72" /> : <>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('About to expire')} value={String(soon.length)} hint={tn(days, 'lots in the next {n} day', 'lots in the next {n} days')} />
          <StatCard label={t('Waiting for the manager')} value={String(waiting.length)} tone={waiting.length && o.can.decide ? 'warning' : 'default'} hint={t('discount proposals')} />
          <StatCard label={t('Expired, still in stock')} value={String(expiredLots.length + expiredMd.length)} tone={expiredLots.length + expiredMd.length ? 'destructive' : 'default'}
            hint={t('{amount} at cost', { amount: formatMoney(expiredValue) })} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setParams(v === 'soon' ? {} : { tab: v })}>
          <TabsList>
            <TabsTrigger value="soon">{t('About to expire')} ({soon.length})</TabsTrigger>
            <TabsTrigger value="proposals">{t('Discounts')} ({md.length})</TabsTrigger>
            <TabsTrigger value="expired">{t('Expired|items')} ({expiredLots.length + expiredMd.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'soon' && (
          <Card><CardContent className="overflow-x-auto p-0">
            {!soon.length ? <EmptyState icon={CalendarClock} title={t('Nothing expires soon')}
              description={t('Lots with an expiry date appear here when they are close. Items without lots: note the date from the shelf with "Note a short date".')} /> : (
              <LotTable rows={soon} onPropose={o.can.propose ? (l) => setPropose({ lot: l }) : undefined} />
            )}
          </CardContent></Card>
        )}

        {tab === 'proposals' && (
          <Card><CardContent className="overflow-x-auto p-0">
            {!md.length ? <EmptyState icon={Percent} title={t('No discounts yet')} description={t('A proposal for a short date waits here for the store manager.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{t('Item')}</TableHead><TableHead>{t('Warehouse')}</TableHead><TableHead>{t('Expiry')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead>
                  <TableHead className="text-right">{t('Discount')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead className="w-[1%]" />
                </TableRow></TableHeader>
                <TableBody>{md.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.sku}{m.lot_number ? ` · ${t('lot {n}', { n: m.lot_number })}` : ''}{m.note ? ` · ${m.note}` : ''}</div></TableCell>
                    <TableCell>{td(m.warehouse)}</TableCell>
                    <TableCell className="whitespace-nowrap"><div className="tabular">{formatDate(m.expiry_date)}</div><DaysBadge d={m.days_left} /></TableCell>
                    <TableCell className="text-right tabular">{formatQty(m.quantity)}</TableCell>
                    <TableCell className="text-right tabular"><div className="font-medium">−{num(m.discount_pct)}%</div>
                      {m.price != null && <div className="text-xs text-muted-foreground">{t('{a} → {b} without VAT', { a: formatMoney(m.price), b: formatMoney(num(m.price) * (1 - num(m.discount_pct) / 100)) })}</div>}</TableCell>
                    <TableCell className="text-[13px]"><div>{t(STATUS[m.status])}</div>
                      <div className="text-xs text-muted-foreground">{m.status === 'proposed' ? t('by {name}', { name: m.proposed_by ?? '—' }) : m.decided_by ? t('by {name}', { name: m.decided_by }) : ''}
                        {m.adjustment_number ? <> · <Link className="text-primary hover:underline" to="/inventory/adjustments">{m.adjustment_number}</Link>{m.adjustment_status === 'draft' ? ` (${t('waits for the stock manager')})` : ''}</> : null}</div>
                      {m.level_id && <div className="text-xs text-muted-foreground">{t('Price levelling')}: <Link className="text-primary hover:underline" to={`/inventory/levelling/${m.level_id}`}>{m.level_number}</Link>
                        {m.end_level_id ? <> · {t('price back')}: <Link className="text-primary hover:underline" to={`/inventory/levelling/${m.end_level_id}`}>{m.end_level_number}</Link></> : null}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {m.status === 'proposed' && o.can.decide && <Button size="sm" onClick={() => setDecide(m)}>{t('Decide')}</Button>}
                      {m.status === 'approved' && m.days_left < 0 && o.can.propose && <Button size="sm" variant="outline" onClick={() => setWriteOff({ markdown: m })}><PackageX /> {t('Take off the shelf')}</Button>}
                    </TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        )}

        {tab === 'expired' && (
          <Card><CardContent className="overflow-x-auto p-0">
            {!expiredLots.length && !expiredMd.length ? <EmptyState icon={Check} title={t('Nothing expired on the shelves')} description={t('Lots past their date that are still in stock show up here, to be taken off and booked as a loss.')} /> : <>
              {expiredLots.length > 0 && <LotTable rows={expiredLots} onWriteOff={o.can.propose ? (l) => setWriteOff({ lot: l }) : undefined} />}
              {expiredMd.length > 0 && (
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Discounted item, date passed')}</TableHead><TableHead>{t('Warehouse')}</TableHead><TableHead>{t('Expiry')}</TableHead><TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
                  <TableBody>{expiredMd.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.sku}</div></TableCell>
                      <TableCell>{td(m.warehouse)}</TableCell>
                      <TableCell className="whitespace-nowrap"><div className="tabular">{formatDate(m.expiry_date)}</div><DaysBadge d={m.days_left} /></TableCell>
                      <TableCell className="text-right tabular">{formatQty(m.quantity)}</TableCell>
                      <TableCell className="text-right">{o.can.propose && <Button size="sm" variant="outline" onClick={() => setWriteOff({ markdown: m })}><PackageX /> {t('Take off the shelf')}</Button>}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </>}
          </CardContent></Card>
        )}
      </>}

      {propose && o && companyId && <ProposeDialog lot={propose.lot} canDecide={o.can.decide} defaultWarehouse={warehouse} onClose={() => setPropose(null)} />}
      {decide && <DecideDialog m={decide} onClose={() => setDecide(null)} />}
      {writeOff && o && <WriteOffDialog lot={writeOff.lot} markdown={writeOff.markdown} canPost={o.can.write_off} onClose={() => setWriteOff(null)} />}
    </div>
  )
}

function LotTable({ rows, onPropose, onWriteOff }: { rows: Lot[]; onPropose?: (l: Lot) => void; onWriteOff?: (l: Lot) => void }) {
  return (
    <Table>
      <TableHeader><TableRow className="hover:bg-transparent">
        <TableHead>{t('Item')}</TableHead><TableHead>{t('Warehouse')}</TableHead><TableHead>{t('Expiry')}</TableHead><TableHead className="text-right">{t('In stock')}</TableHead>
        <TableHead className="text-right">{t('Value at cost')}</TableHead><TableHead className="w-[1%]" />
      </TableRow></TableHeader>
      <TableBody>{rows.map((l) => (
        <TableRow key={`${l.lot_id ?? l.variant_id}-${l.warehouse_id}-${l.expiry_date}`}>
          <TableCell><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.sku} · {l.from_invoice ? t('invoice {n}', { n: l.lot_number }) : t('lot {n}', { n: l.lot_number })}</div></TableCell>
          <TableCell>{td(l.warehouse)}</TableCell>
          <TableCell className="whitespace-nowrap"><div className="tabular">{formatDate(l.expiry_date)}</div><DaysBadge d={l.days_left} /></TableCell>
          <TableCell className="text-right tabular">{formatQty(l.on_hand)}</TableCell>
          <TableCell className="text-right tabular">{formatMoney(l.value)}</TableCell>
          <TableCell className="whitespace-nowrap text-right">
            {l.markdown ? <Badge variant="secondary">{l.markdown.status === 'approved' ? t('−{pct}% at the till', { pct: num(l.markdown.discount_pct) }) : t('Proposed −{pct}%', { pct: num(l.markdown.discount_pct) })}</Badge>
              : onPropose && <Button size="sm" variant="outline" onClick={() => onPropose(l)}><Percent /> {t('Propose a discount')}</Button>}
            {onWriteOff && <Button size="sm" variant="outline" className="ml-1" onClick={() => onWriteOff(l)}><PackageX /> {t('Take off the shelf')}</Button>}
          </TableCell>
        </TableRow>
      ))}</TableBody>
    </Table>
  )
}

function ProposeDialog({ lot, canDecide, defaultWarehouse, onClose }: { lot?: Lot; canDecide: boolean; defaultWarehouse: string | null; onClose: () => void }) {
  const { companyId } = useCompany()
  const warehouses = useWarehouses()
  const variants = useVariantOptions()
  const [variant, setVariant] = React.useState<string | null>(lot?.variant_id ?? null)
  const [wh, setWh] = React.useState<string | null>(lot?.warehouse_id ?? defaultWarehouse ?? null)
  React.useEffect(() => { if (!wh && warehouses.data?.length === 1) setWh(warehouses.data[0]!.id) }, [wh, warehouses.data])
  const [date, setDate] = React.useState(lot?.expiry_date ?? '')
  const [qty, setQty] = React.useState(lot ? String(num(lot.on_hand)) : '')
  const [pct, setPct] = React.useState('30')
  const [note, setNote] = React.useState('')
  const [approve, setApprove] = React.useState(canDecide)
  const save = useExpiryAction(async () => unwrap(await supabase.rpc('expiry_propose', { p: {
    company_id: companyId, warehouse_id: wh, lot_id: lot?.lot_id ?? null, variant_id: variant, expiry_date: date || null, quantity: num(qty), discount_pct: num(pct), note, approve,
  } as never })), approve ? t('Discount approved: written as a price levelling, the till sells it at that price') : t('Sent to the store manager'))
  const ok = !!variant && !!wh && !!date && num(qty) > 0 && num(pct) > 0 && num(pct) <= 90
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{lot ? t('Discount for {name}', { name: lot.name }) : t('Note a short date')}</DialogTitle>
          <DialogDescription>{t('The discount runs at the till of this store from today until the expiry date. The store manager approves it, and it is written as a price levelling of this store; the day after the date the price goes back by itself.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) void save.mutateAsync(undefined).then(onClose) }}>
          {!lot && (
            <div className="grid gap-1.5"><Label>{t('Item')}</Label>
              <SearchSelect value={variant} onChange={setVariant} placeholder={t('Name, code or barcode')}
                options={(variants.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.sku, keywords: v.codes ? [v.codes] : undefined }))} /></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>{t('Warehouse')}</Label>
              <Select value={wh ?? ''} onValueChange={setWh} disabled={!!lot}>
                <SelectTrigger><SelectValue placeholder={t('Choose')} /></SelectTrigger>
                <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label htmlFor="ex-date">{t('Expiry date')}</Label>
              <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!lot} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ex-qty">{t('How many on the shelf')}</Label>
              <Input id="ex-qty" inputMode="decimal" className="text-right tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ex-pct">{t('Discount %')}</Label>
              <Input id="ex-pct" inputMode="decimal" className="text-right tabular" value={pct} onChange={(e) => setPct(e.target.value.replace(',', '.'))} /></div>
          </div>
          <div className="flex flex-wrap gap-1.5">{[20, 30, 40, 50].map((p) => <Button key={p} type="button" size="sm" variant={pct === String(p) ? 'default' : 'outline'} onClick={() => setPct(String(p))}>{p}%</Button>)}</div>
          {variant && wh && <DiscountCalc variant={variant} warehouse={wh} qty={num(qty)} pct={pct} onPct={setPct} />}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note, e.g. where it is on the shelf (optional)')} aria-label={t('Note')} />
          {canDecide && <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-[13px]"><span>{t('Approve it now (you are a store manager)')}</span><Switch checked={approve} onCheckedChange={setApprove} /></label>}
          <p className="text-xs text-muted-foreground">{t('The discount applies to this item in this store. Put the short-dated pieces together, with a sticker, so customers see them.')}</p>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" loading={save.isPending} disabled={!ok}>{approve ? t('Approve the discount') : t('Send to the manager')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DecideDialog({ m, onClose }: { m: Markdown; onClose: () => void }) {
  const [pct, setPct] = React.useState(String(num(m.discount_pct)))
  const [note, setNote] = React.useState('')
  const decide = useExpiryAction(async (approve: boolean) => unwrap(await supabase.rpc('expiry_decide', { p_id: m.id, p_approve: approve, p_pct: approve ? num(pct) : undefined, p_note: note || undefined })))
  return (
    <Dialog open onOpenChange={(o) => !o && !decide.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{m.name}</DialogTitle>
          <DialogDescription>{t('{unit} · {qty} pieces expire on {date} · proposed by {name}', { unit: td(m.warehouse), qty: formatQty(m.quantity), date: formatDate(m.expiry_date), name: m.proposed_by ?? '—' })}</DialogDescription></DialogHeader>
        {m.note && <p className="rounded-md bg-muted/60 px-3 py-2 text-[13px]">{m.note}</p>}
        <div className="grid grid-cols-2 items-end gap-3">
          <div className="grid gap-1.5"><Label htmlFor="dc-pct">{t('Discount %')}</Label><Input id="dc-pct" inputMode="decimal" className="text-right tabular" value={pct} onChange={(e) => setPct(e.target.value.replace(',', '.'))} /></div>
        </div>
        <DiscountCalc variant={m.variant_id} warehouse={m.warehouse_id} qty={num(m.quantity)} pct={pct} onPct={setPct} />
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (optional)')} aria-label={t('Note')} />
        <DialogFooter>
          <Button variant="outline" loading={decide.isPending && decide.variables === false} onClick={() => void decide.mutateAsync(false).then(() => { toast.success(t('Rejected')); onClose() })}><X /> {t('Reject')}</Button>
          <Button loading={decide.isPending && decide.variables === true} disabled={!(num(pct) > 0 && num(pct) <= 90)}
            onClick={() => void decide.mutateAsync(true).then(() => { toast.success(t('Discount approved: written as a price levelling, the till sells it at that price')); onClose() })}><Check /> {t('Approve')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WriteOffDialog({ lot, markdown, canPost, onClose }: { lot?: Lot; markdown?: Markdown; canPost: boolean; onClose: () => void }) {
  const { companyId } = useCompany()
  const [qty, setQty] = React.useState(String(num(lot?.on_hand ?? markdown?.quantity ?? 0)))
  const name = lot?.name ?? markdown?.name ?? ''
  const go = useExpiryAction<void, { number: string; status: string }>(async () => unwrap(await supabase.rpc('expiry_write_off', { p: {
    company_id: companyId, warehouse_id: lot?.warehouse_id ?? markdown?.warehouse_id, lot_id: lot?.lot_id ?? null, variant_id: lot?.variant_id ?? markdown?.variant_id,
    markdown_id: markdown?.id ?? lot?.markdown?.id ?? null, quantity: num(qty),
  } as never })) as unknown as { number: string; status: string })
  return (
    <Dialog open onOpenChange={(o) => !o && !go.isPending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Take {name} off the shelf', { name })}</DialogTitle>
          <DialogDescription>{canPost ? t('The pieces leave the stock as a loss for expiry, at cost.') : t('A stock adjustment for expiry is made; the stock manager posts it.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void go.mutateAsync(undefined).then((r) => {
          toast.success(r.status === 'draft' ? t('{number} waits for the stock manager', { number: r.number }) : t('{number}: off the shelf', { number: r.number })); onClose() }) }}>
          <div className="grid gap-1.5"><Label htmlFor="wo-q">{t('How many are taken off')}</Label>
            <Input id="wo-q" autoFocus inputMode="decimal" className="h-12 text-right text-lg tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" variant="destructive" loading={go.isPending} disabled={!(num(qty) > 0)}><PackageX /> {t('Take off the shelf')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type PriceItem = { variant_id: string; price: number; vat_rate: number; cost: number; stock: number }
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * #14: the discount goes through the price calculation. The cost, the price and the margin now and with the
 * discount; below cost it says so; and what the short-dated pieces bring if they sell, against what they
 * cost if they expire and are thrown away. The new price with VAT can be typed instead of the %.
 */
function DiscountCalc({ variant, warehouse, qty, pct, onPct }: { variant: string; warehouse: string; qty: number; pct: string; onPct: (v: string) => void }) {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['inv', companyId, 'markdown-calc', variant, warehouse], enabled: !!companyId,
    queryFn: async () => ((unwrap(await supabase.rpc('price_level_items', { p_company: companyId!, p_variants: [variant], p_warehouse: warehouse })) as unknown as PriceItem[]) ?? [])[0] ?? null,
  })
  const it = q.data
  // the margin the same way as the price levelling: on the cost or on the price, as the company set it
  const basis = usePriceRules().data?.basis ?? 'markup'
  const [grossText, setGrossText] = React.useState<string | null>(null)
  if (q.isLoading) return <Skeleton className="h-40" />
  if (!it) return null
  const vat = num(it.vat_rate), price = num(it.price), cost = num(it.cost), p = Math.min(Math.max(num(pct), 0), 100)
  const gross = r2(price * (1 + vat / 100))
  const newPrice = price * (1 - p / 100), newGross = r2(newPrice * (1 + vat / 100))
  const margin = price - cost, newMargin = newPrice - cost
  const dec = (n: number, d: number) => (getLocale() === 'en' ? n.toFixed(d) : n.toFixed(d).replace('.', ','))
  const mPct = (m: number, net: number) => { const base = basis === 'markup' ? cost : net; return base > 0 ? `${dec(m / base * 100, 1)}%` : '—' }
  const below = cost > 0 && r2(cost - newPrice) >= 0.01
  const typeGross = (v: string) => {
    setGrossText(v)
    const g = num(v.replace(',', '.'))
    if (gross > 0 && g > 0 && g <= gross) onPct(String(r2((1 - g / gross) * 100)))
  }
  const row = (label: string, now: React.ReactNode, after: React.ReactNode, strong?: boolean) => (
    <tr className={cn('border-t', strong && 'font-medium')}><td className="py-1.5 pr-3 text-muted-foreground">{label}</td><td className="py-1.5 pr-3 text-right tabular">{now}</td><td className="py-1.5 text-right tabular">{after}</td></tr>)
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t('Price calculation')}</span>
        <label className="flex items-center gap-2"><span className="text-muted-foreground">{t('New price with VAT')}</span>
          <Input inputMode="decimal" className="h-8 w-28 text-right tabular" value={grossText ?? dec(newGross, 2)}
            onFocus={() => setGrossText(dec(newGross, 2))} onBlur={() => setGrossText(null)} onChange={(e) => typeGross(e.target.value)} aria-label={t('New price with VAT')} /></label>
      </div>
      <table className="w-full">
        <thead><tr className="text-xs text-muted-foreground"><th className="pb-1 text-left font-normal" /><th className="pb-1 pr-3 text-right font-normal">{t('Now')}</th><th className="pb-1 text-right font-normal">{t('With the discount')}</th></tr></thead>
        <tbody>
          {row(t('Cost without VAT'), formatMoney(cost), formatMoney(cost))}
          {row(t('Selling price without VAT'), formatMoney(price), formatMoney(newPrice))}
          {row(t('Selling price with VAT ({rate}%)', { rate: vat }), formatMoney(gross), formatMoney(newGross), true)}
          {row(t('Margin for each piece'), formatMoney(margin), <span className={cn(newMargin < 0 && 'text-destructive')}>{formatMoney(newMargin)}</span>)}
          {row(`${t('Margin %')} (${basis === 'markup' ? t('on the cost') : t('on the price')})`, mPct(margin, price), <span className={cn(newMargin < 0 && 'text-destructive')}>{mPct(newMargin, newPrice)}</span>, true)}
        </tbody>
      </table>
      {cost <= 0 && <p className="text-xs text-muted-foreground">{t('This item has no cost yet: the margin cannot be worked out.')}</p>}
      {below && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-destructive">
        {t('The new price is under the cost: {amount} lost on each piece.', { amount: formatMoney(cost - newPrice) })}</p>}
      {qty > 0 && cost > 0 && (
        <div className="grid gap-0.5 border-t pt-2">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('If the {qty} sell at this price', { qty: formatQty(qty) })}</span>
            <span className="tabular">{t('{income} in, {result} {kind}', { income: formatMoney(newPrice * qty), result: formatMoney(Math.abs(newMargin * qty)), kind: newMargin < 0 ? t('lost|money') : t('earned') })}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('If they expire and are thrown away')}</span>
            <span className="tabular text-destructive">{t('{amount} lost at cost', { amount: formatMoney(cost * qty) })}</span></div>
        </div>
      )}
    </div>
  )
}
