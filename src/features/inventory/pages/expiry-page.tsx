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
import { msg, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useVariantOptions, useWarehouses } from '../api'

type Lot = { lot_id: string; lot_number: string; variant_id: string; sku: string; name: string; warehouse_id: string; warehouse: string; expiry_date: string
  days_left: number; on_hand: number; value: number; price: number | null; markdown: { id: string; status: 'proposed' | 'approved'; discount_pct: number } | null }
type Markdown = { id: string; status: 'proposed' | 'approved' | 'rejected' | 'written_off'; variant_id: string; sku: string; name: string; warehouse_id: string; warehouse: string
  lot_number: string | null; expiry_date: string; days_left: number; quantity: number; discount_pct: number; note: string | null; price: number | null
  proposed_by: string | null; decided_by: string | null; created_at: string; decided_at: string | null; mine: boolean; adjustment_number: string | null; adjustment_status: string | null }
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

  const soon = (o?.lots ?? []).filter((l) => l.days_left >= 0)
  const expiredLots = (o?.lots ?? []).filter((l) => l.days_left < 0)
  const md = o?.markdowns ?? []
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
                        {m.adjustment_number ? <> · <Link className="text-primary hover:underline" to="/inventory/adjustments">{m.adjustment_number}</Link>{m.adjustment_status === 'draft' ? ` (${t('waits for the stock manager')})` : ''}</> : null}</div></TableCell>
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
        <TableRow key={`${l.lot_id}-${l.warehouse_id}`}>
          <TableCell><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.sku} · {t('lot {n}', { n: l.lot_number })}</div></TableCell>
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
  } as never })), approve ? t('Discount approved: the till sells it at that price') : t('Sent to the store manager'))
  const ok = !!variant && !!wh && !!date && num(qty) > 0 && num(pct) > 0 && num(pct) <= 90
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{lot ? t('Discount for {name}', { name: lot.name }) : t('Note a short date')}</DialogTitle>
          <DialogDescription>{t('The discount runs at the till of this store from today until the expiry date. The store manager approves it.')}</DialogDescription></DialogHeader>
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
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{m.name}</DialogTitle>
          <DialogDescription>{t('{unit} · {qty} pieces expire on {date} · proposed by {name}', { unit: td(m.warehouse), qty: formatQty(m.quantity), date: formatDate(m.expiry_date), name: m.proposed_by ?? '—' })}</DialogDescription></DialogHeader>
        {m.note && <p className="rounded-md bg-muted/60 px-3 py-2 text-[13px]">{m.note}</p>}
        <div className="grid grid-cols-2 items-end gap-3">
          <div className="grid gap-1.5"><Label htmlFor="dc-pct">{t('Discount %')}</Label><Input id="dc-pct" inputMode="decimal" className="text-right tabular" value={pct} onChange={(e) => setPct(e.target.value.replace(',', '.'))} /></div>
          {m.price != null && <div className="pb-2 text-right text-[13px]"><span className="text-muted-foreground">{t('Price without VAT')}</span><br />
            <span className="tabular">{formatMoney(m.price)} → <b>{formatMoney(num(m.price) * (1 - num(pct) / 100))}</b></span></div>}
        </div>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (optional)')} aria-label={t('Note')} />
        <DialogFooter>
          <Button variant="outline" loading={decide.isPending && decide.variables === false} onClick={() => void decide.mutateAsync(false).then(() => { toast.success(t('Rejected')); onClose() })}><X /> {t('Reject')}</Button>
          <Button loading={decide.isPending && decide.variables === true} disabled={!(num(pct) > 0 && num(pct) <= 90)}
            onClick={() => void decide.mutateAsync(true).then(() => { toast.success(t('Discount approved: the till sells it at that price')); onClose() })}><Check /> {t('Approve')}</Button>
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
