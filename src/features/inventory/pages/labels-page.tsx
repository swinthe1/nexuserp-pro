import { useMutation, useQuery } from '@tanstack/react-query'
import { Barcode, Download, FileInput, Printer, ReceiptText, Tags, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { expand, LABEL_DEFAULTS, labelsFile, labelsHtml, labelsPdf, SIZES, sizeOf, TEMPLATES, type LabelData, type LabelItem, type LabelOptions } from '@/lib/labels'
import { searchOffline, useScanCatalog } from '@/lib/offline/catalog'
import { printHtml } from '@/lib/print'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useCategories } from '../api'

const KEY = 'drispro.labels'
const loadOpts = (): LabelOptions => { try { return { ...LABEL_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), start: 1 } } catch { return LABEL_DEFAULTS } }
type Source = 'items' | 'receipt' | 'bill' | 'price_changes' | 'category' | 'price_level'

/** Inventory › Labels: shelf, price and barcode labels for A4 sheets or a label printer. */
export function LabelsPage() {
  const { companyId, can } = useCompany()
  const [params] = useSearchParams()
  const [opts, setOpts] = React.useState<LabelOptions>(loadOpts)
  const [data, setData] = React.useState<LabelData | null>(null)
  const [counts, setCounts] = React.useState<Record<string, number>>({})
  const set = (p: Partial<LabelOptions>) => setOpts((o) => {
    const n = { ...o, ...p }
    try { localStorage.setItem(KEY, JSON.stringify({ ...n, start: 1 })) } catch { /* private window */ }
    return n
  })

  const add = useMutation({
    mutationFn: async (a: { source: Source; ids?: string[]; since?: string }) =>
      unwrap(await supabase.rpc('label_items', { p_company: companyId!, p_source: a.source, p_ids: (a.ids ?? null) as string[], p_since: (a.since ?? null) as string })) as unknown as LabelData,
    onSuccess: (d, a) => {
      if (!d.items.length) return void toast.info(a.source === 'price_changes' ? t('No price changed since then') : t('Nothing to add'))
      setData((cur) => {
        const have = new Set(cur?.items.map((i) => i.variant_id))
        return { ...d, items: [...(cur?.items ?? []), ...d.items.filter((i) => !have.has(i.variant_id))] }
      })
      setCounts((c) => {
        const n = { ...c }
        for (const i of d.items) n[i.variant_id] = (a.source === 'items' ? (c[i.variant_id] ?? 0) : 0) + i.qty
        return n
      })
    },
    onError: (e) => toast.error(describeError(e)),
  })

  // arriving from a receipt, a purchase invoice or a product: start with its items
  const started = React.useRef(false)
  React.useEffect(() => {
    if (started.current || !companyId) return
    started.current = true
    const r = params.get('receipt'), b = params.get('bill'), v = params.get('items'), lv = params.get('level')
    if (lv) add.mutate({ source: 'price_level', ids: [lv] })
    else if (r) add.mutate({ source: 'receipt', ids: [r] })
    else if (b) add.mutate({ source: 'bill', ids: [b] })
    else if (v) add.mutate({ source: 'items', ids: v.split(',').filter(Boolean) })
  }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items ?? []
  const all = React.useMemo(() => expand(items, counts), [items, counts])
  const noCode = items.filter((i) => !i.barcode)
  const assign = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('labels_assign_barcodes', { p_company: companyId!, p_variants: noCode.map((i) => i.variant_id) })) as number,
    onSuccess: async (n) => {
      toast.success(tn(n, '{n} item got an in-store barcode', '{n} items got an in-store barcode'))
      const fresh = unwrap(await supabase.rpc('label_items', { p_company: companyId!, p_source: 'items', p_ids: items.map((i) => i.variant_id) })) as unknown as LabelData
      setData((cur) => cur && { ...cur, items: cur.items.map((i) => fresh.items.find((f) => f.variant_id === i.variant_id) ?? i) })
    },
    onError: (e) => toast.error(describeError(e)),
  })

  const print = () => { if (data && all.length) { const h = labelsHtml(data, all, opts); printHtml(h.body, h.css) } }
  const pdf = useMutation({
    mutationFn: async () => {
      const blob = await labelsPdf(data!, all, opts)
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = labelsFile(); a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    },
    onError: (e) => toast.error(describeError(e)),
  })
  const size = sizeOf(opts)
  const perSheet = size.sheet ? size.sheet.cols * size.sheet.rows : 0

  return (
    <>
      <PageHeader title={t('Labels')} description={t('Shelf, price and barcode labels, on A4 label sheets or on a label printer. Add the items, choose how many of each, print.')}
        actions={<>
          <Button variant="outline" disabled={!all.length || pdf.isPending} loading={pdf.isPending} onClick={() => pdf.mutate()}><Download /> {t('PDF')}</Button>
          <Button disabled={!all.length} onClick={print}><Printer /> {t('Print {n} labels', { n: all.length })}</Button>
        </>} />
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-4">
          <AddItems busy={add.isPending} onAdd={(a) => add.mutate(a)} />
          {items.length === 0 ? (
            <EmptyState icon={Tags} title={t('No items yet')} description={t('Add items by name or barcode, or take them from a goods receipt, a purchase invoice, or the prices that changed.')} />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-[13px]">
                <span className="text-muted-foreground">{tn(items.length, '{n} item', '{n} items')} · {tn(all.length, '{n} label', '{n} labels')}
                  {perSheet > 0 && <> · {tn(Math.ceil((all.length + opts.start - 1) / perSheet), '{n} sheet', '{n} sheets')}</>}</span>
                <div className="flex gap-1.5">
                  {noCode.length > 0 && can('inventory.write') && (
                    <Button size="sm" variant="outline" loading={assign.isPending} onClick={() => assign.mutate()}><Barcode /> {tn(noCode.length, 'Give a barcode to the {n} item without one', 'Give barcodes to the {n} items without one')}</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setData(null); setCounts({}) }}><Trash2 /> {t('Clear the list')}</Button>
                </div>
              </div>
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-2 font-medium">{t('Item')}</th><th className="px-3 py-2 font-medium">{t('Barcode')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('Price with VAT')}</th><th className="w-28 px-3 py-2 text-right font-medium">{t('Labels')}</th><th className="w-10" />
                </tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.variant_id} className="border-t">
                      <td className="px-3 py-1.5"><div className="font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{i.sku}{i.pack ? ` · ${i.pack.name} × ${i.pack.factor}` : ''}</div></td>
                      <td className="px-3 py-1.5 tabular-nums">{i.barcode ?? <span className="text-xs text-amber-700 dark:text-amber-400">{t('none — the code is printed instead')}</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {i.old_price != null && <span className="mr-1.5 text-xs text-muted-foreground line-through">{formatMoney(i.old_price)}</span>}
                        {formatMoney(i.price, data?.currency)}</td>
                      <td className="px-3 py-1"><Input type="number" min="0" max="500" className="h-8 text-right" value={counts[i.variant_id] ?? i.qty} aria-label={t('Labels for {name}', { name: i.name })}
                        onChange={(e) => setCounts((c) => ({ ...c, [i.variant_id]: Math.max(0, Math.min(500, Math.round(num(e.target.value)))) }))} /></td>
                      <td className="px-1"><Button variant="ghost" size="icon-sm" aria-label={t('Remove {name}', { name: i.name })}
                        onClick={() => setData((d) => d && { ...d, items: d.items.filter((x) => x.variant_id !== i.variant_id) })}><Trash2 /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="grid content-start gap-4">
          <LabelSettings opts={opts} set={set} perSheet={perSheet} />
          <Preview data={data} items={all} opts={opts} />
        </div>
      </div>
    </>
  )
}

function AddItems({ onAdd, busy }: { onAdd: (a: { source: Source; ids?: string[]; since?: string }) => void; busy: boolean }) {
  const { companyId } = useCompany()
  const catalog = useScanCatalog()
  const categories = useCategories()
  const [mode, setMode] = React.useState<Source>('items')
  const [since, setSince] = React.useState(todayISO())
  const options = React.useMemo(() => (companyId && catalog.ready ? searchOffline(companyId, '', 1_000_000) : [])
    .map((i) => ({ value: i.variant_id, label: i.name, hint: i.sku, keywords: i.barcodes.map(([b]) => b) })), [companyId, catalog.ready, catalog.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const receipts = useQuery({
    queryKey: ['labels-receipts', companyId], enabled: !!companyId && mode === 'receipt',
    queryFn: async () => unwrap(await supabase.from('goods_receipts').select('id, number, receipt_date, status, vendor:business_partners(name)')
      .eq('company_id', companyId!).is('deleted_at', null).order('receipt_date', { ascending: false }).order('created_at', { ascending: false }).limit(80)),
  })
  const bills = useQuery({
    queryKey: ['labels-bills', companyId], enabled: !!companyId && mode === 'bill',
    queryFn: async () => unwrap(await supabase.from('vendor_bills').select('id, number, vendor_invoice_number, bill_date, vendor:business_partners(name)')
      .eq('company_id', companyId!).is('deleted_at', null).eq('document_type', 'vendor_bill').order('bill_date', { ascending: false }).order('created_at', { ascending: false }).limit(80)),
  })
  const MODES: { id: Source; label: string; icon: typeof Tags }[] = [
    { id: 'items', label: t('Items'), icon: Tags }, { id: 'receipt', label: t('Goods receipt'), icon: FileInput },
    { id: 'bill', label: t('Purchase invoice'), icon: ReceiptText }, { id: 'price_changes', label: t('Changed prices'), icon: Tags }, { id: 'category', label: t('Category'), icon: Tags },
  ]
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-[13px]" role="tablist" aria-label={t('Add from')}>
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={cn('rounded-md px-3 py-1.5 font-medium', mode === m.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{m.label}</button>
        ))}
      </div>
      {mode === 'items' && (
        <SearchSelect value={null} options={options} placeholder={t('Add an item: name, code or scan the barcode')} searchPlaceholder={t('Name, code or barcode')}
          onChange={(v) => v && onAdd({ source: 'items', ids: [v] })} />
      )}
      {mode === 'receipt' && (
        <SearchSelect value={null} placeholder={t('Choose the goods receipt: one label for each piece received')}
          options={(receipts.data ?? []).map((r) => ({ value: r.id, label: r.number ?? t('Draft'), hint: [formatDate(r.receipt_date), (r.vendor as { name: string } | null)?.name].filter(Boolean).join(' · ') }))}
          onChange={(v) => v && onAdd({ source: 'receipt', ids: [v] })} />
      )}
      {mode === 'bill' && (
        <SearchSelect value={null} placeholder={t('Choose the purchase invoice: one label for each piece bought')}
          options={(bills.data ?? []).map((b) => ({ value: b.id, label: b.number ?? t('Draft'), hint: [b.vendor_invoice_number, formatDate(b.bill_date), (b.vendor as { name: string } | null)?.name].filter(Boolean).join(' · ') }))}
          onChange={(v) => v && onAdd({ source: 'bill', ids: [v] })} />
      )}
      {mode === 'price_changes' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5"><Label htmlFor="lb-since">{t('Prices changed since')}</Label>
            <Input id="lb-since" type="date" className="w-44" value={since} onChange={(e) => e.target.value && setSince(e.target.value)} /></div>
          <Button variant="outline" loading={busy} onClick={() => onAdd({ source: 'price_changes', since })}>{t('Add them')}</Button>
          <p className="basis-full text-xs text-muted-foreground">{t('New labels for the shelves after a price change; the old price can be shown crossed out.')}</p>
        </div>
      )}
      {mode === 'category' && (
        <SearchSelect value={null} placeholder={t('Choose a category: all its items')}
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined }))}
          onChange={(v) => v && onAdd({ source: 'category', ids: [v] })} />
      )}
    </div>
  )
}

