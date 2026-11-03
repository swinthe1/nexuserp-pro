import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, ClipboardCopy, Crown, FileText, Gavel, PenLine, Plus, Save, Send, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useWarehouses } from '@/features/inventory/api'
import { formatNumberWith, t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useActiveVendors, usePurchasableVariants } from '../api'

type Quote = { line_id: string; unit_price: number; discount_pct: number; net_base: number; note: string | null }
type Offer = { id: string; vendor_id: string; name: string; email: string | null; phone: string | null; status: 'waiting' | 'answered' | 'declined' | 'won' | 'lost'
  currency_code: string; rate: number; payment_days: number | null; delivery_days: number | null; valid_until: string | null; notes: string | null
  answered_at: string | null; purchase_order_id: string | null; po_number: string | null; quotes: Quote[]; items: number; total_base: number | null; best_lines: number }
type Line = { id: string; line_no: number; variant_id: string | null; sku: string | null; description: string; quantity: number; best: number | null; paid_before: number | null }
type Rfq = { id: string; number: string; status: 'draft' | 'sent' | 'decided' | 'cancelled'; title: string; warehouse_id: string; needed_by: string | null; reply_by: string | null
  notes: string | null; sent_at: string | null; decided_at: string | null; decided_by: string | null; decision_note: string | null; created_at: string; base_currency: string
  lines: Line[]; vendors: Offer[]; best_total: number | null; unpriced_lines: number }
type ListRow = { id: string; number: string; status: Rfq['status']; title: string; needed_by: string | null; reply_by: string | null; created_at: string
  items: number; vendors: number; answered: number; winners: string | null }

const KEY = 'rfq'
const money4 = (v: number | null | undefined, cur?: string) => formatMoney(v, cur, num(v) !== 0 && Math.abs(num(v)) < 10 ? 4 : 2)

