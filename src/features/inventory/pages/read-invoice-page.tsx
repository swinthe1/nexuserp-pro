import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, ScanText, Sparkles, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PhotoCard, ReadsList, usePhotoSubmit, readError } from '@/components/photo-reads'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, num, todayISO } from '@/lib/utils'
import { t, tn } from '@/i18n'
import { VariantPicker, VendorPicker, WarehousePicker } from '../components/pickers'
import { useWarehouses } from '../api'
import { ErrorState } from '@/components/error-state'

type ReadLine = { code?: string; barcode?: string; name: string; quantity: number; unit?: string; unit_price?: number; discount_pct?: number; vat_rate?: number; line_total?: number
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
  const { send, pick } = usePhotoSubmit({ kind: 'invoice', invalidate: [['doc-reads', companyId], ['ai-usage', companyId]], onOne: (x) => setParams({ id: x }) })
  const usage = useQuery({ queryKey: ['ai-usage', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('ai_reads_usage', { p_company: companyId! })) as unknown as { used: number; limit: number } })
  const full = !!usage.data && usage.data.used >= usage.data.limit
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader title={t('Invoice from a photo')} back={{ href: '/inventory/receipts', label: t('Goods receipts') }}
        description={t('Photograph the supplier’s invoice or choose its PDF. DrisPRO reads the vendor and the lines and finds your items; you check them and a draft receipt is made.')} />
      <PhotoCard icon={ScanText} busy={send.isPending} disabled={full} multiple={false} onPick={(c) => pick(c, false)} onManual={() => navigate('/procurement/invoice/new')} title={t('A new invoice')}
        hint={t('The whole page in the photo, flat and with light. A PDF from the vendor is read best.')}
        extra={usage.data && <div className={cn('mt-1 text-xs', full ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {full ? t('This month\u2019s {n} invoices are used up; reading starts again on the 1st. Receive goods by hand meanwhile.', { n: usage.data.limit })
            : t('{used} of {limit} invoices read this month', { used: usage.data.used, limit: usage.data.limit })}</div>} />
      {id ? <ReadReview key={id} id={id} onDone={() => setParams({})} /> : <ReadsList bookedLabel={t('Receipt made')} doneLabel={t('Read')} showWaiting={false} onOpen={(x) => setParams({ id: x })}
        items={(list.data ?? []).map((r) => ({ ...r, date: null, booked: !!r.receipt_id, extra: r.total != null ? t('{amount} with VAT', { amount: formatMoney(r.total) }) : null, total: null,
          title: <>{r.vendor ?? r.file_name ?? t('Bill')}{r.number ? ` · ${r.number}` : ''}</> }))} />}
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
  const make = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('doc_read_to_receipt', { p_id: id, p: {
      vendor_id: vendor, warehouse_id: wh, date, number,
      lines: lines.filter((l) => l.use && l.variant_id).map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_cost: netPrice(l), code: l.code ?? null, name: l.name })),
    } as never })) as string,
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
          <span className="text-xs text-muted-foreground">{t('On the invoice: {name}', { name: [r.vendor_name, r.vendor_tax_number].filter(Boolean).join(' · ') || '—' })}{!r.vendor_id && r.vendor_name ? ` · ${t('not found; choose it or add the vendor first')}` : ''}</span></div>
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
              <li key={i} className={cn('grid gap-2 p-3 sm:grid-cols-[auto_1fr_minmax(220px,1.2fr)_90px_110px] sm:items-center', !l.use && 'opacity-50')}>
                <input type="checkbox" className="size-5" checked={l.use} onChange={(e) => set({ use: e.target.checked })} aria-label={t('Receive this line')} />
                <div className="min-w-0"><div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{[l.code, l.barcode, l.unit].filter(Boolean).join(' · ')}</div></div>
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
        <Button size="lg" disabled={!wh || missing > 0 || !lines.some((l) => l.use) || !!q.data.receipt_id} onClick={() => navigate('/procurement/invoice/new', { state: { fromPhoto: {
          vendor_id: vendor, number, date, warehouse_id: wh,
          lines: lines.filter((l) => l.use && l.variant_id).map((l) => ({ variant_id: l.variant_id!, sku: l.variant_sku ?? l.code ?? '', name: l.variant_name ?? l.name, qty: num(l.quantity),
            price: num(l.unit_price), discount: num(l.discount_pct), vat_rate: l.vat_rate ?? null })),
        } } })}>{t('Make the purchase invoice')}</Button>
      </div>
    </div>
  )
}
