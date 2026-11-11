import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GraduationCap, Loader2, ScanText, Sparkles, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PhotoCard, ReadsList, usePhotoSubmit, readError } from '@/components/photo-reads'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, num, todayISO } from '@/lib/utils'
import { formatNumberWith, t, tn } from '@/i18n'
import { VariantPicker, VendorPicker, WarehousePicker } from '../components/pickers'
import { useWarehouses } from '../api'
import { ErrorState } from '@/components/error-state'

type ReadLine = { unsure?: boolean; code?: string; barcode?: string; name: string; quantity: number; unit?: string; unit_price?: number; discount_pct?: number; vat_rate?: number; line_total?: number
  variant_id: string | null; matched_by: 'learned' | 'vendor_code' | 'barcode' | 'code' | 'name' | null; variant_name: string | null; variant_sku: string | null }
type ReadResult = { vendor_name?: string; vendor_tax_number?: string; number?: string; date?: string; currency?: string; total?: number; subtotal?: number; tax_total?: number
  notes?: string; lines: ReadLine[]; vendor_id: string | null; vendor_match_name: string | null }
type Read = { id: string; status: 'queued' | 'reading' | 'done' | 'failed'; error: string | null; file_name: string | null; receipt_id: string | null; created_at: string; result: ReadResult | null }
type ReadRow = { id: string; file_name: string | null; status: string; error: string | null; vendor: string | null; number: string | null; total: number | null; receipt_id: string | null; created_at: string }
/** the price the goods cost, after the line's discount on the invoice */
const netPrice = (l: { unit_price?: number; discount_pct?: number }) => num(l.unit_price) * (1 - num(l.discount_pct) / 100)

