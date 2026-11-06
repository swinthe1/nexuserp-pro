import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, Columns3, Download, FileSpreadsheet, FileText, Play, Printer, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useActiveUnit } from '@/app/active-unit'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { exportCsv, exportPdf, exportXlsx } from '@/lib/export'
import { printTable } from '@/lib/print-table'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '@/features/inventory/api'
import { useActiveVendors } from '@/features/procurement/api'
import { useSellableVariants } from '@/features/sales/api'
import { Pick, SavedFilters } from '@/features/reports/components/saved-filters'

type Row = Record<string, unknown>
type Cell = string | number | null
type ColType = 'text' | 'date' | 'money' | 'price' | 'qty' | 'pct' | 'rate' | 'blank'
type Col = { id: string; label: string; type: ColType; hidden?: boolean; strong?: boolean; total?: boolean }

type Filters = {
  report: string; as_of: string; units: string[]; split: boolean; group_by: string
  categories: string[]; producers: string[]; brands: string[]; vendors: string[]; items: string[]; vat_rates: string[]; types: string[]
  active: string; stock: string; sheet: string; blind: boolean
}

const REPORTS = [
  { value: 'avg', label: msg('1. At average cost') },
  { value: 'avg_sale', label: msg('2. At average cost and sale price') },
  { value: 'last_cost', label: msg('3. At the last purchase cost') },
  { value: 'price_list', label: msg('4. Sale price list') },
  { value: 'sheet', label: msg('5. Stock sheet') },
  { value: 'by_producer', label: msg('6. Grouped by producer') },
  { value: 'sale', label: msg('7. At sale prices') },
]
const SHEETS = [
  { value: 'charge', label: msg('What the storekeeper is charged with') },
  { value: 'loading', label: msg('Loading list') },
  { value: 'count', label: msg('Count sheet') },
]
const GROUPS = [
  { value: 'none', label: msg('No grouping') }, { value: 'group', label: msg('Group') }, { value: 'category', label: msg('Sub-group') },
  { value: 'producer', label: msg('Producer') }, { value: 'unit', label: msg('Unit|store') }, { value: 'vendor', label: msg('Last supplier') },
]
const STOCKS = [
  { value: 'nonzero', label: msg('With stock (not zero)') }, { value: 'positive', label: msg('Only above zero') }, { value: 'all', label: msg('Also items at zero') },
  { value: 'zero', label: msg('Only items at zero') }, { value: 'negative', label: msg('Only negative stock') }, { value: 'below_min', label: msg('Below the minimum') },
]
const TYPES = [{ value: 'stockable', label: msg('Stocked item') }, { value: 'consumable', label: msg('Consumable') }, { value: 'service', label: msg('Service') }]

const blank = (unit: string | null): Filters => ({
  report: 'avg', as_of: todayISO(), units: unit ? [unit] : [], split: false, group_by: 'none',
  categories: [], producers: [], brands: [], vendors: [], items: [], vat_rates: [], types: [], active: 'active', stock: 'nonzero', sheet: 'charge', blind: false,
})

