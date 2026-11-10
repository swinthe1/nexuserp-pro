import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronDown, Play, RotateCcw, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveUnit } from '@/app/active-unit'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { Pick, Range, SavedFilters } from '../components/saved-filters'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useCategories, useWarehouses } from '@/features/inventory/api'
import { useActiveVendors } from '@/features/procurement/api'
import { useCustomers, useMembers, useSellableVariants } from '@/features/sales/api'

type Kind = 'purchases' | 'sales'
type Row = Record<string, unknown>
type ColType = 'text' | 'date' | 'money' | 'price' | 'qty' | 'pct' | 'rate' | 'count' | 'type' | 'status' | 'bool'
type Col = { id: string; label: string; type: ColType; hidden?: boolean; strong?: boolean }

/** what the person asks for; kept in the address, so going back after a click returns to the report before */
type Filters = {
  report: string; period: string; from: string; to: string
  units: string[]; partners: string[]; partner_tags: string[]; items: string[]; categories: string[]; brands: string[]
  doc_types: string[]; vat_book: string; vat_rates: string[]; payment: string[]; people: string[]
  min_total: string; max_total: string; min_qty: string; max_qty: string
  currency: string; landed_basis: string; source: string; till_mode: string
}

const REPORTS: Record<Kind, { value: string; label: string }[]> = {
  purchases: [
    { value: 'by_item', label: msg('By item') },
    { value: 'detailed', label: msg('By document') },
    { value: 'by_vendor', label: msg('By supplier') },
    { value: 'lines', label: msg('Line by line') },
    { value: 'lines_landed', label: msg('Line by line, with import costs') },
  ],
  sales: [
    { value: 'by_item', label: msg('By item, with margin') },
    { value: 'detailed', label: msg('By document') },
    { value: 'by_customer', label: msg('By customer') },
    { value: 'lines', label: msg('Line by line') },
    { value: 'by_unit', label: msg('By unit') },
    { value: 'by_person', label: msg('By salesperson or cashier') },
    { value: 'by_category', label: msg('By group') },
    { value: 'by_day', label: msg('By day') },
    { value: 'by_hour', label: msg('By hour of the day') },
  ],
}

const PERIODS = [
  { value: 'today', label: msg('Today') }, { value: 'yesterday', label: msg('Yesterday') }, { value: 'this_week', label: msg('This week') },
  { value: 'last_week', label: msg('Last week') }, { value: 'this_month', label: msg('This month') }, { value: 'last_month', label: msg('Last month') },
  { value: 'this_quarter', label: msg('This quarter') }, { value: 'this_year', label: msg('This year') }, { value: 'last_year', label: msg('Last year') },
  { value: 'custom', label: msg('Other dates') },
]

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** the dates of a quick period, counted from today */
export function periodDates(period: string, today = new Date()): { from: string; to: string } | null {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate()
  const dow = (today.getDay() + 6) % 7   // Monday first
  switch (period) {
    case 'today': return { from: iso(today), to: iso(today) }
    case 'yesterday': { const x = new Date(y, m, d - 1); return { from: iso(x), to: iso(x) } }
    case 'this_week': return { from: iso(new Date(y, m, d - dow)), to: iso(today) }
    case 'last_week': return { from: iso(new Date(y, m, d - dow - 7)), to: iso(new Date(y, m, d - dow - 1)) }
    case 'this_month': return { from: iso(new Date(y, m, 1)), to: iso(today) }
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
    case 'this_quarter': return { from: iso(new Date(y, m - (m % 3), 1)), to: iso(today) }
    case 'this_year': return { from: iso(new Date(y, 0, 1)), to: iso(today) }
    case 'last_year': return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) }
    default: return null
  }
}

const blank = (unit: string | null): Filters => ({
  report: 'by_item', period: 'this_month', ...periodDates('this_month')!,
  units: unit ? [unit] : [], partners: [], partner_tags: [], items: [], categories: [], brands: [],
  doc_types: [], vat_book: 'all', vat_rates: [], payment: [], people: [],
  min_total: '', max_total: '', min_qty: '', max_qty: '',
  currency: 'base', landed_basis: 'recorded', source: 'all', till_mode: 'lines',
})