export function ReadInvoicePage() {
  const { companyId } = useCompany()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const list = useQuery({ queryKey: ['doc-reads', companyId], enabled: !!companyId, refetchInterval: (q) => ((q.state.data as ReadRow[] | undefined)?.some((r) => r.status === 'queued' || r.status === 'reading') ? 3000 : false),
    queryFn: async () => unwrap(await supabase.rpc('doc_reads_list', { p_company: companyId! })) as unknown as ReadRow[] })
  const [whose, setWhose] = React.useState<string | null>(null)
  const { send, pick } = usePhotoSubmit({ kind: 'invoice', vendorId: whose, invalidate: [['doc-reads', companyId], ['ai-usage', companyId]], onOne: (x) => setParams({ id: x }) })
  const usage = useQuery({ queryKey: ['ai-usage', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('ai_reads_usage', { p_company: companyId! })) as unknown as { used: number; limit: number } })
  const full = !!usage.data && usage.data.used >= usage.data.limit
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader title={t('Invoice from a photo')} back={{ href: '/inventory/receipts', label: t('Goods receipts') }}
        description={t('Photograph the supplier’s invoice or choose its PDF. DrisPRO reads the vendor and the lines and finds your items; you check them and a draft receipt is made.')} />
      <PhotoCard icon={ScanText} busy={send.isPending} disabled={full} multiple={false} onPick={(c) => pick(c, false)} onManual={() => navigate('/procurement/invoice/new')} title={t('A new invoice')}
        hint={t('The whole page in the photo, flat and with light. A PDF from the vendor is read best.')}
        extra={<>{!id && <div className="mt-2 grid max-w-sm gap-1 text-left">
            <Label className="text-xs">{t('Whose invoice is it? (optional)')}</Label>
            <VendorPicker value={whose} onChange={setWhose} />
            <span className="text-xs text-muted-foreground">{t('For hand-written invoices choose the supplier first: the reader then knows what they usually deliver and reads the names far better.')}</span></div>}
          {usage.data && <div className={cn('mt-1 text-xs', full ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {full ? t('This month\u2019s {n} invoices are used up; reading starts again on the 1st. Receive goods by hand meanwhile.', { n: usage.data.limit })
            : t('{used} of {limit} invoices read this month', { used: usage.data.used, limit: usage.data.limit })}</div>}</>} />
      {id ? <ReadReview key={id} id={id} onDone={() => setParams({})} /> : <ReadsList bookedLabel={t('Receipt made')} doneLabel={t('Read')} showWaiting={false} onOpen={(x) => setParams({ id: x })}
        items={(list.data ?? []).map((r) => ({ ...r, date: null, booked: !!r.receipt_id, extra: r.total != null ? t('{amount} with VAT', { amount: formatMoney(r.total) }) : null, total: null,
          title: <>{r.vendor ?? r.file_name ?? t('Bill')}{r.number ? ` · ${r.number}` : ''}</> }))} />}
      {!id && <ReaderStats />}
    </div>
  )
}

function ReadReview({ id, onDone }: { id: string; onDone: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const warehouses = useWarehouses()
  const q = useQuery({ queryKey: ['doc-read', id], refetchInterval: (x) => (['queued', 'reading'].includes((x.state.data as Read | undefined)?.status ?? 'queued') ? 2500 : false),
    queryFn: async () => unwrap(await supabase.rpc('doc_read_get', { p_id: id })) as unknown as Read })
  const r = q.data?.result
  const [vendor, setVendor] = React.useState<string | null>(null)
  const [wh, setWh] = React.useState<string | null>(null)
  const [number, setNumber] = React.useState('')
  const [date, setDate] = React.useState(todayISO())
  const [lines, setLines] = React.useState<(ReadLine & { use: boolean })[]>([])
  React.useEffect(() => {
    if (!r) return
    setVendor((v) => v ?? r.vendor_id); setNumber((n) => n || r.number || ''); if (r.date) setDate(r.date)
    setLines((l) => (l.length ? l : r.lines.map((x) => ({ ...x, use: true }))))
  }, [r])
  React.useEffect(() => { if (!wh && warehouses.data?.length) setWh(warehouses.data[0]!.id) }, [warehouses.data, wh])
  // what was changed against what was read stays with the supplier: the next read gets it as a note (never stops the work)
  const learn = async () => {
    try {
      await supabase.rpc('doc_read_feedback', { p_id: id, p: { vendor_id: vendor, number, date,
        lines: lines.map((l, i) => ({ i, use: l.use, variant_id: l.variant_id, quantity: num(l.quantity), unit_price: num(l.unit_price) })) } as never })
      void qc.invalidateQueries({ queryKey: ['reader-stats', companyId] })
    } catch { /* the receipt matters more than the lesson */ }
  }
  const make = useMutation({
    mutationFn: async () => { await learn(); return unwrap(await supabase.rpc('doc_read_to_receipt', { p_id: id, p: {
      vendor_id: vendor, warehouse_id: wh, date, number,
      lines: lines.filter((l) => l.use && l.variant_id).map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_cost: netPrice(l), code: l.code ?? null, name: l.name })),
    } as never })) as string },
    onSuccess: (rec) => { toast.success(t('Draft receipt made; check it and post it')); void qc.invalidateQueries({ queryKey: ['doc-reads', companyId] }); navigate(`/inventory/receipts/${rec}`) },
    onError: (e) => toast.error(describeError(e)),
  })

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data || q.data.status === 'queued' || q.data.status === 'reading') {
    return <Card><CardContent className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> {t('Reading the invoice… it takes about half a minute.')}</CardContent></Card>
  }
  if (q.data.status === 'failed' || !r) {
    return <Card><CardContent className="grid justify-items-center gap-2 p-8 text-center"><TriangleAlert className="size-6 text-destructive" />
      <div className="font-medium">{t('The invoice could not be read')}</div><div className="text-[13px] text-muted-foreground">{readError(q.data.error)}</div>
      <Button variant="outline" onClick={onDone}>{t('Back')}</Button></CardContent></Card>
  }
  const missing = lines.filter((l) => l.use && !l.variant_id).length
  const sum = lines.filter((l) => l.use).reduce((s, l) => s + num(l.quantity) * netPrice(l), 0)
  const how: Record<string, string> = { learned: t('as last time'), vendor_code: t('vendor’s code'), barcode: t('barcode'), code: t('our code'), name: t('by name') }
  return (
    <div className="grid gap-4">
      {q.data.receipt_id && <div className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-[13px]">{t('A receipt was already made from this invoice.')} <Link className="font-medium text-primary hover:underline" to={`/inventory/receipts/${q.data.receipt_id}`}>{t('Open it')}</Link></div>}
      <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Vendor')}</Label>
          <VendorPicker value={vendor} onChange={setVendor} />
          <span className="text-xs text-muted-foreground">{t('On the invoice: {name}', { name: [r.vendor_name, r.vendor_tax_number].filter(Boolean).join(' · ') || '—' })}{!r.vendor_id && r.vendor_name ? ` · ${t('not found; choose it or add the vendor first')}` : ''}</span>
          {vendor && <RulesButton vendorId={vendor} />}</div>
        <div className="grid gap-1.5"><Label htmlFor="rn">{t('Invoice number')}</Label><Input id="rn" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="rd">{t('Date')}</Label><Input id="rd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Into the warehouse')}</Label><WarehousePicker value={wh} onChange={setWh} /></div>
        <div className="flex items-end justify-between gap-3 sm:col-span-2 lg:justify-end">
          <div className="text-right text-[13px] text-muted-foreground">{t('Lines without VAT')} <span className="block text-lg font-semibold text-foreground tabular">{formatMoney(sum)}</span>
            {r.total != null && <span>{t('Invoice total with VAT {amount}', { amount: formatMoney(r.total) })}</span>}</div>
        </div>
      </CardContent></Card>
      {r.notes && <p className="rounded-md bg-warning/10 px-4 py-2 text-[13px]"><Sparkles className="mr-1 inline size-4 text-warning" />{r.notes}</p>}
      <Card><CardContent className="p-0">
        <ul className="divide-y">
          {lines.map((l, i) => {
            const set = (p: Partial<typeof l>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...p } : x)))
            return (
              <li key={i} className={cn('grid gap-2 p-3 sm:grid-cols-[auto_1fr_minmax(220px,1.2fr)_90px_110px] sm:items-center', !l.use && 'opacity-50', l.unsure && l.use && 'bg-warning/10')}>
                <input type="checkbox" className="size-5" checked={l.use} onChange={(e) => set({ use: e.target.checked })} aria-label={t('Receive this line')} />
                <div className="min-w-0"><div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{[l.code, l.barcode, l.unit].filter(Boolean).join(' · ')}</div>
                  {l.unsure && <div className="flex items-center gap-1 text-xs font-medium text-warning"><TriangleAlert className="size-3" />{t('Hard to read: check the name and the numbers')}</div>}</div>
                <div className="grid gap-1">
                  <VariantPicker value={l.variant_id} onChange={(v) => set({ variant_id: v, matched_by: null })} aria-invalid={l.use && !l.variant_id} />
                  {l.variant_id && l.matched_by && <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3" />{t('found: {how}', { how: how[l.matched_by] ?? '' })}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:contents">
                <div className="grid gap-1"><Label className="text-xs text-muted-foreground sm:sr-only">{t('Quantity')}</Label>
                  <Input type="number" step="any" className="text-right tabular" value={l.quantity} onChange={(e) => set({ quantity: num(e.target.value) })} aria-label={t('Quantity')} /></div>
                <div className="grid gap-1"><Label className="text-xs text-muted-foreground sm:sr-only">{t('Unit cost (without VAT)')}</Label>
                  <Input type="number" step="any" className="text-right tabular" value={l.unit_price ?? 0} onChange={(e) => set({ unit_price: num(e.target.value) })} aria-label={t('Unit cost (without VAT)')} /></div>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent></Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {missing > 0 && <span className="text-[13px] text-warning">{tn(missing, 'Choose the item for {n} line, or untick it', 'Choose the item for {n} lines, or untick them')}</span>}
        <Button variant="ghost" onClick={onDone}>{t('Back')}</Button>
        <Button size="lg" variant="outline" loading={make.isPending} disabled={!wh || missing > 0 || !lines.some((l) => l.use) || !!q.data.receipt_id} onClick={() => make.mutate()}>{t('Only the goods, the invoice later')}</Button>
        {/* the usual way: the supplier's invoice itself, filled in from the photo; posting it also brings the goods in */}
        <Button size="lg" disabled={!wh || missing > 0 || !lines.some((l) => l.use) || !!q.data.receipt_id} onClick={() => { void learn(); navigate('/procurement/invoice/new', { state: { fromPhoto: {
          vendor_id: vendor, number, date, warehouse_id: wh,
          lines: lines.filter((l) => l.use && l.variant_id).map((l) => ({ variant_id: l.variant_id!, sku: l.variant_sku ?? l.code ?? '', name: l.variant_name ?? l.name, qty: num(l.quantity),
            price: num(l.unit_price), discount: num(l.discount_pct), vat_rate: l.vat_rate ?? null })),
        } } }) }}>{t('Make the purchase invoice')}</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the reader learns */

type Learned = { name?: string; field: 'quantity' | 'unit_price' | 'left_out' | 'number' | 'date'; read?: string | number; right?: string | number }
const learnedSay = (e: Learned) => e.field === 'quantity' ? t('{name}: quantity read {read}, right {right}', { name: e.name ?? '', read: String(e.read), right: String(e.right) })
  : e.field === 'unit_price' ? t('{name}: price read {read}, right {right}', { name: e.name ?? '', read: String(e.read), right: String(e.right) })
  : e.field === 'left_out' ? t('{name}: not goods, left out', { name: e.name ?? '' })
  : e.field === 'number' ? t('Invoice number read {read}, right {right}', { read: String(e.read ?? '—'), right: String(e.right ?? '—') })
  : t('Date read {read}, right {right}', { read: String(e.read ?? '—'), right: String(e.right ?? '—') })

/** the reading rules of one supplier, in plain words, and what the corrections have taught so far */
function RulesDialog({ vendorId, name, onClose }: { vendorId: string; name?: string; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['read-rules', companyId, vendorId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('read_rules_get', { p_company: companyId!, p_vendor: vendorId })) as unknown as { notes: string | null; learned: Learned[] } })
  const [notes, setNotes] = React.useState<string | null>(null)
  const value = notes ?? q.data?.notes ?? ''
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('read_rules_save', { p_company: companyId!, p_vendor: vendorId, p_notes: value })),
    onSuccess: () => { toast.success(t('Saved: the next invoice of this supplier is read with these rules')); void qc.invalidateQueries({ queryKey: ['read-rules', companyId, vendorId] }); void qc.invalidateQueries({ queryKey: ['reader-stats', companyId] }); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{name ? t('How the invoices of {name} are read', { name }) : t('How this supplier’s invoices are read')}</DialogTitle>
          <DialogDescription>{t('Write in plain words what the reader should know about this supplier’s invoice. It gets these rules with every photo of theirs.')}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="rr">{t('Reading rules')}</Label>
          <Textarea id="rr" rows={5} maxLength={1000} value={value} onChange={(e) => setNotes(e.target.value)}
            placeholder={t('e.g. The price column is with VAT. Quantities are in packs of 12: multiply by 12. The line “Transport” is not goods.')} /></div>
        {!!q.data?.learned.length && (
          <div className="grid gap-1.5"><span className="text-[13px] font-medium">{t('Learned from your corrections')}</span>
            <ul className="grid max-h-40 gap-1 overflow-y-auto rounded-md border bg-muted/40 p-2 text-[12.5px] text-muted-foreground">
              {q.data.learned.slice(0, 12).map((e, i) => <li key={i}>{learnedSay(e)}</li>)}
            </ul>
            <span className="text-xs text-muted-foreground">{t('The latest corrections go to the reader with the next photo of this supplier, by themselves.')}</span></div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RulesButton({ vendorId }: { vendorId: string }) {
  const [open, setOpen] = React.useState(false)
  return <>
    <button type="button" className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setOpen(true)}><GraduationCap className="size-3.5" />{t('Reading rules of this supplier')}</button>
    {open && <RulesDialog vendorId={vendorId} onClose={() => setOpen(false)} />}
  </>
}

type StatRow = { id: string; name: string; reads: number; lines_read: number; lines_fixed: number; quantity: number; unit_price: number; item: number; left_out: number; header: number
  last_at: string | null; recent_pct: number | null; before_pct: number | null; has_rules: boolean }

/** how well it reads: per supplier the lines corrected after the read, in what, and whether it is getting better */
function ReaderStats() {
  const { companyId } = useCompany()
  const q = useQuery({ queryKey: ['reader-stats', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('reader_stats', { p_company: companyId! })) as unknown as { reads: number; lines_read: number; lines_fixed: number; vendors: StatRow[] } })
  const [edit, setEdit] = React.useState<StatRow | null>(null)
  const d = q.data
  if (!d || (!d.reads && !d.vendors.length)) return null
  const right = d.lines_read ? 100 - (d.lines_fixed / d.lines_read) * 100 : null
  const pct = (v: number) => formatNumberWith(v, { maximumFractionDigits: 0 })
  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><div className="flex items-center gap-2 text-[15px] font-semibold"><GraduationCap className="size-4 text-primary" />{t('How well it reads')}</div>
            <p className="text-[13px] text-muted-foreground">{t('What you correct after a read is kept for each supplier and goes to the reader with their next invoice.')}</p></div>
          {right != null && <div className="text-right"><div className="text-xl font-bold tabular">{pct(right)}%</div><div className="text-xs text-muted-foreground">{t('{n} lines read right out of {total}', { n: d.lines_read - d.lines_fixed, total: d.lines_read })}</div></div>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">{t('Supplier')}</th><th className="px-2 text-right font-semibold">{t('Invoices|read')}</th><th className="px-2 text-right font-semibold">{t('Lines right')}</th>
              <th className="px-2 font-semibold">{t('Corrected most')}</th><th className="px-2 font-semibold">{t('Lately')}</th><th className="pl-2 text-right font-semibold">{t('Rules')}</th>
            </tr></thead>
            <tbody>
              {d.vendors.map((v) => {
                const ok = v.lines_read ? 100 - (v.lines_fixed / v.lines_read) * 100 : null
                const worst = ([['quantity', t('quantities')], ['unit_price', t('prices')], ['item', t('the item')], ['left_out', t('lines that are not goods')], ['header', t('number or date')]] as const)
                  .map(([k, label]) => ({ n: num(v[k]), label })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]
                const better = v.recent_pct != null && v.before_pct != null ? num(v.before_pct) - num(v.recent_pct) : null
                return (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{v.name}</td>
                    <td className="px-2 text-right tabular">{v.reads}</td>
                    <td className={cn('px-2 text-right font-semibold tabular', ok != null && ok < 80 && 'text-warning')}>{ok != null ? `${pct(ok)}%` : '—'}</td>
                    <td className="px-2 text-muted-foreground">{worst ? `${worst.label} (${worst.n})` : v.reads ? t('nothing') : '—'}</td>
                    <td className="px-2">{better == null ? <span className="text-muted-foreground">—</span>
                      : better > 2 ? <span className="font-medium text-success">{t('better: {pct}% fewer corrections', { pct: pct(better) })}</span>
                      : better < -2 ? <span className="font-medium text-warning">{t('worse: {pct}% more corrections', { pct: pct(-better) })}</span>
                      : <span className="text-muted-foreground">{t('the same')}</span>}</td>
                    <td className="pl-2 text-right"><Button size="sm" variant={v.has_rules ? 'outline' : 'ghost'} onClick={() => setEdit(v)}>{v.has_rules ? t('Edit rules') : t('Write rules')}</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
      {edit && <RulesDialog vendorId={edit.id} name={edit.name} onClose={() => setEdit(null)} />}
    </Card>
  )
}