function useRfq(id?: string) {
  return useQuery({
    queryKey: [KEY, id], enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('rfq_get', { p_id: id! })) as unknown as Rfq,
  })
}
function useRfqAction<A, R = unknown>(fn: (a: A) => Promise<R>, done?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { if (done) toast.success(done); void qc.invalidateQueries({ queryKey: [KEY] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

/* ================================================================== the list */
export function RfqListPage() {
  const { companyId, can } = useCompany()
  const q = useQuery({
    queryKey: [KEY, 'list', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('rfq_list', { p_company: companyId! })) as unknown as ListRow[],
  })
  return (
    <>
      <PageHeader title={t('Offers from vendors')}
        description={t('Ask two or three vendors for the same goods, write their offers side by side, and order from the best one. No order on the word of one vendor only.')}
        actions={can('procurement.write') && <Button asChild><Link to="/procurement/rfqs/new"><Plus /> {t('New request for offers')}</Link></Button>} />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : !q.data.length ? (
            <EmptyState icon={Gavel} title={t('No requests for offers yet')} description={t('Start one for goods you buy often or in large amounts: flour for the month, drinks for the season.')}
              action={can('procurement.write') && <Button asChild><Link to="/procurement/rfqs/new"><Plus /> {t('New request for offers')}</Link></Button>} />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('Number')}</TableHead><TableHead>{t('What')}</TableHead><TableHead>{t('Status')}</TableHead>
                <TableHead className="text-right">{t('Items')}</TableHead><TableHead className="text-right">{t('Offers')}</TableHead>
                <TableHead>{t('Needed by')}</TableHead><TableHead>{t('Ordered from')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{q.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link to={`/procurement/rfqs/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></TableCell>
                  <TableCell>{r.title}<span className="block text-xs text-muted-foreground">{formatDate(r.created_at)}</span></TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right tabular">{r.items}</TableCell>
                  <TableCell className="text-right tabular">{t('{a} of {b}', { a: r.answered, b: r.vendors })}</TableCell>
                  <TableCell>{r.needed_by ? formatDate(r.needed_by) : '—'}</TableCell>
                  <TableCell>{r.winners ?? '—'}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/* ================================================================== one request */
export function RfqPage() {
  const { id } = useParams()
  const q = useRfq(id)
  if (id && q.isLoading) return <Skeleton className="mx-auto h-[480px] max-w-6xl" />
  if (id && q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const r = q.data
  if (!r || r.status === 'draft') return <RfqDraft key={r?.id ?? 'new'} rfq={r} />
  return <RfqOffers rfq={r} />
}

type DraftLine = { key: string; variant_id: string | null; quantity: string }
function RfqDraft({ rfq }: { rfq?: Rfq }) {
  const { companyId, can } = useCompany()
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const variants = usePurchasableVariants()
  const vendors = useActiveVendors()
  const [title, setTitle] = React.useState(rfq?.title ?? '')
  const [warehouse, setWarehouse] = React.useState(rfq?.warehouse_id ?? '')
  const [neededBy, setNeededBy] = React.useState(rfq?.needed_by ?? '')
  const [replyBy, setReplyBy] = React.useState(rfq?.reply_by ?? '')
  const [notes, setNotes] = React.useState(rfq?.notes ?? '')
  const [lines, setLines] = React.useState<DraftLine[]>(() => rfq?.lines.length
    ? rfq.lines.map((l) => ({ key: l.id, variant_id: l.variant_id, quantity: String(l.quantity) }))
    : [{ key: crypto.randomUUID(), variant_id: null, quantity: '' }])
  const [chosen, setChosen] = React.useState<string[]>(rfq?.vendors.map((v) => v.vendor_id) ?? [])
  React.useEffect(() => { if (!warehouse && warehouses.data?.length) setWarehouse(warehouses.data.find((w) => w.is_active)?.id ?? '') }, [warehouse, warehouses.data])
  const editable = can('procurement.write')
  const items = lines.filter((l) => l.variant_id && num(l.quantity) > 0)
  // vendors that already sell these items, to suggest
  const ids = items.map((l) => l.variant_id!).sort().join(',')
  const known = useQuery({
    queryKey: ['rfq-known-vendors', companyId, ids], enabled: !!companyId && !!ids,
    queryFn: async () => unwrap(await supabase.from('vendor_products').select('vendor_id, variant_id').in('variant_id', ids.split(',')).is('deleted_at', null)),
  })
  const suggested = [...new Set((known.data ?? []).map((x) => x.vendor_id))].filter((v) => !chosen.includes(v))
  const vName = (vid: string) => vendors.data?.find((v) => v.id === vid)?.name ?? '…'

  const payload = () => ({
    ...(rfq ? { id: rfq.id } : { company_id: companyId }), title, warehouse_id: warehouse || null, needed_by: neededBy || null, reply_by: replyBy || null, notes,
    lines: items.map((l) => ({ variant_id: l.variant_id, quantity: num(l.quantity) })), vendors: chosen,
  })
  const save = useRfqAction(async () => unwrap(await supabase.rpc('rfq_save', { p: payload() as never })) as unknown as string)
  const send = useRfqAction(async (rid: string) => unwrap(await supabase.rpc('rfq_send', { p_id: rid })))
  const cancel = useRfqAction(async (rid: string) => unwrap(await supabase.rpc('rfq_cancel', { p_id: rid })), t('Request cancelled'))
  const problem = title.trim().length < 2 ? t('Give the request a name') : !items.length ? t('Add at least one item') : chosen.length < 2 ? t('Choose at least two vendors') : null

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: '/procurement/rfqs', label: t('Offers from vendors') }} title={rfq ? `${rfq.number} · ${rfq.title}` : t('New request for offers')}
        meta={rfq && <StatusBadge status={rfq.status} />}
        description={t('The goods and the vendors to ask. Once sent, the items stay as they are and the offers are written against them.')}
        actions={editable && <>
          {rfq && <ConfirmDialog trigger={<Button variant="ghost" className="text-destructive"><Ban /> {t('Cancel')}</Button>} title={t('Cancel {number}?', { number: rfq.number })}
            description={t('The request stays on record as cancelled.')} confirmLabel={t('Cancel request')} destructive onConfirm={() => cancel.mutateAsync(rfq.id)} />}
          <Button variant="outline" loading={save.isPending && !send.isPending} disabled={title.trim().length < 2}
            onClick={async () => { const rid = await save.mutateAsync(undefined); toast.success(t('Draft saved')); if (!rfq) navigate(`/procurement/rfqs/${rid}`, { replace: true }) }}><Save /> {t('Save draft')}</Button>
          <Button disabled={!!problem} title={problem ?? undefined} loading={send.isPending}
            onClick={async () => { const rid = await save.mutateAsync(undefined); await send.mutateAsync(rid); toast.success(t('Request sent: write the offers as they come')); navigate(`/procurement/rfqs/${rid}`, { replace: true }) }}>
            <Send /> {t('Ask for offers')}</Button>
        </>} />
      {problem && editable && <p className="-mt-2 mb-3 text-right text-xs text-muted-foreground">{problem}</p>}
      <div className="grid gap-4">
        <Card><CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="rq-title">{t('What is it for')}</Label>
            <Input id="rq-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Flour and oil for December')} disabled={!editable} /></div>
          <div className="grid gap-1.5"><Label>{t('Deliver to')}</Label>
            <Select value={warehouse} onValueChange={setWarehouse} disabled={!editable}><SelectTrigger aria-label={t('Deliver to')}><SelectValue placeholder={t('Warehouse')} /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).filter((w) => w.is_active).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="rq-need" optional>{t('Needed by')}</Label><Input id="rq-need" type="date" min={todayISO()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} disabled={!editable} /></div>
          <div className="grid gap-1.5"><Label htmlFor="rq-reply" optional>{t('Offers by')}</Label><Input id="rq-reply" type="date" min={todayISO()} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} disabled={!editable} /></div>
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-3"><Label htmlFor="rq-notes" optional>{t('Notes to the vendors')}</Label>
            <Textarea id="rq-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Quality, packaging, how to deliver…')} disabled={!editable} /></div>
        </CardContent></Card>

        <Card>
          <CardHeader><CardTitle>{t('Items')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                <SearchSelect value={l.variant_id} disabled={!editable} placeholder={t('Choose an item')} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, variant_id: v } : x)))}
                  options={(variants.data ?? []).filter((v) => v.product_type !== 'service' || v.id === l.variant_id).map((v) => ({ value: v.id, label: v.name, hint: v.sku, keywords: [v.sku, v.codes ?? ''] }))} />
                <Input inputMode="decimal" className="text-right tabular" placeholder={t('Quantity')} aria-label={t('Quantity of line {n}', { n: i + 1 })} value={l.quantity} disabled={!editable}
                  onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} />
                <Button variant="ghost" size="icon" aria-label={t('Remove line')} disabled={!editable || lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>
              </div>
            ))}
            {editable && <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), variant_id: null, quantity: '' }])}><Plus /> {t('Add an item')}</Button>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('Vendors to ask')}</CardTitle><CardDescription>{t('At least two, so the offers can be compared. Vendors can be added after sending too.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {chosen.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-[13px]">{vName(v)}
                  {editable && <button type="button" className="rounded p-0.5 hover:bg-background" aria-label={t('Remove {name}', { name: vName(v) })} onClick={() => setChosen((c) => c.filter((x) => x !== v))}><X className="size-3.5" /></button>}
                </Badge>
              ))}
              {!chosen.length && <span className="text-[13px] text-muted-foreground">{t('No vendor chosen yet')}</span>}
            </div>
            {editable && <div className="max-w-sm"><SearchSelect value={null} placeholder={t('Add a vendor')} onChange={(v) => v && setChosen((c) => (c.includes(v) ? c : [...c, v]))}
              options={(vendors.data ?? []).filter((v) => v.is_active && !chosen.includes(v.id)).map((v) => ({ value: v.id, label: v.name, hint: v.code }))} /></div>}
            {editable && suggested.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">{t('They already sell these items:')}</span>
                {suggested.map((v) => <Button key={v} size="sm" variant="outline" className="h-7" onClick={() => setChosen((c) => [...c, v])}><Plus /> {vName(v)}</Button>)}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the offers side by side */
function RfqOffers({ rfq }: { rfq: Rfq }) {
  const { can } = useCompany()
  const navigate = useNavigate()
  const warehouses = useWarehouses()
  const vendors = useActiveVendors()
  const [offer, setOffer] = React.useState<Offer | null>(null)
  const [decide, setDecide] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const cancel = useRfqAction(async () => unwrap(await supabase.rpc('rfq_cancel', { p_id: rfq.id })), t('Request cancelled'))
  const addVendor = useRfqAction(async (v: string) => unwrap(await supabase.rpc('rfq_save', { p: { id: rfq.id, vendors: [...rfq.vendors.map((x) => x.vendor_id), v] } as never })), t('Vendor added'))
  const cur = rfq.base_currency
  const open = rfq.status === 'sent'
  const editable = can('procurement.write') && open
  const answered = rfq.vendors.filter((v) => ['answered', 'won', 'lost'].includes(v.status))
  const quote = (o: Offer, l: Line) => o.quotes.find((x) => x.line_id === l.id)
  const wh = warehouses.data?.find((w) => w.id === rfq.warehouse_id)

  const requestText = () => [
    t('Hello,'), '',
    t('Please send us your offer for:'),
    ...rfq.lines.map((l) => `- ${l.description}${l.sku ? ` (${l.sku})` : ''}: ${formatQty(l.quantity)}`), '',
    rfq.needed_by ? t('Delivery by {date}, to {place}.', { date: formatDate(rfq.needed_by), place: td(wh?.name ?? '') }) : t('Delivery to {place}.', { place: td(wh?.name ?? '') }),
    t('Please write the price per unit without VAT, any discount, the payment terms and how many days delivery takes.'),
    ...(rfq.reply_by ? [t('We wait for your offer by {date}.', { date: formatDate(rfq.reply_by) })] : []),
    ...(rfq.notes ? ['', rfq.notes] : []), '', t('Thank you'), `${rfq.number}`,
  ].join('\n')

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader back={{ href: '/procurement/rfqs', label: t('Offers from vendors') }} title={`${rfq.number} · ${rfq.title}`}
        meta={<StatusBadge status={rfq.status} />}
        description={[rfq.needed_by && t('Needed by {date}', { date: formatDate(rfq.needed_by) }), rfq.reply_by && t('Offers by {date}', { date: formatDate(rfq.reply_by) }), td(wh?.name ?? '')].filter(Boolean).join(' · ')}
        actions={<>
          {open && <Button variant="outline" onClick={() => void navigator.clipboard.writeText(requestText()).then(() => toast.success(t('The request is copied: paste it into an email or a message to the vendors')))}>
            <ClipboardCopy /> {t('Copy the request')}</Button>}
          {editable && <ConfirmDialog trigger={<Button variant="ghost" className="text-destructive"><Ban /> {t('Cancel')}</Button>} title={t('Cancel {number}?', { number: rfq.number })}
            description={t('The request stays on record as cancelled; no order is made.')} confirmLabel={t('Cancel request')} destructive onConfirm={() => cancel.mutateAsync(undefined)} />}
          {editable && <Button disabled={!answered.length} title={!answered.length ? t('Write at least one offer first') : undefined} onClick={() => setDecide(true)}><Gavel /> {t('Choose and order')}</Button>}
        </>} />

      {rfq.status === 'decided' && (
        <div className="mb-4 rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-[13px]">
          <span className="font-medium">{t('Decided by {name} on {date}.', { name: rfq.decided_by ?? '—', date: formatDate(rfq.decided_at) })}</span>
          {rfq.decision_note && <> {rfq.decision_note}</>}
          <span className="mt-1 flex flex-wrap gap-2">{rfq.vendors.filter((v) => v.purchase_order_id).map((v) => (
            <Button key={v.id} size="sm" variant="outline" asChild><Link to={`/procurement/orders/${v.purchase_order_id}`}><FileText /> {v.po_number} · {v.name}</Link></Button>
          ))}</span>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div><CardTitle>{t('The offers side by side')}</CardTitle>
            <CardDescription>{t('Net price per unit (after discount, without VAT, in {currency}). The best price of each item is marked.', { currency: cur })}</CardDescription></div>
          {editable && (adding
            ? <div className="w-64"><SearchSelect value={null} placeholder={t('Add a vendor')} onChange={(v) => { if (v) { addVendor.mutate(v); setAdding(false) } }}
                options={(vendors.data ?? []).filter((v) => v.is_active && !rfq.vendors.some((x) => x.vendor_id === v.id)).map((v) => ({ value: v.id, label: v.name, hint: v.code }))} /></div>
            : <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> {t('Ask another vendor')}</Button>)}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[200px] align-bottom">{t('Item')}</TableHead>
                <TableHead className="text-right align-bottom">{t('Quantity')}</TableHead>
                <TableHead className="text-right align-bottom">{t('Paid before')}</TableHead>
                {rfq.vendors.map((o) => (
                  <TableHead key={o.id} className="min-w-[150px] py-2 text-right align-bottom">
                    <span className="flex items-center justify-end gap-1 font-medium text-foreground">{o.status === 'won' && <Crown className="size-3.5 text-success" />}{o.name}</span>
                    <span className="block text-xs font-normal">{o.status === 'waiting' ? t('Waiting for the offer') : o.status === 'declined' ? t('Declined')
                      : [o.delivery_days != null && tn(o.delivery_days, 'delivery {n} day', 'delivery {n} days'), o.payment_days != null && tn(o.payment_days, 'pay in {n} day', 'pay in {n} days')].filter(Boolean).join(' · ') || t('Offer written')}</span>
                    {editable && <Button variant="ghost" size="sm" className="mt-1 h-7" onClick={() => setOffer(o)}><PenLine /> {o.status === 'waiting' ? t('Write the offer') : t('Change|edit')}</Button>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="font-medium">{l.description}</span>{l.sku && <span className="block text-xs text-muted-foreground">{l.sku}</span>}</TableCell>
                  <TableCell className="text-right tabular">{formatQty(l.quantity)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular text-muted-foreground">{l.paid_before == null ? '—' : money4(l.paid_before)}</TableCell>
                  {rfq.vendors.map((o) => {
                    const x = quote(o, l)
                    const best = x && l.best != null && num(x.net_base) <= num(l.best) + 0.00005
                    return (
                      <TableCell key={o.id} className={cn('whitespace-nowrap text-right tabular', best && 'bg-success/10 font-semibold text-success')}>
                        {x ? <>{money4(x.net_base)}{num(x.discount_pct) > 0 && <span className="block text-xs font-normal text-muted-foreground">{t('{price} less {pct}%', { price: money4(x.unit_price, o.currency_code), pct: formatNumberWith(num(x.discount_pct)) })}</span>}</>
                          : <span className="text-muted-foreground">{o.status === 'waiting' ? '…' : '—'}</span>}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="font-medium">{t('All the items offered')}
                  {rfq.best_total != null && <span className="block text-xs font-normal text-muted-foreground">{t('Best of each: {amount}', { amount: formatMoney(rfq.best_total, cur) })}</span>}</TableCell>
                {rfq.vendors.map((o) => (
                  <TableCell key={o.id} className="whitespace-nowrap text-right tabular">
                    {o.total_base != null ? <span className="font-semibold">{formatMoney(o.total_base, cur)}</span> : '—'}
                    {o.items > 0 && o.items < rfq.lines.length && <span className="block text-xs font-normal text-warning">{t('{a} of {b} items', { a: o.items, b: rfq.lines.length })}</span>}
                    {o.items > 0 && <span className="block text-xs font-normal text-muted-foreground">{tn(o.best_lines, 'best on {n} item', 'best on {n} items')}</span>}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {offer && <OfferDialog rfq={rfq} offer={offer} onClose={() => setOffer(null)} />}
      {decide && <DecideDialog rfq={rfq} onClose={() => setDecide(false)}
        onDone={(pos) => { if (pos.length === 1) navigate(`/procurement/orders/${pos[0]!.id}`) }} />}
    </div>
  )
}

function OfferDialog({ rfq, offer, onClose }: { rfq: Rfq; offer: Offer; onClose: () => void }) {
  const [declined, setDeclined] = React.useState(offer.status === 'declined')
  const [prices, setPrices] = React.useState<Record<string, { price: string; disc: string }>>(() =>
    Object.fromEntries(rfq.lines.map((l) => { const x = offer.quotes.find((q) => q.line_id === l.id); return [l.id, { price: x ? String(x.unit_price) : '', disc: x && num(x.discount_pct) ? String(x.discount_pct) : '' }] })))
  const [delivery, setDelivery] = React.useState(offer.delivery_days != null ? String(offer.delivery_days) : '')
  const [payment, setPayment] = React.useState(offer.payment_days != null ? String(offer.payment_days) : '')
  const [valid, setValid] = React.useState(offer.valid_until ?? '')
  const [notes, setNotes] = React.useState(offer.notes ?? '')
  const save = useRfqAction(async () => unwrap(await supabase.rpc('rfq_offer_save', { p_rfq_vendor: offer.id, p: (declined ? { declined: true, notes } : {
    delivery_days: delivery, payment_days: payment, valid_until: valid, notes,
    prices: Object.entries(prices).filter(([, v]) => v.price.trim() !== '').map(([line_id, v]) => ({ line_id, unit_price: num(v.price.replace(',', '.')), discount_pct: num(v.disc.replace(',', '.')) })),
  }) as never })), t('Offer saved'))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('The offer of {name}', { name: offer.name })}</DialogTitle>
          <DialogDescription>{t('Prices per unit without VAT, in {currency}. Leave empty what they do not offer.', { currency: offer.currency_code })}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-[13px]"><span>{t('They do not make an offer')}</span><Switch checked={declined} onCheckedChange={setDeclined} aria-label={t('They do not make an offer')} /></label>
        {!declined && <>
          <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_90px] gap-2 text-xs text-muted-foreground"><span>{t('Item')}</span><span className="text-right">{t('Price per unit')}</span><span className="text-right">{t('Discount %')}</span></div>
            {rfq.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_120px_90px] items-center gap-2">
                <span className="truncate text-[13px]">{l.description} <span className="text-muted-foreground">× {formatQty(l.quantity)}</span></span>
                <Input inputMode="decimal" className="text-right tabular" aria-label={t('Price of {item}', { item: l.description })} value={prices[l.id]?.price ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id]!, price: e.target.value } }))} />
                <Input inputMode="decimal" className="text-right tabular" aria-label={t('Discount on {item}', { item: l.description })} value={prices[l.id]?.disc ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id]!, disc: e.target.value } }))} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="of-del" optional>{t('Delivery in (days)')}</Label><Input id="of-del" type="number" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="of-pay" optional>{t('Payment in (days)')}</Label><Input id="of-pay" type="number" min="0" value={payment} onChange={(e) => setPayment(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="of-valid" optional>{t('Valid until')}</Label><Input id="of-valid" type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></div>
          </div>
        </>}
        <div className="grid gap-1.5"><Label htmlFor="of-notes" optional>{t('Notes')}</Label><Textarea id="of-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}><Check /> {t('Save the offer')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DecideDialog({ rfq, onClose, onDone }: { rfq: Rfq; onClose: () => void; onDone: (pos: { id: string; number: string }[]) => void }) {
  const answered = rfq.vendors.filter((v) => v.status === 'answered')
  const cheapest = [...answered].filter((v) => v.items === rfq.lines.length).sort((a, b) => num(a.total_base) - num(b.total_base))[0]
  const [pick, setPick] = React.useState<string>(cheapest?.vendor_id ?? 'best')
  const [note, setNote] = React.useState('')
  const [savePrices, setSavePrices] = React.useState(true)
  const winners = new Set(rfq.lines.map((l) => answered.find((o) => o.quotes.some((x) => x.line_id === l.id && l.best != null && num(x.net_base) <= num(l.best) + 0.00005))?.vendor_id).filter(Boolean))
  const go = useRfqAction(async () => unwrap(await supabase.rpc('rfq_decide', { p_id: rfq.id, p_vendor: pick === 'best' ? undefined : pick, p_note: note || undefined, p_save_prices: savePrices })) as unknown as { id: string; number: string }[])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Choose and order')}</DialogTitle>
          <DialogDescription>{t('The orders are made as drafts at the offered prices: check them and submit them. The other vendors are marked as not chosen.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label={t('Choose and order')}>
          {answered.map((o) => (
            <label key={o.id} className={cn('flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 text-[13px]', pick === o.vendor_id && 'border-primary bg-primary/5')}>
              <span className="flex items-start gap-2"><input type="radio" name="pick" className="mt-0.5" checked={pick === o.vendor_id} onChange={() => setPick(o.vendor_id)} />
                <span><span className="font-medium">{t('Everything from {name}', { name: o.name })}</span>
                  <span className="block text-muted-foreground">{[o.items < rfq.lines.length && t('{a} of {b} items', { a: o.items, b: rfq.lines.length }),
                    o.delivery_days != null && tn(o.delivery_days, 'delivery {n} day', 'delivery {n} days'), o.payment_days != null && tn(o.payment_days, 'pay in {n} day', 'pay in {n} days')].filter(Boolean).join(' · ')}</span></span></span>
              <span className="whitespace-nowrap font-semibold tabular">{formatMoney(o.total_base, rfq.base_currency)}</span>
            </label>
          ))}
          {answered.length > 1 && (
            <label className={cn('flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 text-[13px]', pick === 'best' && 'border-primary bg-primary/5')}>
              <span className="flex items-start gap-2"><input type="radio" name="pick" className="mt-0.5" checked={pick === 'best'} onChange={() => setPick('best')} />
                <span><span className="font-medium">{t('Each item from the cheapest')}</span>
                  <span className="block text-muted-foreground">{tn(winners.size, '{n} order', '{n} orders')}</span></span></span>
              <span className="whitespace-nowrap font-semibold tabular">{formatMoney(rfq.best_total, rfq.base_currency)}</span>
            </label>
          )}
        </div>
        <div className="grid gap-1.5"><Label htmlFor="dc-note" optional>{t('Why this choice')}</Label>
          <Input id="dc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. A bit dearer, but delivers in 3 days')} /></div>
        <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={savePrices} onCheckedChange={(v) => setSavePrices(v === true)} className="mt-0.5" />
          <span>{t("The offered prices become the vendors' prices for the next orders")}</span></label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={go.isPending} onClick={() => go.mutate(undefined, { onSuccess: (pos) => {
            toast.success(tn(pos.length, 'Draft order {numbers} made', '{n} draft orders made: {numbers}', { numbers: pos.map((p) => p.number).join(', ') })); onClose(); onDone(pos) } })}>
            <Gavel /> {t('Make the order')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