/** the columns of each report (English labels, translated when drawn) */
function columnsOf(f: Filters): Col[] {
  const lead: Col[] = [
    { id: 'code', label: msg('Code'), type: 'text' },
    { id: 'barcode', label: msg('Barcode'), type: 'text', hidden: !['price_list', 'sheet'].includes(f.report) || f.sheet === 'charge' },
    { id: 'item', label: msg('Item'), type: 'text', strong: true },
    { id: 'group', label: msg('Group'), type: 'text', hidden: true },
    { id: 'category', label: msg('Sub-group'), type: 'text', hidden: true },
    { id: 'producer', label: msg('Producer'), type: 'text', hidden: true },
    { id: 'brand', label: msg('Brand'), type: 'text', hidden: true },
    { id: 'uom', label: msg('Unit|measure'), type: 'text' },
    ...(f.split ? [{ id: 'unit', label: msg('Unit|store'), type: 'text' }] as Col[] : []),
  ]
  const qty: Col = { id: 'qty', label: msg('Quantity'), type: 'qty', total: true, strong: true }
  const extra: Col[] = [
    { id: 'min_qty', label: msg('Minimum'), type: 'qty', hidden: true }, { id: 'last_in', label: msg('Last in'), type: 'date', hidden: true },
    { id: 'last_out', label: msg('Last out'), type: 'date', hidden: true },
  ]
  const money = (id: string, label: string, o: Partial<Col> = {}): Col => ({ id, label, type: 'money', total: true, ...o })
  const price = (id: string, label: string, o: Partial<Col> = {}): Col => ({ id, label, type: 'price', ...o })
  switch (f.report) {
    case 'avg_sale': return [...lead, qty, price('avg_cost', msg('Average cost')), money('value', msg('Value at cost')),
      price('sale_net', msg('Sale price without VAT'), { hidden: true }), price('sale_gross', msg('Sale price with VAT')),
      money('value_sale_net', msg('Sale value without VAT'), { hidden: true }), money('value_sale_gross', msg('Sale value with VAT')),
      money('margin', msg('Expected margin'), { strong: true }), { id: 'margin_pct', label: msg('Margin %'), type: 'pct' }, { id: 'markup_pct', label: msg('Markup %'), type: 'pct', hidden: true }, ...extra]
    case 'last_cost': return [...lead, qty, price('avg_cost', msg('Average cost')), money('value', msg('Value at cost')),
      price('last_cost', msg('Last purchase cost'), { strong: true }), money('value_last', msg('Value at the last cost')), money('diff_last', msg('Difference')),
      { id: 'last_date', label: msg('Last bought'), type: 'date' }, { id: 'last_vendor', label: msg('Last supplier'), type: 'text' }, ...extra]
    case 'price_list': return [...lead, { id: 'vat_rate', label: msg('VAT rate'), type: 'rate' }, price('sale_net', msg('Price without VAT')),
      price('sale_gross', msg('Price with VAT'), { strong: true }), { ...qty, hidden: true, strong: false }, ...extra]
    case 'sheet':
      if (f.sheet === 'loading') return [...lead, qty, { id: '_loaded', label: msg('Loaded'), type: 'blank' }, { id: '_note', label: msg('Notes'), type: 'blank' }]
      if (f.sheet === 'count') return [...lead, ...(f.blind ? [] : [qty]), { id: '_counted', label: msg('Counted'), type: 'blank' }, { id: '_diff', label: msg('Difference'), type: 'blank' }]
      return [...lead, qty, price('sale_gross', msg('Sale price with VAT')), money('value_sale_gross', msg('Value with VAT'), { strong: true }), ...extra]
    case 'by_producer': return [...lead.map((c) => (c.id === 'producer' ? { ...c, hidden: f.group_by === 'producer' } : c)), qty,
      price('avg_cost', msg('Average cost'), { hidden: true }), money('value', msg('Value at cost')), money('value_sale_gross', msg('Sale value with VAT')), ...extra]
    case 'sale': return [...lead, qty, { id: 'vat_rate', label: msg('VAT rate'), type: 'rate', hidden: true }, price('sale_net', msg('Price without VAT'), { hidden: true }),
      price('sale_gross', msg('Price with VAT')), money('value_sale_net', msg('Value without VAT')), money('vat_in_sale', msg('VAT')),
      money('value_sale_gross', msg('Value with VAT'), { strong: true }), ...extra]
    default: return [...lead, qty, price('avg_cost', msg('Average cost')), money('value', msg('Value'), { strong: true }), ...extra]
  }
}

const SIGNATURES: Record<string, string[]> = {
  charge: [msg('Handed over'), msg('Received (storekeeper)')],
  loading: [msg('Loaded by'), msg('Driver'), msg('Received by')],
  count: [msg('Counted by'), msg('Checked by'), msg('Storekeeper')],
}