const DOC_TYPES: Record<Kind, { value: string; label: string }[]> = {
  purchases: [{ value: 'bill', label: msg('Purchase invoice') }, { value: 'credit', label: msg('Credit note') }, { value: 'debit', label: msg('Debit note') }, { value: 'import', label: msg('Import') }],
  sales: [{ value: 'invoice', label: msg('Invoice') }, { value: 'credit', label: msg('Credit note') }, { value: 'debit', label: msg('Debit note') }, { value: 'till', label: msg('Till receipt') }, { value: 'till_refund', label: msg('Till refund') }],
}
const PAYMENTS = [{ value: 'paid', label: msg('Paid') }, { value: 'partial', label: msg('Partly paid') }, { value: 'unpaid', label: msg('Unpaid') }, { value: 'overdue', label: msg('Overdue') }]
const RATES = ['18', '8', '0']

/** the columns of each report: English labels, translated when drawn */
function columnsOf(kind: Kind, report: string): Col[] {
  if (kind === 'purchases') {
    if (report === 'by_item') return [
      { id: 'code', label: msg('Code'), type: 'text' }, { id: 'item', label: msg('Item'), type: 'text', strong: true }, { id: 'category', label: msg('Group'), type: 'text' },
      { id: 'uom', label: msg('Unit|measure'), type: 'text', hidden: true }, { id: 'qty', label: msg('Quantity'), type: 'qty' },
      { id: 'avg_price', label: msg('Average price'), type: 'price' }, { id: 'min_price', label: msg('Lowest price'), type: 'price', hidden: true }, { id: 'max_price', label: msg('Highest price'), type: 'price', hidden: true },
      { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat', label: msg('VAT'), type: 'money' }, { id: 'gross', label: msg('Value with VAT'), type: 'money' },
      { id: 'documents', label: msg('Documents'), type: 'count', hidden: true }, { id: 'vendors', label: msg('Suppliers'), type: 'count', hidden: true },
      { id: 'last_date', label: msg('Last bought'), type: 'date' }, { id: 'last_vendor', label: msg('Last supplier'), type: 'text' },
    ]
    if (report === 'by_vendor') return [
      { id: 'vendor', label: msg('Supplier'), type: 'text', strong: true }, { id: 'tax_number', label: msg('Tax number'), type: 'text' }, { id: 'documents', label: msg('Documents'), type: 'count' },
      { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat', label: msg('VAT'), type: 'money' }, { id: 'gross', label: msg('Value with VAT'), type: 'money' },
      { id: 'paid', label: msg('Paid'), type: 'money' }, { id: 'due', label: msg('Left to pay'), type: 'money' }, { id: 'share', label: msg('Share'), type: 'pct' }, { id: 'last_date', label: msg('Last bought'), type: 'date' },
    ]
    if (report === 'detailed') return [
      { id: 'date', label: msg('Date'), type: 'date' }, { id: 'number', label: msg('Number'), type: 'text', strong: true }, { id: 'vendor_invoice', label: msg('Supplier invoice no.'), type: 'text' },
      { id: 'vendor', label: msg('Supplier'), type: 'text' }, { id: 'tax_number', label: msg('Tax number'), type: 'text', hidden: true }, { id: 'unit', label: msg('Unit|store'), type: 'text' },
      { id: 'type', label: msg('Type'), type: 'type' }, { id: 'in_vat_book', label: msg('In the VAT book'), type: 'bool', hidden: true }, { id: 'lines', label: msg('Lines'), type: 'count', hidden: true },
      { id: 'discount', label: msg('Discounts'), type: 'money', hidden: true }, { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat', label: msg('VAT'), type: 'money' },
      { id: 'gross', label: msg('Value with VAT'), type: 'money' }, { id: 'paid', label: msg('Paid'), type: 'money' }, { id: 'due', label: msg('Left to pay'), type: 'money' },
      { id: 'due_date', label: msg('Due'), type: 'date', hidden: true }, { id: 'payment_status', label: msg('Payment'), type: 'status' }, { id: 'currency', label: msg('Currency'), type: 'text', hidden: true },
    ]
    return [
      { id: 'date', label: msg('Date'), type: 'date' }, { id: 'number', label: msg('Number'), type: 'text' }, { id: 'vendor_invoice', label: msg('Supplier invoice no.'), type: 'text', hidden: true },
      { id: 'vendor', label: msg('Supplier'), type: 'text' }, { id: 'unit', label: msg('Unit|store'), type: 'text', hidden: true }, { id: 'type', label: msg('Type'), type: 'type', hidden: true },
      { id: 'code', label: msg('Code'), type: 'text' }, { id: 'item', label: msg('Item'), type: 'text', strong: true }, { id: 'category', label: msg('Group'), type: 'text', hidden: true },
      { id: 'brand', label: msg('Brand'), type: 'text', hidden: true }, { id: 'uom', label: msg('Unit|measure'), type: 'text', hidden: true }, { id: 'qty', label: msg('Quantity'), type: 'qty' },
      { id: 'price_list', label: msg('Price'), type: 'price' }, { id: 'discount1', label: msg('Discount 1'), type: 'rate' }, { id: 'discount2', label: msg('Discount 2'), type: 'rate' },
      { id: 'discount', label: msg('Discount'), type: 'rate', hidden: true }, { id: 'price_net', label: msg('Price after discount'), type: 'price' },
      { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat_rate', label: msg('VAT rate'), type: 'rate', hidden: true }, { id: 'vat', label: msg('VAT'), type: 'money' },
      { id: 'gross', label: msg('Value with VAT'), type: 'money' },
      ...(report === 'lines_landed' ? [
        { id: 'landed', label: msg('Import costs'), type: 'money' }, { id: 'landed_unit', label: msg('Import costs a piece'), type: 'price' },
        { id: 'cost_unit', label: msg('Cost a piece'), type: 'price', strong: true }, { id: 'cost_total', label: msg('Cost in all'), type: 'money', strong: true },
      ] as Col[] : []),
    ]
  }
  // sales
  if (report === 'detailed') return [
    { id: 'date', label: msg('Date'), type: 'date' }, { id: 'number', label: msg('Number'), type: 'text', strong: true }, { id: 'type', label: msg('Type'), type: 'type' },
    { id: 'customer', label: msg('Customer'), type: 'text' }, { id: 'tax_number', label: msg('Tax number'), type: 'text', hidden: true }, { id: 'unit', label: msg('Unit|store'), type: 'text' },
    { id: 'person', label: msg('Salesperson or cashier'), type: 'text' }, { id: 'lines', label: msg('Lines'), type: 'count', hidden: true },
    { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat', label: msg('VAT'), type: 'money' }, { id: 'gross', label: msg('Value with VAT'), type: 'money' },
    { id: 'cost', label: msg('Cost'), type: 'money', hidden: true }, { id: 'margin', label: msg('Margin'), type: 'money' }, { id: 'margin_pct', label: msg('Margin %'), type: 'pct' },
    { id: 'paid', label: msg('Paid'), type: 'money', hidden: true }, { id: 'due', label: msg('Left to pay'), type: 'money' }, { id: 'due_date', label: msg('Due'), type: 'date', hidden: true },
    { id: 'payment_status', label: msg('Payment'), type: 'status' }, { id: 'fiscal', label: msg('Fiscal'), type: 'text', hidden: true },
  ]
  if (report === 'lines') return [
    { id: 'date', label: msg('Date'), type: 'date' }, { id: 'number', label: msg('Number'), type: 'text' }, { id: 'type', label: msg('Type'), type: 'type', hidden: true },
    { id: 'customer', label: msg('Customer'), type: 'text' }, { id: 'unit', label: msg('Unit|store'), type: 'text', hidden: true }, { id: 'person', label: msg('Salesperson or cashier'), type: 'text', hidden: true },
    { id: 'code', label: msg('Code'), type: 'text' }, { id: 'item', label: msg('Item'), type: 'text', strong: true }, { id: 'category', label: msg('Group'), type: 'text', hidden: true },
    { id: 'brand', label: msg('Brand'), type: 'text', hidden: true }, { id: 'uom', label: msg('Unit|measure'), type: 'text', hidden: true }, { id: 'qty', label: msg('Quantity'), type: 'qty' },
    { id: 'price_list', label: msg('Price'), type: 'price' }, { id: 'discount', label: msg('Discount'), type: 'rate' }, { id: 'price_net', label: msg('Price after discount'), type: 'price' },
    { id: 'net', label: msg('Value without VAT'), type: 'money', strong: true }, { id: 'vat_rate', label: msg('VAT rate'), type: 'rate', hidden: true }, { id: 'vat', label: msg('VAT'), type: 'money' },
    { id: 'gross', label: msg('Value with VAT'), type: 'money' }, { id: 'cost', label: msg('Cost'), type: 'money', hidden: true }, { id: 'margin', label: msg('Margin'), type: 'money' },
    { id: 'margin_pct', label: msg('Margin %'), type: 'pct' },
  ]
  const head = ({ by_item: msg('Item'), by_customer: msg('Customer'), by_unit: msg('Unit|store'), by_person: msg('Salesperson or cashier'), by_category: msg('Group'), by_day: msg('Day'), by_hour: msg('Hour') } as Record<string, string>)[report] ?? msg('Name')
  return [
    ...(report === 'by_item' ? [{ id: 'code', label: msg('Code'), type: 'text' }] as Col[] : []),
    { id: 'label', label: head, type: report === 'by_day' ? 'date' : 'text', strong: true },
    ...(report === 'by_item' ? [{ id: 'category', label: msg('Group'), type: 'text' }, { id: 'uom', label: msg('Unit|measure'), type: 'text', hidden: true },
      { id: 'qty', label: msg('Quantity sold'), type: 'qty' }, { id: 'avg_price', label: msg('Average selling price, without VAT'), type: 'price' }] as Col[] : []),
    ...(report === 'by_customer' ? [{ id: 'tax_number', label: msg('Tax number'), type: 'text' }] as Col[] : []),
    // the money of each row, in the order it is worked out: sold − cost of the goods = profit; profit ÷ sold = margin
    { id: 'documents', label: msg('Receipts and invoices'), type: 'count', hidden: report === 'by_item' },
    { id: 'net', label: msg('Sales without VAT'), type: 'money', strong: true }, { id: 'vat', label: msg('VAT'), type: 'money', hidden: true },
    { id: 'gross', label: msg('Sales with VAT'), type: 'money', hidden: report === 'by_item' },
    { id: 'discount', label: msg('Discounts'), type: 'money', hidden: true }, { id: 'cost', label: msg('Cost of the goods sold'), type: 'money' },
    { id: 'margin', label: msg('Gross profit'), type: 'money', strong: true },
    { id: 'margin_pct', label: msg('Margin %'), type: 'pct' }, { id: 'share', label: msg('Share of all sales %'), type: 'pct' },
    { id: 'avg_document', label: msg('Average document'), type: 'money', hidden: report === 'by_item' },
  ]
}

const TYPE_LABEL: Record<string, string> = {
  bill: msg('Purchase invoice'), credit: msg('Credit note'), debit: msg('Debit note'), import: msg('Import'), invoice: msg('Invoice'), till: msg('Till receipt'),
  till_refund: msg('Till refund'), till_day: msg('Till, day total'),
}
const STATUS_LABEL: Record<string, string> = { paid: msg('Paid'), partial: msg('Partly paid'), unpaid: msg('Unpaid'), overdue: msg('Overdue') }
const summable = (c: Col) => c.type === 'money' || c.type === 'qty' || c.type === 'count'

function shown(c: Col, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  switch (c.type) {
    case 'date': return formatDate(String(v))
    case 'money': return formatMoney(num(v))
    case 'price': { const n = num(v); return formatMoney(n, undefined, Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? 4 : 2) }
    case 'qty': case 'count': return formatQty(num(v))
    case 'pct': case 'rate': return `${formatQty(num(v))}%`
    case 'type': return t(TYPE_LABEL[String(v)] ?? String(v))
    case 'status': return t(STATUS_LABEL[String(v)] ?? String(v))
    case 'bool': return v ? t('Yes') : t('No')
    default: return td(String(v))
  }
}

export const PurchasesDetailPage = () => <DetailPage kind="purchases" />
export const SalesDetailPage = () => <DetailPage kind="sales" />

/** "Blerjet e detajuara" and "Shitjet e detajuara": pick the report, set the filters, press Show. */
export function DetailPage({ kind }: { kind: Kind }) {
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied)

  const whs = useWarehouses()
  const vendors = useActiveVendors()
  const customers = useCustomers()
  const variants = useSellableVariants()
  const cats = useCategories()
  const members = useMembers()
  const extras = useQuery({
    queryKey: ['detail-options', companyId, kind], enabled: !!companyId && more, staleTime: 5 * 60_000,
    queryFn: async () => {
      const [b, p] = await Promise.all([
        supabase.from('products').select('brand').eq('company_id', companyId!).not('brand', 'is', null).is('deleted_at', null).limit(5000),
        supabase.from('business_partners').select('tags').eq('company_id', companyId!).is('deleted_at', null).not('tags', 'eq', '{}').limit(5000),
      ])
      const brands = [...new Set((b.data ?? []).map((r) => String(r.brand)).filter(Boolean))].sort()
      const tags = [...new Set((p.data ?? []).flatMap((r) => (r.tags as string[] | null) ?? []))].sort()
      return { brands, tags }
    },
  })

  const body = React.useMemo(() => {
    const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
    return {
      report: applied.report, from: applied.from, to: applied.to, units: applied.units, partners: applied.partners, partner_tags: applied.partner_tags,
      items: applied.items, categories: applied.categories, brands: applied.brands, doc_types: applied.doc_types, vat_book: applied.vat_book,
      vat_rates: applied.vat_rates.map(Number), payment: applied.payment, people: applied.people,
      min_total: n(applied.min_total), max_total: n(applied.max_total), min_qty: n(applied.min_qty), max_qty: n(applied.max_qty),
      currency: applied.currency, landed_basis: applied.landed_basis, source: applied.source, till_mode: applied.till_mode,
    }
  }, [applied])
  const q = useQuery({
    queryKey: ['detail-report', companyId, kind, body], enabled: !!companyId && !!applied.from && !!applied.to,
    queryFn: async () => unwrap(await supabase.rpc(kind === 'purchases' ? 'purchase_detail' : 'sales_detail', { p_company: companyId!, p: body as unknown as Json })) as unknown as
      { rows: Row[]; count: number; truncated: boolean; currency: string },
  })
  const cur = q.data?.currency ?? company?.base_currency ?? ''
  const cols = React.useMemo(() => columnsOf(kind, applied.report), [kind, applied.report])
  const reportLabel = t(REPORTS[kind].find((r) => r.value === applied.report)?.label ?? '')

  // the options of the pickers
  const unitOpts = (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))
  const partnerOpts = kind === 'purchases'
    ? (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))
    : (customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.tax_number ?? undefined }))
  const itemOpts = (variants.data ?? []).map((v) => ({ value: v.id, label: td(v.name), hint: v.sku }))
  const catOpts = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const peopleOpts = (members.data ?? []).map((m) => ({ value: m.id, label: m.full_name ?? m.email ?? '' }))

  // what was asked, in words: under the title, and on the export
  const said = React.useMemo(() => {
    const names = (ids: string[], opts: { value: string; label: string }[]) => ids.map((id) => opts.find((o) => o.value === id)?.label ?? '').filter(Boolean).join(', ')
    const parts = [reportLabel, `${formatDate(applied.from)} – ${formatDate(applied.to)}`]
    if (applied.units.length) parts.push(`${t('Units|stores')}: ${names(applied.units, unitOpts)}`)
    if (applied.partners.length) parts.push(`${kind === 'purchases' ? t('Suppliers') : t('Customers')}: ${names(applied.partners, partnerOpts)}`)
    if (applied.partner_tags.length) parts.push(`${t('Tags')}: ${applied.partner_tags.join(', ')}`)
    if (applied.items.length) parts.push(`${t('Items')}: ${names(applied.items, itemOpts)}`)
    if (applied.categories.length) parts.push(`${t('Groups')}: ${names(applied.categories, catOpts)}`)
    if (applied.brands.length) parts.push(`${t('Brands')}: ${applied.brands.join(', ')}`)
    if (applied.doc_types.length) parts.push(applied.doc_types.map((d) => t(TYPE_LABEL[d] ?? d)).join(', '))
    if (applied.vat_book !== 'all') parts.push(applied.vat_book === 'in' ? t('In the VAT book') : t('Outside the VAT book'))
    if (applied.vat_rates.length) parts.push(`${t('VAT')} ${applied.vat_rates.map((r) => `${r}%`).join(', ')}`)
    if (applied.payment.length) parts.push(applied.payment.map((p) => t(STATUS_LABEL[p] ?? p)).join(', '))
    if (applied.people.length) parts.push(names(applied.people, peopleOpts))
    if (applied.min_total || applied.max_total) parts.push(`${t('Document total')} ${applied.min_total || '…'} – ${applied.max_total || '…'}`)
    if (applied.min_qty || applied.max_qty) parts.push(`${t('Quantity')} ${applied.min_qty || '…'} – ${applied.max_qty || '…'}`)
    if (kind === 'sales' && applied.source !== 'all') parts.push(applied.source === 'till' ? t('Tills only') : t('Invoices only'))
    if (kind === 'sales' && applied.till_mode === 'daily') parts.push(t('Tills as one total a day'))
    if (applied.report === 'lines_landed' && applied.landed_basis !== 'recorded') parts.push(`${t('Import costs spread by')} ${t(BASIS.find((b) => b.value === applied.landed_basis)?.label ?? '')}`)
    if (applied.currency === 'doc') parts.push(t('In the currency of the document'))
    return parts.join(' · ')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, reportLabel, whs.data, vendors.data, customers.data, variants.data, cats.data, members.data])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => cols.map((c) => {
    const right = !['text', 'date', 'type', 'status', 'bool'].includes(c.type)
    return {
      id: c.id, accessorFn: (r: Row) => (right ? num(r[c.id]) : c.type === 'text' || c.type === 'type' ? String(r[c.id] ?? '') : r[c.id]),
      meta: { label: t(c.label), align: right ? 'right' : undefined, exportValue: (r: Row) => (right ? (r[c.id] == null ? null : num(r[c.id])) : shown(c, r[c.id])) },
      header: ({ column }) => <ColumnHeader column={column} title={t(c.label)} />,
      cell: ({ row }) => {
        const v = row.original[c.id]
        if (c.type === 'status' && v) return <Badge variant={v === 'paid' ? 'success' : v === 'overdue' ? 'destructive' : v === 'partial' ? 'warning' : 'secondary'}>{shown(c, v)}</Badge>
        if (c.type === 'type' && v) return <span className={cn(['credit', 'till_refund'].includes(String(v)) && 'text-destructive')}>{shown(c, v)}</span>
        if (c.id === 'label' && applied.report === 'by_hour') return <span className="font-medium">{String(v ?? '')}</span>
        const text = c.type === 'qty' && v != null && v !== '' ? formatQty(num(v), (row.original.uom as string | null) ?? undefined) : shown(c, v)
        return text === '' ? <span className="text-muted-foreground">—</span>
          : <span className={cn(c.strong && 'font-medium', right && num(v) < 0 && 'text-destructive', c.id === 'margin_pct' && num(v) < 0 && 'text-destructive')}>{text}</span>
      },
    } as ColumnDef<Row>
  }), [cols, applied.report])

  // a click goes one step down: a group to its documents, a document to the document itself
  const drill = (r: Row) => {
    const go = (f: Partial<Filters>) => apply({ ...applied, ...f })
    const rep = applied.report
    if (kind === 'purchases') {
      if (rep === 'by_item' && r.id) return go({ report: 'lines', items: [String(r.id)] })
      if (rep === 'by_vendor' && r.id) return go({ report: 'detailed', partners: [String(r.id)] })
      const id = rep === 'detailed' ? r.id : r.bill_id
      if (id) navigate(`/procurement/bills/${id}`)
      return
    }
    const key = r.key ? String(r.key) : null
    if (rep === 'by_item' && key && /^[0-9a-f-]{36}$/.test(key)) return go({ report: 'lines', items: [key] })
    if (rep === 'by_customer' && key && key !== '-') return go({ report: 'detailed', partners: [key] })
    if (rep === 'by_unit' && key && key !== '-') return go({ report: 'detailed', units: [key] })
    if (rep === 'by_person' && key && /^[0-9a-f-]{36}$/.test(key)) return go({ report: 'detailed', people: [key] })
    if (rep === 'by_category' && key) { const c = (cats.data ?? []).find((x) => x.name === key); if (c) return go({ report: 'by_item', categories: [c.id] }) }
    if (rep === 'by_day' && key) return go({ report: 'detailed', period: 'custom', from: key, to: key })
    if ((rep === 'detailed' || rep === 'lines') && r.source === 'invoice' && r.doc_id) navigate(`/sales/invoices/${r.doc_id}`)
  }

  const title = kind === 'purchases' ? t('Detailed purchases') : t('Detailed sales')
  return (
    <>
      <PageHeader back={{ href: '/reports', label: t('Reports') }} title={title}
        description={kind === 'purchases'
          ? t('Every purchase by item, document, supplier or line, with discounts and import costs. Values in {currency}; credit notes count as minus.', { currency: cur })
          : t('Invoices and tills together, by item, document, customer, unit, person, group, day or hour, with the margin. Values in {currency}; returns count as minus.', { currency: cur })}
        actions={<SavedFilters<Filters> storeKey={`reports.detail.${kind}.filters`} current={() => draft}
          prepare={(f) => (f.period === 'custom' ? f : { ...f, from: undefined, to: undefined })}
          restore={(c) => (c.period && c.period !== 'custom' ? { ...c, ...periodDates(c.period) } : c)}
          onApply={(f) => apply({ ...start, ...f })} />} />

      <div className="mb-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label className="text-xs">{t('Report')}</Label>
            <Select value={draft.report} onValueChange={(v) => put('report', v)}>
              <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{REPORTS[kind].map((r) => <SelectItem key={r.value} value={r.value}>{t(r.label)}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid gap-1"><Label className="text-xs">{t('Period')}</Label>
            <Select value={draft.period} onValueChange={(v) => setDraft((d) => ({ ...d, period: v, ...(periodDates(v) ?? {}) }))}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label>
            <Input type="date" className="h-9 w-40" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, period: 'custom', from: e.target.value || d.from }))} /></div>
          <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label>
            <Input type="date" className="h-9 w-40" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, period: 'custom', to: e.target.value || d.to }))} /></div>
          {multi && <MultiPick label={t('Units|stores')} value={draft.units} onChange={(v) => put('units', v)} options={unitOpts} />}
          <MultiPick label={kind === 'purchases' ? t('Suppliers') : t('Customers')} value={draft.partners} onChange={(v) => put('partners', v)} options={partnerOpts} />
          <Button variant={more ? 'secondary' : 'outline'} className="h-9" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <SlidersHorizontal /> {t('Advanced filters')}<ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="h-9" onClick={() => setDraft(start)}><RotateCcw /> {t('Clear')}</Button>
            <Button className="h-9" onClick={() => apply(draft)} disabled={!draft.from || !draft.to}><Play /> {t('Show')}</Button>
          </div>
        </div>

        {more && (
          <div className="mt-3 grid gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <MultiPick label={t('Items')} value={draft.items} onChange={(v) => put('items', v)} options={itemOpts} />
              <MultiPick label={t('Groups')} value={draft.categories} onChange={(v) => put('categories', v)} options={catOpts} />
              <MultiPick label={t('Brands')} value={draft.brands} onChange={(v) => put('brands', v)} options={(extras.data?.brands ?? []).map((b) => ({ value: b, label: b }))} />
              <MultiPick label={t('Partner tags')} value={draft.partner_tags} onChange={(v) => put('partner_tags', v)} options={(extras.data?.tags ?? []).map((b) => ({ value: b, label: b }))} />
              <MultiPick label={t('Document type')} value={draft.doc_types} onChange={(v) => put('doc_types', v)} options={DOC_TYPES[kind].map((d) => ({ value: d.value, label: t(d.label) }))} />
              <MultiPick label={t('VAT rate')} value={draft.vat_rates} onChange={(v) => put('vat_rates', v)} options={RATES.map((r) => ({ value: r, label: `${r}%` }))} />
              <MultiPick label={t('Payment')} value={draft.payment} onChange={(v) => put('payment', v)} options={PAYMENTS.map((p) => ({ value: p.value, label: t(p.label) }))} />
              <MultiPick label={kind === 'purchases' ? t('Entered by') : t('Salesperson or cashier')} value={draft.people} onChange={(v) => put('people', v)} options={peopleOpts} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Range label={t('Document total')} lo={draft.min_total} hi={draft.max_total} onLo={(v) => put('min_total', v)} onHi={(v) => put('max_total', v)} />
              <Range label={t('Quantity on the line')} lo={draft.min_qty} hi={draft.max_qty} onLo={(v) => put('min_qty', v)} onHi={(v) => put('max_qty', v)} />
              {kind === 'purchases' && <Pick label={t('VAT book')} value={draft.vat_book} onChange={(v) => put('vat_book', v)} width="w-52"
                options={[{ value: 'all', label: t('All') }, { value: 'in', label: t('In the VAT book') }, { value: 'out', label: t('Outside the VAT book') }]} />}
              {kind === 'purchases' && <Pick label={t('Import costs spread by')} value={draft.landed_basis} onChange={(v) => put('landed_basis', v)} width="w-56"
                options={BASIS.map((b) => ({ value: b.value, label: t(b.label) }))} disabled={draft.report !== 'lines_landed'} />}
              {kind === 'sales' && <Pick label={t('Source')} value={draft.source} onChange={(v) => put('source', v)} width="w-44"
                options={[{ value: 'all', label: t('Invoices and tills') }, { value: 'invoices', label: t('Invoices only') }, { value: 'till', label: t('Tills only') }]} />}
              {kind === 'sales' && <Pick label={t('Till receipts')} value={draft.till_mode} onChange={(v) => put('till_mode', v)} width="w-56"
                options={[{ value: 'lines', label: t('Each receipt') }, { value: 'daily', label: t('One total a day per till') }]} />}
              <Pick label={t('Currency')} value={draft.currency} onChange={(v) => put('currency', v)} width="w-52"
                options={[{ value: 'base', label: t('In {currency}', { currency: cur }) }, { value: 'doc', label: t('In the currency of the document') }]} />
            </div>
          </div>
        )}
        {dirty && <p className="mt-2 text-[12.5px] text-warning">{t('The filters changed. Press Show to see the report with them.')}</p>}
      </div>

      <p className="mb-2 text-[12.5px] text-muted-foreground">{said}</p>
      {kind === 'sales' && cols.some((c) => c.id === 'share') && (
        <p className="mb-2 text-[12.5px] text-muted-foreground">{t('Cost of the goods sold: what the goods sold cost to buy (average purchase price, without VAT). Gross profit = sales without VAT − that cost. Margin % = gross profit ÷ sales without VAT. Share = the part of all the sales of the period this row makes.')}</p>
      )}
      {q.data?.truncated && <p className="mb-2 text-[12.5px] text-warning">{t('Only the first {n} rows are shown. Narrow the dates or the filters to see all of them.', { n: q.data.count })}</p>}

      <DataTable
        key={`${kind}-${applied.report}`}
        tableKey={`reports.detail.${kind}.${applied.report}`}
        columns={columns}
        initialHidden={cols.filter((c) => c.hidden).map((c) => c.id)}
        data={q.data?.rows}
        isLoading={q.isLoading}
        error={q.error}
        searchPlaceholder={t('Search')}
        exportName={`${title} ${applied.from} ${applied.to}`}
        exportSubtitle={said}
        onRowClick={drill}
        empty={{ title: t('Nothing in this period'), description: t('Change the dates or the filters.') }}
        footer={(table) => {
          const rows = table.getFilteredRowModel().rows.map((r) => r.original)
          const sum = (id: string) => rows.reduce((s, r) => s + num(r[id]), 0)
          const net = sum('net'), margin = sum('margin')
          return (
            <TableFooter>
              <TableRow className="hover:bg-transparent font-semibold">
                <LeadCell />
                {table.getVisibleLeafColumns().map((c, i) => {
                  const def = cols.find((x) => x.id === c.id)
                  let v: React.ReactNode = ''
                  if (i === 0) v = t('Total')
                  else if (def && summable(def)) v = def.type === 'money' ? formatMoney(sum(c.id)) : formatQty(sum(c.id))
                  else if (c.id === 'margin_pct' && net) v = `${formatQty(Math.round((margin / net) * 1000) / 10)}%`
                  return <TableCell key={c.id} className={cn(i > 0 && 'text-right tabular')}>{v}</TableCell>
                })}
              </TableRow>
            </TableFooter>
          )
        }}
      />
    </>
  )
}

const BASIS = [
  { value: 'recorded', label: msg('As it was posted') }, { value: 'value', label: msg('Value') }, { value: 'quantity', label: msg('Quantity') },
  { value: 'weight', label: msg('Weight') }, { value: 'volume', label: msg('Volume') }, { value: 'equal', label: msg('Equal parts') },
]