function LabelSettings({ opts, set, perSheet }: { opts: LabelOptions; set: (p: Partial<LabelOptions>) => void; perSheet: number }) {
  const check = (k: keyof LabelOptions, label: string, show = true) => show && (
    <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={!!opts[k]} onCheckedChange={(on) => set({ [k]: on === true })} />{label}</label>
  )
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3">
      <div className="grid gap-1.5">
        <Label>{t('Kind of label')}</Label>
        <div className="grid gap-1.5" role="radiogroup" aria-label={t('Kind of label')}>
          {TEMPLATES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={opts.template === x.id} onClick={() => set({ template: x.id })}
              className={cn('rounded-md border px-3 py-2 text-left', opts.template === x.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}>
              <span className="block text-[13px] font-medium">{t(x.name)}</span><span className="block text-xs text-muted-foreground">{t(x.hint)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>{t('Paper')}</Label>
        <Select value={opts.size} onValueChange={(v) => set({ size: v, start: 1 })}>
          <SelectTrigger aria-label={t('Paper')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => <SelectItem key={s.id} value={s.id}>{t(s.name)}</SelectItem>)}
            <SelectItem value="custom">{t('Label printer · other size')}</SelectItem>
          </SelectContent>
        </Select>
        {opts.size === 'custom' && (
          <div className="flex items-center gap-2 text-[13px]">
            <Input type="number" min="15" className="h-8 w-20 text-right" value={opts.custom?.w ?? 50} aria-label={t('Width (mm)')} onChange={(e) => set({ custom: { w: num(e.target.value), h: opts.custom?.h ?? 30 } })} />×
            <Input type="number" min="10" className="h-8 w-20 text-right" value={opts.custom?.h ?? 30} aria-label={t('Height (mm)')} onChange={(e) => set({ custom: { w: opts.custom?.w ?? 50, h: num(e.target.value) } })} /> mm
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {check('price', t('Price with VAT'))}
        {check('oldPrice', t('Old price crossed out'), opts.price)}
        {check('unitPrice', t('Price per kg or litre'), opts.template !== 'barcode')}
        {check('pack', t('Price of the box'), opts.template !== 'barcode')}
        {check('barcode', t('Barcode'), opts.template !== 'barcode')}
        {check('sku', t('Item code'))}
        {check('date', t('Date'), opts.template !== 'barcode')}
        {check('brand', t('Brand before the name'))}
        {check('border', t('Outline (to check alignment)'))}
      </div>
      {perSheet > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="lb-start">{t('Start at label')}</Label>
          <div className="flex items-center gap-2">
            <Input id="lb-start" type="number" min="1" max={perSheet} className="h-8 w-20 text-right" value={opts.start} onChange={(e) => set({ start: Math.max(1, Math.min(perSheet, Math.round(num(e.target.value)) || 1)) })} />
            <span className="text-xs text-muted-foreground">{t('for a sheet already partly used (1 – {n})', { n: perSheet })}</span>
          </div>
        </div>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer text-muted-foreground">{t('Printer adjustment')}</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>{t('Right')}</span><Input type="number" step="0.5" className="h-8 w-20 text-right" value={opts.offsetX} aria-label={t('Move right (mm)')} onChange={(e) => set({ offsetX: num(e.target.value) })} />
          <span>{t('Down')}</span><Input type="number" step="0.5" className="h-8 w-20 text-right" value={opts.offsetY} aria-label={t('Move down (mm)')} onChange={(e) => set({ offsetY: num(e.target.value) })} /> mm
          <p className="basis-full text-xs text-muted-foreground">{t('If the printer prints a little off the labels, move everything by a few millimetres. Kept on this computer.')}</p>
        </div>
      </details>
    </div>
  )
}

const PX = 96 / 25.4
function Preview({ data, items, opts }: { data: LabelData | null; items: LabelItem[]; opts: LabelOptions }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(340)
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect()
  }, [])
  const s = sizeOf(opts)
  const pageW = s.sheet ? 210 : s.w, pageH = s.sheet ? 297 : s.h
  // the first page (a sheet), or the first few labels of a roll side by side
  const html = React.useMemo(() => {
    if (!data || !items.length) return null
    const shown = s.sheet ? items.slice(0, s.sheet.cols * s.sheet.rows - (opts.start - 1)) : items.slice(0, 1)
    const h = labelsHtml(data, shown, { ...opts, border: true })
    return `<!doctype html><html><head><meta charset="utf-8"><style>${h.css}body{background:#fff}</style></head><body>${h.body}</body></html>`
  }, [data, items, opts, s.sheet])
  const scale = Math.min(1.6, w / (pageW * PX))
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-2 text-[13px] font-medium">{t('Preview')}</p>
      <div ref={ref} className="w-full">
        {!html ? <div className="grid h-40 place-items-center rounded-md bg-muted/40 text-xs text-muted-foreground">{t('The labels appear here')}</div> : (
          <div className="overflow-hidden rounded-md border bg-white" style={{ width: pageW * PX * scale, height: pageH * PX * scale }}>
            <iframe title={t('Preview')} srcDoc={html} className="origin-top-left border-0" sandbox=""
              style={{ width: pageW * PX, height: pageH * PX, transform: `scale(${scale})` }} />
          </div>
        )}
      </div>
    </div>
  )
}