const right = (c: Col) => !['text', 'date', 'blank'].includes(c.type)
function shown(c: Col, v: unknown): string {
  if (c.type === 'blank') return ''
  if (v === null || v === undefined || v === '') return ''
  switch (c.type) {
    case 'date': return formatDate(String(v))
    case 'money': return formatMoney(num(v))
    case 'price': { const n = num(v); return Number.isInteger(n * 100) ? formatMoney(n) : formatMoney(n, undefined, 4) }
    case 'qty': return formatQty(num(v))
    case 'pct': case 'rate': return `${formatQty(num(v))}%`
    default: return td(String(v))
  }
}
const exportValue = (c: Col, v: unknown): Cell => (c.type === 'blank' ? '' : v === null || v === undefined || v === '' ? null : right(c) ? num(v) : shown(c, v))
const groupKey = (r: Row, by: string): string => {
  const v = by === 'vendor' ? r.last_vendor : r[by]
  return v ? String(v) : ''
}
const noGroupLabel = (by: string) => ({ group: t('No group'), category: t('No sub-group'), producer: t('No producer'), unit: t('All units'), vendor: t('No purchase') } as Record<string, string>)[by] ?? '—'

/** "Raporti i stokut": the stock on any day, in the seven ways the old programs list it. */
export function StockReportPage() {
  const { companyId, company } = useCompany()
  const { unit, multi } = useActiveUnit()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const start = React.useMemo(() => blank(unit?.id ?? null), [unit?.id])
  const applied: Filters = React.useMemo(() => {
    try { const f = params.get('f'); return f ? { ...start, ...JSON.parse(f) } as Filters : start } catch { return start }
  }, [params, start])
  const [draft, setDraft] = React.useState<Filters>(applied)
  React.useEffect(() => setDraft(applied), [applied])
  const [more, setMore] = React.useState(false)
  const apply = (f: Filters) => setParams((p) => { const n = new URLSearchParams(p); n.set('f', JSON.stringify(f)); return n })
  const put = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }))
  // choosing a report sets what suits it; the rest stays as it was
  const pickReport = (r: string) => setDraft((d) => ({
    ...d, report: r,
    group_by: r === 'by_producer' ? 'producer' : d.report === 'by_producer' && d.group_by === 'producer' ? 'none' : d.group_by,
    stock: r === 'price_list' ? 'all' : r === 'sheet' ? 'positive' : d.stock === 'all' && d.report === 'price_list' ? 'nonzero' : d.stock,
  }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied)

  const whs = useWarehouses()
  const vendors = useActiveVendors()
  const variants = useSellableVariants()
  const cats = useCategories()
  const names = useQuery({
    queryKey: ['stock-report-names', companyId], enabled: !!companyId && more, staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('products').select('manufacturer, brand').eq('company_id', companyId!).is('deleted_at', null).limit(20000))
      const uniq = (k: 'manufacturer' | 'brand') => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
      return { producers: uniq('manufacturer'), brands: uniq('brand') }
    },
  })
  const q = useQuery({
    queryKey: ['stock-report', companyId, applied], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('stock_report', { p_company: companyId!, p: {
      ...applied, vat_rates: applied.vat_rates.map(Number), sheet: undefined, blind: undefined,
    } as unknown as Json })) as unknown as { rows: Row[]; count: number; truncated: boolean; as_of: string; currency: string; company: { name: string; tax_number: string | null }; units: string[] },
  })

  const unitOpts = (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))
  const catOpts = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const reportLabel = t(REPORTS.find((r) => r.value === applied.report)?.label ?? '').replace(/^\d\.\s*/, '')
  const title = applied.report === 'sheet' ? t(SHEETS.find((s) => s.value === applied.sheet)?.label ?? '') : `${t('Stock report')} – ${reportLabel}`

  // what was asked, in words: under the title and on every export
  const said = React.useMemo(() => {
    const pick = (ids: string[], opts: { value: string; label: string }[]) => ids.map((id) => opts.find((o) => o.value === id)?.label ?? '').filter(Boolean).join(', ')
    const parts = [t('Stock on {date}', { date: formatDate(q.data?.as_of ?? applied.as_of) })]
    parts.push(applied.units.length ? `${t('Units|stores')}: ${pick(applied.units, unitOpts)}` : t('All units'))
    if (applied.split) parts.push(t('A row per unit'))
    if (applied.categories.length) parts.push(`${t('Groups')}: ${pick(applied.categories, catOpts)}`)
    if (applied.producers.length) parts.push(`${t('Producers')}: ${applied.producers.join(', ')}`)
    if (applied.brands.length) parts.push(`${t('Brands')}: ${applied.brands.join(', ')}`)
    if (applied.vendors.length) parts.push(`${t('Suppliers')}: ${pick(applied.vendors, (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })))}`)
    if (applied.items.length) parts.push(`${t('Items')}: ${applied.items.length}`)
    if (applied.vat_rates.length) parts.push(`${t('VAT')} ${applied.vat_rates.map((r) => `${r}%`).join(', ')}`)
    if (applied.stock !== 'nonzero') parts.push(t(STOCKS.find((s) => s.value === applied.stock)?.label ?? ''))
    if (applied.active !== 'active') parts.push(applied.active === 'inactive' ? t('Only inactive items') : t('Active and inactive items'))
    return parts.join(' · ')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, q.data?.as_of, whs.data, cats.data, vendors.data])
  const header = [company?.name, company && (company as { tax_number?: string | null }).tax_number ? `${t('Tax number')} ${(company as { tax_number?: string | null }).tax_number}` : null].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader back={{ href: '/inventory/stock', label: t('Stock levels') }} title={t('Stock report')}
        description={t('The stock on any day, counted from the stock movements: at cost, at the last purchase cost, at sale prices, as a price list or as a sheet to sign. Values in {currency}.', { currency: q.data?.currency ?? company?.base_currency ?? '' })}
        actions={<SavedFilters<Filters> storeKey="inventory.stock-report.filters" current={() => draft}
          prepare={(f) => (f.as_of === todayISO() ? { ...f, as_of: undefined } : f)} onApply={(f) => apply({ ...start, ...f })} />} />

      <div className="mb-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label className="text-xs">{t('Report')}</Label>
            <Select value={draft.report} onValueChange={pickReport}>
              <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
              <SelectContent>{REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{t(r.label)}</SelectItem>)}</SelectContent>
            </Select></div>
          {draft.report === 'sheet' && <Pick label={t('Kind of sheet')} value={draft.sheet} onChange={(v) => put('sheet', v)} width="w-64" options={SHEETS.map((s) => ({ value: s.value, label: t(s.label) }))} />}
          <div className="grid gap-1"><Label className="text-xs">{t('Stock on')}</Label>
            <Input type="date" className="h-9 w-40" value={draft.as_of} max={todayISO()} onChange={(e) => put('as_of', e.target.value || todayISO())} /></div>
          {multi && <MultiPick label={t('Units|stores')} value={draft.units} onChange={(v) => put('units', v)} options={unitOpts} />}
          {multi && <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-[13px]"><Switch checked={draft.split} onCheckedChange={(v) => put('split', v)} />{t('A row per unit')}</label>}
          <MultiPick label={t('Groups')} value={draft.categories} onChange={(v) => put('categories', v)} options={catOpts} />
          <Button variant={more ? 'secondary' : 'outline'} className="h-9" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <SlidersHorizontal /> {t('Advanced filters')}<ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="h-9" onClick={() => setDraft(start)}><RotateCcw /> {t('Clear')}</Button>
            <Button className="h-9 min-w-24" onClick={() => apply(draft)}><Play /> OK</Button>
          </div>
        </div>
        {more && (
          <div className="mt-3 grid gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <MultiPick label={t('Producers')} value={draft.producers} onChange={(v) => put('producers', v)} options={(names.data?.producers ?? []).map((b) => ({ value: b, label: b }))} />
              <MultiPick label={t('Brands')} value={draft.brands} onChange={(v) => put('brands', v)} options={(names.data?.brands ?? []).map((b) => ({ value: b, label: b }))} />
              <MultiPick label={t('Suppliers')} value={draft.vendors} onChange={(v) => put('vendors', v)} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))} />
              <MultiPick label={t('Items')} value={draft.items} onChange={(v) => put('items', v)} options={(variants.data ?? []).map((v) => ({ value: v.id, label: td(v.name), hint: v.sku }))} />
              <MultiPick label={t('VAT rate')} value={draft.vat_rates} onChange={(v) => put('vat_rates', v)} options={['18', '8', '0'].map((r) => ({ value: r, label: `${r}%` }))} />
              <MultiPick label={t('Kind of item')} value={draft.types} onChange={(v) => put('types', v)} options={TYPES.map((x) => ({ value: x.value, label: t(x.label) }))} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Pick label={t('Stock')} value={draft.stock} onChange={(v) => put('stock', v)} width="w-56" options={STOCKS.map((s) => ({ value: s.value, label: t(s.label) }))} />
              <Pick label={t('Items|active')} value={draft.active} onChange={(v) => put('active', v)} width="w-48"
                options={[{ value: 'active', label: t('Only active') }, { value: 'inactive', label: t('Only inactive') }, { value: 'all', label: t('Active and inactive') }]} />
              <Pick label={t('Group and subtotal by')} value={draft.group_by} onChange={(v) => put('group_by', v)} width="w-52" options={GROUPS.map((g) => ({ value: g.value, label: t(g.label) }))} />
              {draft.report === 'sheet' && draft.sheet === 'count' && (
                <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-[13px]"><Switch checked={draft.blind} onCheckedChange={(v) => put('blind', v)} />{t('Without the quantity in the books (blind count)')}</label>
              )}
            </div>
          </div>
        )}
        {dirty && <p className="mt-2 text-[12.5px] text-warning">{t('The filters changed. Press OK to see the report with them.')}</p>}
      </div>

      <p className="mb-2 text-[12.5px] text-muted-foreground">{said}</p>
      {q.data?.truncated && <p className="mb-2 text-[12.5px] text-warning">{t('Only the first {n} rows are shown. Narrow the dates or the filters to see all of them.', { n: q.data.count })}</p>}

      {q.isLoading ? <Card className="p-4"><div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7" />)}</div></Card>
        : q.error ? <Card><EmptyState title={t('The report could not be made')} description={(q.error as Error).message} /></Card>
        : <ReportTable rows={q.data?.rows ?? []} filters={applied} title={title} subtitle={[header, said].filter(Boolean).join(' · ')}
            fileName={`${t('Stock report')} ${q.data?.as_of ?? applied.as_of}`} onOpen={(r) => navigate(`/inventory/item-card?v=${r.variant_id}`)} />}
      {applied.report === 'sale' && !!q.data?.rows.length && <VatSummary rows={q.data.rows} />}
    </>
  )
}

