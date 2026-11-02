import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Percent, Plus, Save, Tag, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatementActions } from '@/components/statement-actions'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { t, td } from '@/i18n'
import type { PrintDoc } from '@/lib/documents/model'
import { nf, qf, type Statement } from '@/lib/documents/render-statement'
import { describeError, unwrap } from '@/lib/errors'
import { searchOffline, useScanCatalog } from '@/lib/offline/catalog'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, usePriceRules, usePriceSuggestions, useWarehouses } from '../api'
import { PriceSuggestions } from './prices-page'

type Level = { id: string; number: string | null; status: string; level_date: string; warehouse_id: string | null; notes: string | null; value_change: number; posted_at: string | null
  warehouse: { name: string } | null; lines: { id: string; variant_id: string; line_no: number; old_price: number | null; new_price: number; quantity: number | null; value_change: number | null }[] }
type Item = { variant_id: string; sku: string; name: string; price: number; vat_rate: number; cost: number; category: string | null; stock: number }
/** mtext: the margin as it is being typed; manual: the margin of this row was set by hand (a fixed margin leaves it alone) */
type Row = Item & { gross: string; mtext?: string; manual?: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100
const gross = (net: number, vat: number) => r2(net * (1 + vat / 100))

/** Inventory › Price levelling: documents that change many selling prices at once, and the new prices worked out from the cost waiting for a yes. */
export function PriceLevelsPage() {
  const { companyId, can } = useCompany()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'suggestions' ? 'suggestions' : 'documents'
  const waiting = usePriceSuggestions('pending').data?.length ?? 0
  const q = useQuery({ queryKey: ['inv', companyId, 'levels'], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('price_levels').select('id, number, status, level_date, value_change, notes, warehouse:warehouses(name), lines:price_level_lines(count)')
      .eq('company_id', companyId!).is('deleted_at', null).order('level_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)) })
  type R = NonNullable<typeof q.data>[number]
  const cols = React.useMemo<ColumnDef<R>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{(getValue() as string) ?? t('Draft')}</span> },
    { accessorKey: 'level_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { id: 'wh', accessorFn: (r) => (r.warehouse as { name: string } | null)?.name ?? '', header: t('Stock of'), meta: { label: t('Stock of') }, cell: ({ getValue }) => td(getValue() as string) || t('All warehouses') },
    { id: 'n', accessorFn: (r) => (r.lines as unknown as { count: number }[])[0]?.count ?? 0, header: t('Items'), meta: { label: t('Items') } },
    { accessorKey: 'value_change', header: t('Value change (with VAT)'), meta: { label: t('Value change (with VAT)') }, cell: ({ getValue, row }) => row.original.status === 'posted' ? <span className="tabular-nums">{formatMoney(getValue() as number)}</span> : '' },
    { accessorKey: 'status', header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'notes', header: t('Notes'), meta: { label: t('Notes') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
  ], [])
  return (
    <>
      <PageHeader title={t('Price levelling')} description={t('Change the selling prices of many items at once, as one document: the stock on hand and the value of the change are recorded, and new labels can be printed.')}
        actions={can('inventory.write') && <Button asChild><Link to="/inventory/levelling/new"><Plus /> {t('New levelling')}</Link></Button>} />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'suggestions' ? { tab: v } : {}, { replace: true })}>
        <TabsList className="mb-3">
          <TabsTrigger value="documents">{t('Documents')}</TabsTrigger>
          <TabsTrigger value="suggestions">{t('New prices from the cost')}{waiting > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground tabular-nums">{waiting}</span>}</TabsTrigger>
        </TabsList>
        <TabsContent value="documents">
          <DataTable tableKey="inventory.levels" columns={cols} data={q.data} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id} onRowClick={(r) => navigate(`/inventory/levelling/${r.id}`)}
            exportName={t('price-levelling')} empty={{ title: t('No levelling yet'), description: t('Start one to change several prices together.') }} />
        </TabsContent>
        <TabsContent value="suggestions"><PriceSuggestions /></TabsContent>
      </Tabs>
    </>
  )
}

export function PriceLevelPage() {
  const { id } = useParams()
  const { companyId } = useCompany()
  const q = useQuery({ queryKey: ['inv', companyId, 'level', id], enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('price_levels').select('*, warehouse:warehouses(name), lines:price_level_lines(*)').eq('id', id!).single()) as unknown as Level })
  if (id && q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (id && !q.data) return <Skeleton className="h-96" />
  return <Editor key={`${q.data?.id ?? 'new'}-${q.data?.status ?? ''}`} doc={q.data} />
}

function Editor({ doc }: { doc?: Level }) {
  const { companyId, can, company } = useCompany()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const catalog = useScanCatalog()
  const categories = useCategories()
  const warehouses = useWarehouses()
  const rules = usePriceRules()
  const step = num(rules.data?.step)
  const posted = doc?.status === 'posted'
  const editable = !posted && can('inventory.write')
  const [date, setDate] = React.useState(doc?.level_date ?? todayISO())
  const [wh, setWh] = React.useState<string>(doc?.warehouse_id ?? 'all')
  const [notes, setNotes] = React.useState(doc?.notes ?? '')
  const [rows, setRows] = React.useState<Row[]>([])
  const [pct, setPct] = React.useState('')
  const [fixed, setFixed] = React.useState('')
  /** the fixed margin in force: items added later get it too */
  const [fixedOn, setFixedOn] = React.useState<number | null>(null)
  const loaded = React.useRef(false)
  const basis = rules.data?.basis ?? 'markup'
  // margin the company's way: on the cost (markup) or on the selling price
  const marginOf = (net: number, cost: number) => cost > 0 && net > 0 ? (basis === 'markup' ? (net - cost) / cost * 100 : (net - cost) / net * 100) : null
  const netFor = (cost: number, m: number) => basis === 'markup' ? cost * (1 + m / 100) : m < 100 ? cost / (1 - m / 100) : null

  const fetchItems = React.useCallback(async (ids: string[]) => ids.length
    ? (unwrap(await supabase.rpc('price_level_items', { p_company: companyId!, p_variants: ids, p_warehouse: (wh === 'all' ? null : wh) as string })) as unknown as Item[]) : [], [companyId, wh])
  // a saved document: its items with their price and stock now
  React.useEffect(() => {
    if (!doc || loaded.current || !companyId) return
    loaded.current = true
    void fetchItems(doc.lines.map((l) => l.variant_id)).then((items) => {
      const by = new Map(items.map((i) => [i.variant_id, i]))
      setRows([...doc.lines].sort((a, b) => a.line_no - b.line_no).flatMap((l) => {
        const i = by.get(l.variant_id); if (!i) return []
        const old = posted && l.old_price != null ? num(l.old_price) : i.price
        return [{ ...i, price: old, stock: posted && l.quantity != null ? num(l.quantity) : i.stock, gross: String(gross(num(l.new_price), i.vat_rate)) }]
      }))
    }).catch((e) => toast.error(describeError(e)))
  }, [doc, companyId, fetchItems, posted])

  const add = async (ids: string[]) => {
    const have = new Set(rows.map((r) => r.variant_id))
    const items = await fetchItems(ids.filter((x) => !have.has(x)))
    setRows((rs) => [...rs, ...items.map((i) => ({ ...i, gross: String(fixedOn != null && i.cost > 0 ? grossFor(i, fixedOn) ?? gross(i.price, i.vat_rate) : gross(i.price, i.vat_rate)) }))])
  }
  const options = React.useMemo(() => (companyId && catalog.ready ? searchOffline(companyId, '', 1_000_000) : [])
    .map((i) => ({ value: i.variant_id, label: i.name, hint: i.sku, keywords: i.barcodes.map(([b]) => b) })), [companyId, catalog.ready, catalog.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const roundUp = (g: number) => step > 0 ? Math.ceil(Math.round(g / step * 1e6) / 1e6) * step : r2(g)
  /** the selling price with VAT that gives this margin on the item's cost (rounded up to the company's step) */
  function grossFor(r: Item, m: number) {
    const n = netFor(r.cost, m); if (n == null || !(r.cost > 0)) return null
    // rounded up, never down: the margin asked for is the least the item earns
    const g = n * (1 + r.vat_rate / 100)
    return step > 0 ? r2(roundUp(g)) : Math.ceil(Math.round(g * 1e6) / 1e4) / 100
  }
  const applyFixed = () => {
    const m = num(fixed); if (fixed.trim() === '' || !Number.isFinite(m)) return
    if (basis === 'margin' && m >= 100) return void toast.error(t('A margin on the selling price must be below 100 %'))
    setFixedOn(m)
    let skipped = 0
    setRows((rs) => rs.map((r) => {
      if (r.manual) return r
      const g = grossFor(r, m); if (g == null) { skipped++; return r }
      return { ...r, gross: String(g), mtext: undefined }
    }))
    if (skipped) toast.info(t('{n} items have no cost yet; their price did not change', { n: skipped }))
  }
  const setMargin = (i: number, text: string) => setRows((rs) => rs.map((x, k) => {
    if (k !== i) return x
    const m = num(text); const g = text.trim() !== '' && Number.isFinite(m) ? grossFor(x, m) : null
    return { ...x, mtext: text, manual: true, gross: g != null ? String(g) : x.gross }
  }))
  const applyPct = () => {
    const p = num(pct); if (!p) return
    setRows((rs) => rs.map((r) => ({ ...r, gross: String(r2(roundUp(gross(r.price, r.vat_rate) * (1 + p / 100)))) })))
  }

  const calc = rows.map((r) => {
    const oldG = gross(r.price, r.vat_rate)
    const newG = r.gross === '' ? oldG : num(r.gross)
    const newNet = Math.round(newG / (1 + r.vat_rate / 100) * 10000) / 10000
    const margin = marginOf(newNet, r.cost)
    return { r, oldG, newG, newNet, diff: newG - oldG, value: r2(r.stock * (newG - oldG)), margin }
  })
  const total = calc.reduce((s, c) => s + c.value, 0)
  const changed = calc.filter((c) => Math.abs(c.diff) > 0.0001).length

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('save_document', {
      p_table: 'price_levels',
      p_header: { id: doc?.id, company_id: companyId, level_date: date, warehouse_id: wh === 'all' ? null : wh, notes: notes || null },
      p_children: { price_level_lines: calc.map((c, i) => ({ line_no: i + 1, variant_id: c.r.variant_id, new_price: c.newNet })) },
    })) as string,
    onError: (e) => toast.error(describeError(e)),
  })
  const post = useMutation({
    mutationFn: async () => {
      const id = await save.mutateAsync()
      return { id, r: unwrap(await supabase.rpc('price_level_post', { p_id: id })) as unknown as { changed: number; value_change: number; number: string } }
    },
    onSuccess: async ({ id, r }) => {
      await qc.invalidateQueries({ queryKey: ['inv'] })
      toast.success(t('{number} posted: {n} prices changed, value {amount} with VAT', { number: r.number, n: r.changed, amount: formatMoney(r.value_change, company?.base_currency) }))
      navigate(`/inventory/levelling/${id}`, { replace: true })
    },
    onError: (e) => toast.error(describeError(e)),
  })
  const del = useMutation({
    mutationFn: async () => unwrap(await supabase.from('price_levels').delete().eq('id', doc!.id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inv'] }); navigate('/inventory/levelling') },
  })

  const statement = async (): Promise<Statement> => {
    const p = unwrap(await supabase.rpc('price_level_print', { p_id: doc!.id })) as unknown as {
      number: string; date: string; warehouse: string | null; notes: string | null; value_change: number; currency: string; company: PrintDoc['company']
      printed_by: string | null; printed_at: string; posted_by: string | null
      lines: { sku: string; name: string; uom: string | null; vat_rate: number; quantity: number | null; old_price: number; new_price: number; value_change: number | null }[] }
    const dec = p.company.decimals ?? 2
    return {
      title: t('Price levelling'), number: p.number, subtitle: formatDate(p.date), company: p.company, partner: null,
      info: [[t('Date'), formatDate(p.date)], [t('Stock of'), p.warehouse ? td(p.warehouse) : t('All warehouses')], [t('Items'), String(p.lines.length)]],
      tables: [{ columns: [{ label: t('Code') }, { label: t('Item') }, { label: t('Unit') }, { label: t('Quantity'), align: 'right' }, { label: t('Old price (with VAT)'), align: 'right' },
        { label: t('New price (with VAT)'), align: 'right' }, { label: t('Difference'), align: 'right' }, { label: t('Value (with VAT)'), align: 'right' }],
        rows: p.lines.map((l) => {
          const o = gross(l.old_price, l.vat_rate), n = gross(l.new_price, l.vat_rate)
          return [l.sku, l.name, l.uom ? td(l.uom) : '', qf(l.quantity), nf(o, dec), nf(n, dec), nf(n - o, dec), nf(l.value_change ?? 0, dec)]
        }) }],
      summary: [[t('Value change (with VAT)'), `${nf(p.value_change, dec)} ${p.currency}`, true]],
      texts: [t('Prices with VAT.'), p.notes ?? ''], signatures: [t('Prepared by'), t('Approved by')], printed_by: p.printed_by, printed_at: p.printed_at,
    }
  }

  return (
    <>
      <PageHeader back={{ href: '/inventory/levelling', label: t('Price levelling') }}
        title={doc?.number ?? t('New levelling')} meta={doc && <StatusBadge status={doc.status} />}
        actions={<>
          {doc && posted && <StatementActions build={statement} />}
          {doc && posted && <Button variant="outline" asChild><Link to={`/inventory/labels?level=${doc.id}`}><Tag /> {t('Labels')}</Link></Button>}
          {doc && editable && <ConfirmDialog title={t('Delete this draft?')} description={t('The prices do not change.')} confirmLabel={t('Delete')} destructive onConfirm={() => del.mutateAsync()}
            trigger={<Button variant="ghost" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} />}
          {editable && <Button variant="outline" loading={save.isPending && !post.isPending} disabled={!rows.length}
            onClick={async () => { const id = await save.mutateAsync(); await qc.invalidateQueries({ queryKey: ['inv'] }); toast.success(t('Draft saved')); if (!doc) navigate(`/inventory/levelling/${id}`, { replace: true }) }}><Save /> {t('Save draft')}</Button>}
          {editable && <ConfirmDialog title={t('Post the levelling?')} description={t('{n} prices change now. Value of the change on the stock, with VAT: {amount}.', { n: changed, amount: formatMoney(total, company?.base_currency) })}
            confirmLabel={t('Post')} onConfirm={() => post.mutateAsync()} trigger={<Button disabled={!changed} loading={post.isPending}><Check /> {t('Post')}</Button>} />}
        </>} />

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[160px_220px_1fr]">
        <div className="grid gap-1.5"><Label htmlFor="lv-date">{t('Date')}</Label><Input id="lv-date" type="date" disabled={!editable} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>{t('Stock of')}</Label>
          <Select value={wh} onValueChange={setWh} disabled={!editable || rows.length > 0}>
            <SelectTrigger aria-label={t('Stock of')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All warehouses')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1.5"><Label htmlFor="lv-notes">{t('Notes')}</Label><Textarea id="lv-notes" rows={1} disabled={!editable} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>

      {editable && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[280px] flex-1"><SearchSelect value={null} options={options} placeholder={t('Add an item: name, code or scan the barcode')} searchPlaceholder={t('Name, code or barcode')}
            onChange={(v) => v && void add([v]).catch((e) => toast.error(describeError(e)))} /></div>
          <div className="w-56"><SearchSelect value={null} placeholder={t('Add a whole category')} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            onChange={async (v) => {
              if (!v) return
              const ids = unwrap(await supabase.from('product_variants').select('id, products!inner(category_id)').eq('products.category_id', v).eq('company_id', companyId!).is('deleted_at', null).eq('is_active', true)).map((x) => x.id)
              if (!ids.length) return void toast.info(t('No items in this category'))
              await add(ids)
            }} /></div>
          <div className="flex items-end gap-1.5">
            <div className="grid gap-1.5"><Label htmlFor="lv-fixed" className="text-xs">{basis === 'markup' ? t('Fixed margin on the cost %') : t('Fixed margin on the price %')}</Label>
              <Input id="lv-fixed" type="number" step="any" className="h-9 w-24 text-right" placeholder="25" value={fixed} onChange={(e) => setFixed(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyFixed() } }} /></div>
            <Button variant="outline" disabled={!rows.length || fixed.trim() === ''} onClick={applyFixed}><Percent /> {t('Apply to all')}</Button>
          </div>
          <div className="flex items-end gap-1.5">
            <div className="grid gap-1.5"><Label htmlFor="lv-pct" className="text-xs">{t('Change all by %')}</Label>
              <Input id="lv-pct" type="number" step="any" className="h-9 w-24 text-right" placeholder="+5" value={pct} onChange={(e) => setPct(e.target.value)} /></div>
            <Button variant="outline" disabled={!rows.length || !num(pct)} onClick={applyPct}><Percent /> {t('Apply')}</Button>
          </div>
        </div>
      )}

      {editable && fixedOn != null && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.05] px-3 py-2 text-[13px]">
          <span>{t('Fixed margin {m} % in force: every item added gets it. Type a different margin on a row to set it by hand.', { m: formatQty(fixedOn) })}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setFixedOn(null)}><X /> {t('Stop')}</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Tag} title={t('No items yet')} description={t('Add items one by one or a whole category, then type the new prices (with VAT) or change them all by a percentage.')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
              <th className="px-3 py-2 font-medium">{t('Item')}</th><th className="px-3 py-2 text-right font-medium">{t('Stock')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Cost (without VAT)')}</th><th className="px-3 py-2 text-right font-medium">{t('Old price (with VAT)')}</th>
              <th className="w-36 px-3 py-2 text-right font-medium">{t('New price (with VAT)')}</th><th className="px-3 py-2 text-right font-medium">{t('Difference')}</th>
              <th className="w-28 px-3 py-2 text-right font-medium" title={basis === 'markup' ? t('Margin on the cost, without VAT') : t('Margin on the selling price, without VAT')}>{t('Margin %')}
                <span className="block text-[10px] font-normal">{basis === 'markup' ? t('on the cost') : t('on the price')}</span></th><th className="px-3 py-2 text-right font-medium">{t('Value (with VAT)')}</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {calc.map((c, i) => (
                <tr key={c.r.variant_id} className="border-t">
                  <td className="px-3 py-1.5"><div className="font-medium">{c.r.name}</div><div className="text-xs text-muted-foreground">{c.r.sku}{c.r.category ? ` · ${c.r.category}` : ''} · {t('VAT {rate}%', { rate: c.r.vat_rate })}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(c.r.stock)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c.r.cost ? formatMoney(c.r.cost) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(c.oldG)}</td>
                  <td className="px-2 py-1">{editable
                    ? <Input inputMode="decimal" className="h-8 text-right tabular-nums" value={c.r.gross} aria-label={t('New price of {name}', { name: c.r.name })} onFocus={(e) => e.target.select()}
                        onChange={(e) => setRows((rs) => rs.map((x, k) => k === i ? { ...x, gross: e.target.value, mtext: undefined } : x))} />
                    : <div className="text-right font-medium tabular-nums">{formatMoney(c.newG)}</div>}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', c.diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : c.diff < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {Math.abs(c.diff) > 0.0001 ? `${c.diff > 0 ? '+' : ''}${formatMoney(c.diff)}` : '—'}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', c.margin != null && c.margin < 0 && 'text-destructive')}>{editable && c.r.cost > 0
                    ? <div className="flex items-center justify-end gap-1">
                        {c.r.manual && <button type="button" title={t('Set by hand; tap to follow the fixed margin again')} className="rounded bg-warning/15 px-1 text-[10px] text-warning"
                          onClick={() => setRows((rs) => rs.map((x, k) => k === i ? { ...x, manual: false, mtext: undefined, gross: fixedOn != null ? String(grossFor(x, fixedOn) ?? x.gross) : x.gross } : x))}>{t('by hand')}</button>}
                        <Input inputMode="decimal" className={cn('h-8 w-20 text-right tabular-nums', c.margin != null && c.margin < 0 && 'text-destructive')} aria-label={t('Margin of {name}', { name: c.r.name })}
                          value={c.r.mtext ?? (c.margin == null ? '' : String(Math.round(c.margin * 10) / 10))} onFocus={(e) => e.target.select()}
                          onChange={(e) => setMargin(i, e.target.value.replace(',', '.'))} onBlur={() => setRows((rs) => rs.map((x, k) => k === i ? { ...x, mtext: undefined } : x))} />
                      </div>
                    : c.margin == null ? '—' : `${nf(c.margin, 1)}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.value ? formatMoney(c.value) : '—'}</td>
                  <td className="px-1">{editable && <Button variant="ghost" size="icon-sm" aria-label={t('Remove {name}', { name: c.r.name })} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}><Trash2 /></Button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t bg-muted/30 font-medium">
              <td className="px-3 py-2" colSpan={7}>{t('{n} prices change · value of the change on the stock (with VAT)', { n: changed })}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(posted && doc ? doc.value_change : total, company?.base_currency)}</td><td />
            </tr></tfoot>
          </table>
        </div>
      )}
    </>
  )
}