/** the rows, with groups and their subtotals, sortable, searchable, the columns to choose; exports what is seen */
function ReportTable({ rows, filters, title, subtitle, fileName, onOpen }: {
  rows: Row[]; filters: Filters; title: string; subtitle: string; fileName: string; onOpen: (r: Row) => void
}) {
  const cols = React.useMemo(() => columnsOf(filters), [filters])
  const storeKey = `stock-report.cols.${filters.report}.${filters.sheet}`
  const [hidden, setHidden] = React.useState<Set<string>>(() => readHidden(storeKey, cols))
  React.useEffect(() => setHidden(readHidden(storeKey, cols)), [storeKey, cols])
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); try { localStorage.setItem(storeKey, JSON.stringify([...n])) } catch { /* private mode */ } return n })
  const visible = cols.filter((c) => !hidden.has(c.id))
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<{ id: string; desc: boolean } | null>(null)
  const [limit, setLimit] = React.useState(300)
  const by = filters.group_by

  const list = React.useMemo(() => {
    const s = search.trim().toLowerCase()
    let r = s ? rows.filter((x) => [x.code, x.item, x.barcode, x.producer, x.brand, x.category].some((v) => v && String(v).toLowerCase().includes(s))) : rows
    if (sort) {
      const c = cols.find((x) => x.id === sort.id)
      r = [...r].sort((a, b) => {
        const va = a[sort.id], vb = b[sort.id]
        const d = c && right(c) ? num(va) - num(vb) : String(va ?? '').localeCompare(String(vb ?? ''))
        return sort.desc ? -d : d
      })
    }
    return r
  }, [rows, search, sort, cols])
  const groups = React.useMemo(() => {
    if (by === 'none') return null
    const m = new Map<string, Row[]>()
    for (const r of list) { const k = groupKey(r, by); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]) }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
  }, [list, by])

  const sumOf = (rs: Row[], c: Col) => rs.reduce((s, r) => s + num(r[c.id]), 0)
  const totalCell = (rs: Row[], c: Col): Cell => {
    if (c.total) return Math.round(sumOf(rs, c) * 1000) / 1000
    if (c.id === 'margin_pct') { const sale = rs.reduce((s, r) => s + num(r.value_sale_net), 0); return sale ? Math.round((1000 * rs.reduce((s, r) => s + num(r.margin), 0)) / sale) / 10 : null }
    return null
  }
  const fmtTotal = (c: Col, v: Cell) => (v === null ? '' : c.type === 'pct' ? `${formatQty(v as number)}%` : c.type === 'qty' ? formatQty(v as number) : formatMoney(v as number))

  // the grid of an export: the header, then the rows (with a heading and a subtotal for each group), then the total
  const grid = () => {
    const out: Cell[][] = []; const marks: ('group' | 'sub' | undefined)[] = []
    const push = (r: Row) => { out.push(visible.map((c) => exportValue(c, r[c.id]))); marks.push(undefined) }
    if (groups) for (const [k, rs] of groups) {
      out.push(visible.map((_, i) => (i === 0 ? `${k || noGroupLabel(by)} (${rs.length})` : null))); marks.push('group')
      rs.forEach(push)
      out.push(visible.map((c, i) => (i === 0 ? t('Total {name}', { name: k || noGroupLabel(by) }) : totalCell(rs, c)))); marks.push('sub')
    } else list.forEach(push)
    const totals = visible.map((c, i) => (i === 0 ? t('Total') : totalCell(list, c)))
    return { out, marks, totals }
  }
  const run = async (kind: 'xlsx' | 'pdf' | 'csv' | 'print') => {
    if (!list.length) { toast.info(t('Nothing to export on this page yet')); return }
    const { out, marks, totals } = grid()
    const columns = visible.map((c, i) => ({ header: t(c.label), value: (r: Cell[]) => r[i] ?? null, format: (c.type === 'qty' ? 'qty' : right(c) ? 'money' : undefined) as 'qty' | 'money' | undefined }))
    const body = [...out, totals]
    if (kind === 'print') printTable({ title, subtitle, columns: visible.map((c) => ({ header: t(c.label), format: c.type === 'text' || c.type === 'date' || c.type === 'blank' ? 'text' : c.type === 'qty' ? 'qty' : 'money', nowrap: c.id === 'code' || c.id === 'barcode' || c.type === 'date', write: c.type === 'blank' ? 13 : undefined })),
      rows: out, totals, marks, signatures: filters.report === 'sheet' ? (SIGNATURES[filters.sheet] ?? []).map((s) => t(s)) : undefined })
    else if (kind === 'xlsx') await exportXlsx(body, columns, fileName, { sheet: t('Stock report'), title: [title, subtitle] })
    else if (kind === 'pdf') await exportPdf(body, columns, fileName, title, subtitle)
    else exportCsv(body, columns, fileName)
  }

  const head = (c: Col) => (
    <TableHead key={c.id} className={cn(right(c) && 'text-right', c.type === 'blank' && 'min-w-28')}>
      {c.type === 'blank' ? t(c.label) : (
        <button type="button" className={cn('inline-flex items-center gap-1 hover:text-foreground', right(c) && 'flex-row-reverse')}
          onClick={() => setSort((s) => (s?.id === c.id ? (s.desc ? null : { id: c.id, desc: true }) : { id: c.id, desc: false }))}>
          {t(c.label)}{sort?.id === c.id && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>)}
    </TableHead>
  )
  const line = (r: Row, i: number) => (
    <TableRow key={`${String(r.variant_id)}-${String(r.unit_id ?? '')}-${i}`} className="cursor-pointer" onClick={() => onOpen(r)}>
      {visible.map((c) => {
        const v = r[c.id]
        return <TableCell key={c.id} className={cn(right(c) && 'text-right tabular', c.strong && 'font-medium', right(c) && num(v) < 0 && 'text-destructive', c.type === 'blank' && 'border-b border-dashed')}>
          {shown(c, v) || (c.type === 'blank' ? '' : <span className="text-muted-foreground">—</span>)}</TableCell>
      })}
    </TableRow>
  )
  let count = 0
  const body: React.ReactNode[] = []
  if (groups) {
    for (const [k, rs] of groups) {
      if (count >= limit) break
      body.push(<TableRow key={`g-${k}`} className="bg-muted/50 hover:bg-muted/50"><TableCell colSpan={visible.length} className="font-semibold">{k ? td(k) : noGroupLabel(by)} <span className="font-normal text-muted-foreground">({rs.length})</span></TableCell></TableRow>)
      for (const r of rs) { if (count >= limit) break; body.push(line(r, count)); count++ }
      body.push(<TableRow key={`s-${k}`} className="hover:bg-transparent">{visible.map((c, i) => (
        <TableCell key={c.id} className={cn('border-b-2 font-semibold', right(c) && 'text-right tabular')}>{i === 0 ? t('Total {name}', { name: k ? td(k) : noGroupLabel(by) }) : fmtTotal(c, totalCell(rs, c))}</TableCell>))}</TableRow>)
    }
  } else for (const r of list) { if (count >= limit) break; body.push(line(r, count)); count++ }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Code, name, barcode, producer…')} className="h-8 pl-8 text-[13px]" aria-label={t('Search the list')} />
        </div>
        <span className="text-[12.5px] text-muted-foreground">{t('{n} items', { n: list.length })}</span>
        <div className="ml-auto flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Columns3 /> {t('Columns')}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
              <DropdownMenuLabel>{t('Columns')}</DropdownMenuLabel><DropdownMenuSeparator />
              {cols.map((c) => <DropdownMenuCheckboxItem key={c.id} checked={!hidden.has(c.id)} onCheckedChange={() => toggle(c.id)} onSelect={(e) => e.preventDefault()}>{t(c.label)}</DropdownMenuCheckboxItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Download /> {t('Export')}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void run('xlsx')}><FileSpreadsheet /> Excel</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run('pdf')}><FileText /> PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run('csv')}><FileSpreadsheet /> CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void run('print')}><Printer /> {t('Print')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!list.length ? <Card><EmptyState title={t('Nothing in stock with these filters')} description={t('Change the day, the units or the filters, then press OK.')} /></Card> : (
        <div className="overflow-auto rounded-lg border bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>{visible.map(head)}</TableRow></TableHeader>
            <TableBody>{body}</TableBody>
            <TableFooter><TableRow className="font-semibold hover:bg-transparent">{visible.map((c, i) => (
              <TableCell key={c.id} className={cn(right(c) && 'text-right tabular')}>{i === 0 ? t('Total') : fmtTotal(c, totalCell(list, c))}</TableCell>))}</TableRow></TableFooter>
          </Table>
        </div>
      )}
      {count < list.length && (
        <div className="flex justify-center"><Button variant="outline" onClick={() => setLimit(Number.MAX_SAFE_INTEGER)}>{t('Show all {n} rows', { n: list.length })}</Button></div>
      )}
    </div>
  )
}

function readHidden(key: string, cols: Col[]): Set<string> {
  try { const s = localStorage.getItem(key); if (s) return new Set(JSON.parse(s) as string[]) } catch { /* private mode */ }
  return new Set(cols.filter((c) => c.hidden).map((c) => c.id))
}

/** the sale value by VAT rate, as the till and the VAT book count it */
function VatSummary({ rows }: { rows: Row[] }) {
  const by = new Map<number, { net: number; vat: number; gross: number }>()
  for (const r of rows) {
    const k = num(r.vat_rate); const a = by.get(k) ?? { net: 0, vat: 0, gross: 0 }
    a.net += num(r.value_sale_net); a.vat += num(r.vat_in_sale); a.gross += num(r.value_sale_gross); by.set(k, a)
  }
  const list = [...by.entries()].sort((a, b) => b[0] - a[0])
  return (
    <Card className="mt-3 max-w-xl p-0">
      <Table>
        <TableHeader><TableRow><TableHead>{t('VAT rate')}</TableHead><TableHead className="text-right">{t('Value without VAT')}</TableHead><TableHead className="text-right">{t('VAT')}</TableHead><TableHead className="text-right">{t('Value with VAT')}</TableHead></TableRow></TableHeader>
        <TableBody>{list.map(([k, a]) => (
          <TableRow key={k}><TableCell>{formatQty(k)}%</TableCell><TableCell className="text-right tabular">{formatMoney(a.net)}</TableCell><TableCell className="text-right tabular">{formatMoney(a.vat)}</TableCell><TableCell className="text-right tabular font-medium">{formatMoney(a.gross)}</TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </Card>
  )
}
