import { Hint } from '@/components/help'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronDown, ChevronUp, Columns3, FileSpreadsheet, PackagePlus, Percent, Save, ScanBarcode, Sparkles, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useGuard } from '@/components/guard'
import { useCompany } from '@/app/company-provider'
import { useTableColumns } from '@/components/layout/nav-prefs'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { PackQty, packsFromPieces } from '@/components/pack-qty'
import { PageHeader } from '@/components/page-header'
import { ImportLinesDialog, type ImportedLine } from '../components/import-lines'
import { PRICE_KEY, PriceRiseCard } from '../components/price-rise'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { t, td, tn, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { findOffline, searchOffline, useScanCatalog, itemOffline } from '@/lib/offline/catalog'
import { packForScan, usePacks } from '@/lib/packs'
import { supabase } from '@/lib/supabase'
import { useRegistryRemote } from '@/lib/registry'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCurrencies, useWarehouses } from '@/features/inventory/api'
import { useBankAccounts } from '@/features/finance/api'
import { usePaymentTerms } from '@/features/sales/api'
import { useTaxCodes } from '@/features/tax/api'
import { DuplicateButton } from '@/components/duplicate-button'
import { useActiveVendors, useDeleteProcDocument, useProcDocument, useSaveProcDocument } from '../api'

type BillDoc = Tables<'vendor_bills'> & { lines: Tables<'vendor_bill_lines'>[] }
type Info = {
  avg_cost: number; sales_net: number; sales_tax: number; purchase_tax_code_id: string | null; tracking: string; track_expiry: boolean
  stockable: boolean; uom: string | null; stock: number; last: { price: number; discount: number; date: string; currency: string } | null
  /** the margin the item should keep (its own, else its category's) */
  target: number | null; target_from: 'item' | 'category' | null; category: string | null
}
type InfoAll = { basis: 'markup' | 'margin'; step: number; down: boolean; items: Record<string, Info> }
type Row = {
  key: string; variant_id: string; sku: string; name: string
  qty: string; price: string; d1: string; d2: string; tax: string | null
  /** new selling price with VAT, as typed ('' = keep the current one) */
  gross: string; lot: string; expiry: string
  /** counted in boxes: the pack and how many */
  pack?: string | null; pq?: number | null
  /** the margin while it is being typed in its box */
  m?: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number, d = 2) => formatMoney(n, undefined, d)
/** the due date from the invoice date and the payment terms */
const dueFrom = (date: string, days?: number | null) => {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + (days ?? 0)); return d.toISOString().slice(0, 10)
}
/** the selling price (with VAT) that gives a margin on a cost: on cost (markup) or on price, rounded up to the shop's step */
const priceFor = (cost: number, pct: number, basis: string, tax: number, step: number) => {
  const net = basis === 'margin' ? cost / Math.max(1 - pct / 100, 0.0001) : cost * (1 + pct / 100)
  const g = net * (1 + tax / 100)
  return step > 0 ? Math.ceil(Math.round(g / step * 1e6) / 1e6) * step : r2(g)
}
const marginOf = (net: number, cost: number, basis: string) => cost > 0 && net > 0 ? (basis === 'margin' ? (net - cost) / net * 100 : (net - cost) / cost * 100) : null
const newKey = () => Math.random().toString(36).slice(2)

/** the columns of the lines: a person may hide them (not the quantity and the price) and put them in any order */
const COLUMNS: { key: string; label: () => string; fixed?: boolean }[] = [
  { key: 'qty', label: () => t('Qty'), fixed: true }, { key: 'price', label: () => t('Purchase price (without VAT)'), fixed: true },
  { key: 'd1', label: () => t('Disc. %') }, { key: 'd2', label: () => t('Extra %') }, { key: 'cost', label: () => t('Cost (without VAT)') },
  { key: 'avg', label: () => t('Avg. cost now (without VAT)') }, { key: 'vat', label: () => t('VAT') }, { key: 'net', label: () => t('Without VAT') },
  { key: 'gross', label: () => t('With VAT') }, { key: 'cur', label: () => t('Selling price now (with VAT)') }, { key: 'rec', label: () => t('Recommended (with VAT)') },
  { key: 'new', label: () => t('New selling price (with VAT)') }, { key: 'margin', label: () => t('Margin %') },
]
/** the few that most invoices need */
const MAIN_ONLY = new Set(['d2', 'cost', 'avg', 'cur', 'rec'])
const DEFAULT_ORDER = ['qty', 'price', 'd1', 'd2', 'cost', 'avg', 'vat', 'net', 'gross', 'cur', 'rec', 'new', 'margin']
/** a saved order, with any column it does not know yet put back in its usual place */
const fullOrder = (saved: string[] | undefined) => {
  const o = (saved ?? []).filter((k) => DEFAULT_ORDER.includes(k))
  for (const k of DEFAULT_ORDER) if (!o.includes(k)) o.splice(Math.min(DEFAULT_ORDER.indexOf(k), o.length), 0, k)
  return o
}

function ColumnsMenu({ hidden, onChange, order, onOrder, onReset }: { hidden: Set<string>; onChange: (h: Set<string>) => void; order: string[]; onOrder: (o: string[]) => void; onReset: () => void }) {
  const label = (k: string) => COLUMNS.find((c) => c.key === k)?.label() ?? k
  const fixed = (k: string) => !!COLUMNS.find((c) => c.key === k)?.fixed
  const move = (i: number, d: number) => { const o = order.slice(); const [x] = o.splice(i, 1); o.splice(i + d, 0, x!); onOrder(o) }
  const optional = COLUMNS.filter((c) => !c.fixed).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline"><Columns3 /> {t('Columns')}{hidden.size > 0 && <span className="text-muted-foreground">({optional - hidden.size}/{optional})</span>}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">{t('What you see on the lines, and in which order. You can also drag a column by its name.')}</DropdownMenuLabel>
        {order.map((k, i) => (
          <div key={k} className="flex items-center gap-1 rounded-sm pr-1 hover:bg-accent">
            <label className={cn('flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px]', fixed(k) && 'cursor-default')}>
              <input type="checkbox" className="size-4" checked={!hidden.has(k)} disabled={fixed(k)}
                onChange={(e) => { const h = new Set(hidden); if (e.target.checked) h.delete(k); else h.add(k); onChange(h) }} />
              <span className="truncate">{label(k)}</span>
            </label>
            <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} aria-label={t('Move up')} onClick={() => move(i, -1)}><ChevronUp /></Button>
            <Button size="icon" variant="ghost" className="size-7" disabled={i === order.length - 1} aria-label={t('Move down')} onClick={() => move(i, 1)}><ChevronDown /></Button>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(new Set(MAIN_ONLY))}>{t('Only the main ones')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onReset()}>{t('Show all, in the usual order')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The supplier's invoice with the goods: received into a warehouse at cost, with the new selling prices, in one screen. */
export function PurchaseInvoicePage() {
  const { id } = useParams()
  const doc = useProcDocument<BillDoc>('bills', id)
  if (id && doc.isPending) return <Skeleton className="h-96" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (doc.data && (doc.data.status !== 'draft' || !doc.data.warehouse_id)) return <Navigate to={`/procurement/bills/${doc.data.id}`} replace />
  return <InvoiceForm key={doc.data?.id ?? 'new'} doc={doc.data} />
}

function InvoiceForm({ doc }: { doc?: BillDoc }) {
  const navigate = useNavigate()
  const { company, companyId, can } = useCompany()
  const base = company?.base_currency ?? 'EUR'
  const vendors = useActiveVendors()
  const warehouses = useWarehouses()
  const currencies = useCurrencies()
  const terms = usePaymentTerms()
  const taxes = useTaxCodes()
  const banks = useBankAccounts()
  const catalog = useScanCatalog()
  const save = useSaveProcDocument('bills')
  const del = useDeleteProcDocument('bills')
  const qc = useQueryClient()

  const [h, setH] = React.useState(() => ({
    vendor_id: doc?.vendor_id ?? '', vendor_invoice_number: doc?.vendor_invoice_number ?? '', vendor_fiscal_number: doc?.vendor_fiscal_number ?? '',
    bill_date: doc?.bill_date ?? todayISO(), receive_date: doc?.receive_date ?? '', due_date: doc?.due_date ?? '',
    payment_term_id: doc?.payment_term_id ?? '', currency_code: doc?.currency_code ?? base, exchange_rate: doc?.exchange_rate ? String(doc.exchange_rate) : '',
    warehouse_id: doc?.warehouse_id ?? '', pay_bank_account_id: doc?.pay_bank_account_id ?? '', notes: doc?.notes ?? '',
  }))
  const set = <K extends keyof typeof h>(k: K, v: (typeof h)[K]) => setH((x) => ({ ...x, [k]: v }))
  const [rows, setRows] = React.useState<Row[]>(() => [...(doc?.lines ?? [])].sort((a, b) => a.line_no - b.line_no).filter((l) => l.variant_id).map((l) => {
    const it = companyId ? itemOffline(companyId, l.variant_id!) : null
    return {
      key: l.id, variant_id: l.variant_id!, sku: it?.sku ?? '', name: l.description, qty: String(l.quantity), price: String(l.unit_price),
      d1: l.discount1_pct != null ? String(num(l.discount1_pct)) : num(l.discount_pct) ? String(num(l.discount_pct)) : '', d2: l.discount2_pct ? String(num(l.discount2_pct)) : '',
      tax: l.tax_code_id, gross: '', lot: l.lot_number ?? '', expiry: l.expiry_date ?? '', pack: l.pack_id, pq: l.pack_qty,
      // the stored new price is net; it becomes gross once the item's VAT is known (below)
      ...(l.sales_price_new != null ? { gross: `net:${l.sales_price_new}` } : {}),
    }
  }))
  const [code, setCode] = React.useState('')
  const packs = usePacks()
  const [margin, setMargin] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  // how this person arranged the columns, on their profile (every computer shows the same)
  const tableCols = useTableColumns('purchase_invoice')
  const colOrder = React.useMemo(() => fullOrder(tableCols.cols?.order), [tableCols.cols])
  const hiddenCols = React.useMemo(() => new Set((tableCols.cols?.hidden ?? []).filter((k) => !COLUMNS.find((c) => c.key === k)?.fixed)), [tableCols.cols])
  const setHiddenCols = (h: Set<string>) => tableCols.set({ order: colOrder, hidden: [...h] })
  const setColOrder = (o: string[]) => tableCols.set({ order: o, hidden: [...hiddenCols] })
  /** a column dropped on another takes its place */
  const moveCol = (from: string, to: string) => {
    if (!from || from === to || !colOrder.includes(from)) return
    const o = colOrder.filter((k) => k !== from); o.splice(o.indexOf(to) + (colOrder.indexOf(from) < colOrder.indexOf(to) ? 1 : 0), 0, from); setColOrder(o)
  }
  const shownCols = colOrder.filter((k) => !hiddenCols.has(k))
  const codeRef = React.useRef<HTMLInputElement>(null)
  const qtyRefs = React.useRef(new Map<string, HTMLInputElement>())

  // defaults from the first warehouse and the vendor
  React.useEffect(() => { if (!h.warehouse_id && warehouses.data?.length) set('warehouse_id', warehouses.data.find((w) => w.is_active)?.id ?? '') }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const registry = useRegistryRemote('vendor', (id) => set('vendor_id', id))
  const vendor = vendors.data?.find((v) => v.id === h.vendor_id)
  React.useEffect(() => {
    if (!vendor || doc) return
    setH((x) => ({ ...x, currency_code: vendor.currency_code ?? x.currency_code, payment_term_id: vendor.payment_term_id ?? x.payment_term_id }))
  }, [vendor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const itemOptions = React.useMemo(() => (companyId && catalog.ready ? searchOffline(companyId, '', 1_000_000) : [])
    .map((i) => ({ value: i.variant_id, label: i.name, hint: i.sku, keywords: i.barcodes.map(([b]) => b) })), [companyId, catalog.ready, catalog.count]) // eslint-disable-line react-hooks/exhaustive-deps
  const ids = rows.map((r) => r.variant_id)
  const info = useQuery({
    queryKey: ['purchase-item-info', companyId, h.vendor_id, h.warehouse_id, [...new Set(ids)].sort().join(',')],
    enabled: !!companyId && ids.length > 0, placeholderData: (p) => p, staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('purchase_item_info', { p_company: companyId!, p_vendor: (h.vendor_id || null) as unknown as string,
      p_variants: [...new Set(ids)], p_warehouse: h.warehouse_id || undefined })) as unknown as InfoAll,
  })
  const items = info.data?.items
  const basis = info.data?.basis ?? 'markup'
  const step = num(info.data?.step)
  const inf = (v: string) => items?.[v]
  // stored net prices → gross, once the VAT of the item is known
  React.useEffect(() => {
    if (!items) return
    setRows((rs) => rs.some((r) => r.gross.startsWith('net:')) ? rs.map((r) => r.gross.startsWith('net:') && items[r.variant_id]
      ? { ...r, gross: String(r2(num(r.gross.slice(4)) * (1 + items[r.variant_id].sales_tax / 100))) } : r) : rs)
    // the purchase VAT of items added before their info arrived
    setRows((rs) => rs.some((r) => !r.tax && items[r.variant_id]?.purchase_tax_code_id) ? rs.map((r) => !r.tax ? { ...r, tax: items[r.variant_id]?.purchase_tax_code_id ?? null } : r) : rs)
  }, [items])

  const taxRate = (id: string | null) => num(taxes.data?.find((x) => x.id === id)?.rate)
  const rate = h.currency_code === base ? 1 : num(h.exchange_rate) || 1

  const calc = rows.map((r) => {
    const qty = num(r.qty); const price = num(r.price)
    const disc = 100 - (100 - num(r.d1)) * (100 - num(r.d2)) / 100
    const unit = price * (1 - disc / 100)                 // cost per unit, invoice currency
    const net = r2(qty * unit)
    const vat = r2(net * taxRate(r.tax) / 100)
    const i = inf(r.variant_id)
    const costBase = unit * rate
    const curGross = i ? r2(i.sales_net * (1 + i.sales_tax / 100)) : null
    const newGross = r.gross !== '' && !r.gross.startsWith('net:') ? num(r.gross) : null
    const saleNet = i ? (newGross ?? curGross ?? 0) / (1 + i.sales_tax / 100) : 0
    const markup = i ? marginOf(saleNet, costBase, basis) : null
    // the recommendation: the item's (or its category's) target margin, else the margin it has now, on the new cost
    let rec: { gross: number; pct: number | null; from: 'item' | 'category' | 'keep' | 'current' } | null = null
    if (i && costBase > 0) {
      const nowPct = marginOf(i.sales_net, num(i.avg_cost), basis)
      if (i.target != null) rec = { gross: priceFor(costBase, num(i.target), basis, i.sales_tax, step), pct: num(i.target), from: i.target_from ?? 'item' }
      else if (nowPct != null && nowPct > 0) rec = { gross: priceFor(costBase, nowPct, basis, i.sales_tax, step), pct: nowPct, from: 'keep' }
      // the price now already keeps the margin: no need to go down (unless the company wants it)
      if (rec && curGross != null && rec.gross < curGross && !info.data?.down) rec = { gross: curGross, pct: marginOf(i.sales_net, costBase, basis), from: 'current' }
    }
    return { r, qty, price, disc, unit, net, vat, gross: r2(qty * price), i, costBase, curGross, newGross, saleNet, markup, rec }
  })
  const tot = calc.reduce((s, c) => ({ gross: s.gross + c.gross, net: s.net + c.net, vat: s.vat + c.vat, sale: s.sale + c.saleNet * c.qty, cost: s.cost + c.costBase * c.qty }),
    { gross: 0, net: 0, vat: 0, sale: 0, cost: 0 })

  const addItem = (variantId: string, perScan = 1) => {
    const it = companyId ? itemOffline(companyId, variantId) : null
    if (!it) return
    const pack = packForScan(packs.byVariant.get(variantId), perScan)
    const existing = rows.find((r) => r.variant_id === variantId && !r.lot && (r.pack ?? null) === (pack?.id ?? r.pack ?? null))
    if (existing) {
      setRows((rs) => rs.map((r) => {
        if (r.key !== existing.key) return r
        const qty = num(r.qty) + (perScan || 1)
        return { ...r, qty: String(qty), pq: r.pack ? packsFromPieces(packs.byId.get(r.pack), qty) : null }
      }))
      setTimeout(() => qtyRefs.current.get(existing.key)?.select(), 0)
      return
    }
    const key = newKey()
    setRows((rs) => [...rs, { key, variant_id: it.variant_id, sku: it.sku, name: it.name, qty: String(pack ? pack.factor : 1), price: it.cost ? String(it.cost) : '', d1: '', d2: '', tax: null, gross: '', lot: '', expiry: '',
      pack: pack?.id ?? null, pq: pack ? 1 : null }])
    setTimeout(() => qtyRefs.current.get(key)?.select(), 30)
  }
  // one box: a scan or a code with Enter adds the item; a name shows the items that fit, to pick
  const [pick, setPick] = React.useState(0)
  const [listOpen, setListOpen] = React.useState(false)
  const dq = React.useDeferredValue(code)
  const fits = React.useMemo(() => {
    const q = dq.trim()
    if (!companyId || !catalog.ready || !q || (/^\d+$/.test(q) && q.length >= 8)) return []
    return searchOffline(companyId, q, 8)
  }, [companyId, catalog.ready, catalog.count, dq]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => setPick(0), [dq])
  const take = (variantId: string, perScan = 1) => { addItem(variantId, perScan); setCode(''); setListOpen(false) }
  const onCode = () => {
    const c = code.trim(); if (!c || !companyId) return
    const hit = findOffline(companyId, c)
    if (hit?.kind === 'variant') return take(hit.item.variant_id, num(hit.qty) || 1)
    // what is in the list now (the deferred list may still be one letter behind)
    const now = dq.trim() === c ? fits : searchOffline(companyId, c, 8)
    const chosen = now[Math.min(pick, now.length - 1)]
    if (chosen && (now.length === 1 || listOpen)) return take(chosen.variant_id)
    if (now.length > 1) { setListOpen(true); return }
    toast.error(t('No item with the code {code}', { code: c }))
  }
  const onCodeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onCode() }
    else if (e.key === 'ArrowDown' && fits.length) { e.preventDefault(); setListOpen(true); setPick((i) => Math.min(i + 1, fits.length - 1)) }
    else if (e.key === 'ArrowUp' && fits.length) { e.preventDefault(); setPick((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Escape') setListOpen(false)
  }

  // the lines of the supplier's file, each as its own row (the same item may come twice at two prices)
  const addImported = (ls: ImportedLine[]) => {
    const taxFor = (rate: number | null) => rate == null ? null
      : (taxes.data ?? []).filter((x) => x.is_active !== false && !x.is_reverse_charge && x.scope !== 'sales' && Math.abs(num(x.rate) - rate) < 0.001)
          .sort((a, b) => Number(a.is_exempt) - Number(b.is_exempt) || a.code.length - b.code.length)[0]?.id ?? null
    setRows((rs) => [...rs, ...ls.map((l): Row => ({ key: newKey(), variant_id: l.variant_id, sku: l.sku, name: l.name, qty: String(l.qty), price: String(l.price),
      d1: l.discount ? String(l.discount) : '', d2: '', tax: taxFor(l.vat_rate), gross: '', lot: '', expiry: '', pack: null, pq: null }))])
  }
  const upd = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => r.key === key ? { ...r, ...patch } : r))
  // keyboard: Enter goes to the next box of the row; at the end of the row back to the code box
  const next = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const row = (e.target as HTMLElement).closest('tr')
    const boxes = Array.from(row?.querySelectorAll<HTMLInputElement>('input[data-nav]') ?? []).filter((b) => b.offsetParent !== null)
    const i = boxes.indexOf(e.target as HTMLInputElement)
    if (i >= 0 && i < boxes.length - 1) boxes[i + 1].select(); else codeRef.current?.focus()
  }
  const applyMargin = () => {
    const m = num(margin)
    setRows((rs) => rs.map((r) => {
      const c = calc.find((x) => x.r.key === r.key); if (!c?.i || c.costBase <= 0) return r
      return { ...r, m: null, gross: String(priceFor(c.costBase, m, basis, c.i.sales_tax, step)) }
    }))
  }
  const applyAdvice = () => setRows((rs) => rs.map((r) => {
    const c = calc.find((x) => x.r.key === r.key)
    return c?.rec && c.rec.from !== 'current' ? { ...r, m: null, gross: String(c.rec.gross) } : r
  }))
  const advised = calc.filter((c) => c.rec && c.rec.from !== 'current' && (c.newGross == null || Math.abs(c.newGross - c.rec.gross) > 0.004)).length

  const payload = () => ({
    header: {
      ...(doc ? { id: doc.id } : {}), document_type: 'vendor_bill', vendor_id: h.vendor_id, vendor_invoice_number: h.vendor_invoice_number.trim(),
      vendor_fiscal_number: h.vendor_fiscal_number.trim() || null, bill_date: h.bill_date, receive_date: h.receive_date || null, due_date: h.due_date || dueFrom(h.bill_date, terms.data?.find((x) => x.id === h.payment_term_id)?.due_days),
      payment_term_id: h.payment_term_id || null, currency_code: h.currency_code, ...(h.currency_code !== base && h.exchange_rate ? { exchange_rate: num(h.exchange_rate) } : {}),
      warehouse_id: h.warehouse_id, pay_bank_account_id: h.pay_bank_account_id || null, notes: h.notes || null,
    },
    lines: calc.map((c, n) => ({
      line_no: n + 1, variant_id: c.r.variant_id, description: c.r.name, quantity: c.qty, unit_price: c.price,
      discount1_pct: num(c.r.d1), discount2_pct: num(c.r.d2), tax_code_id: c.r.tax,
      sales_price_new: c.newGross != null && c.i ? Math.round(c.newGross / (1 + c.i.sales_tax / 100) * 10000) / 10000 : null,
      lot_number: c.r.lot.trim() || null, expiry_date: c.r.expiry || null,
      pack_id: c.r.pack ?? null, pack_qty: c.r.pack ? c.r.pq ?? null : null,
    })),
  })
  const problem = !h.vendor_id ? t('Choose the supplier') : !h.vendor_invoice_number.trim() ? t('Write the supplier’s invoice number')
    : !h.warehouse_id ? t('Choose the warehouse') : !rows.length ? t('Add at least one item')
    : calc.some((c) => c.qty <= 0) ? t('Every line needs a quantity') : null

  const saveDraft = async () => {
    try {
      const id = await save.mutateAsync(payload())
      toast.success(t('Draft saved'))
      if (!doc) navigate(`/procurement/invoice/${id}`, { replace: true })
    } catch { /* the error is shown by the save */ }
  }
  const guard = useGuard()
  const complete = useMutation({
    mutationFn: async () => {
      const id = await save.mutateAsync(payload())
      // the guard: what looks unusual against earlier invoices, before anything is posted
      if (!(await guard.check('vendor_bill', id))) return { id, r: null }
      return { id, r: unwrap(await supabase.rpc('purchase_invoice_complete', { p_bill: id })) as unknown as { number: string; receipt: string | null; prices_changed: number; payment_status: string | null } }
    },
    onSuccess: async ({ id, r }) => {
      if (!r) { setConfirm(false); if (!doc) navigate(`/procurement/invoice/${id}`, { replace: true }); return }
      await qc.invalidateQueries({ queryKey: ['proc'] })
      toast.success(t('Invoice {number} posted', { number: r.number }) + (r.receipt ? ` · ${t('goods in with {receipt}', { receipt: r.receipt })}` : '')
        + (r.prices_changed ? ` · ${tn(r.prices_changed, '{n} price changed', '{n} prices changed')}` : ''))
      navigate(`/procurement/bills/${id}`)
    },
    onError: (e) => { setConfirm(false); toast.error(tServer(describeError(e))); if (doc) void qc.invalidateQueries({ queryKey: [PRICE_KEY, doc.id] }) },
  })
  const editable = can('invoicing.write')
  const changing = calc.filter((c) => c.newGross != null && c.curGross != null && Math.abs(c.newGross - c.curGross) > 0.004).length
  const payBank = banks.data?.find((b) => b.id === h.pay_bank_account_id)

  const heads: Record<string, React.ReactNode> = {
    qty: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'qty'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'qty') }} className="w-20 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Qty')}</th>,
    price: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'price'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'price') }} className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Purchase price (without VAT)')}</th>,
    d1: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'd1'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'd1') }} data-col="d1" className="w-16 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Disc. %')}</th>,
    d2: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'd2'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'd2') }} data-col="d2" className="w-16 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Extra %')}</th>,
    cost: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'cost'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'cost') }} data-col="cost" className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Cost (without VAT)')}</th>,
    avg: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'avg'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'avg') }} data-col="avg" className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Avg. cost now (without VAT)')}</th>,
    vat: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'vat'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'vat') }} data-col="vat" className="w-24 px-2 py-2 font-medium cursor-grab select-none">{t('VAT')}</th>,
    net: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'net'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'net') }} data-col="net" className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Without VAT')}</th>,
    gross: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'gross'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'gross') }} data-col="gross" className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('With VAT')}</th>,
    cur: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'cur'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'cur') }} data-col="cur" className="w-24 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Selling price now (with VAT)')}</th>,
    rec: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'rec'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'rec') }} data-col="rec" className="w-28 px-2 py-2 text-right font-medium cursor-grab select-none">{t('Recommended (with VAT)')}</th>,
    new: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'new'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'new') }} data-col="new" className="w-28 px-2 py-2 text-right font-medium cursor-grab select-none">{t('New selling price (with VAT)')}</th>,
    margin: <th draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'margin'); e.dataTransfer.effectAllowed = 'move' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); moveCol(e.dataTransfer.getData('text/plain'), 'margin') }} data-col="margin" className="w-20 px-2 py-2 text-right font-medium cursor-grab select-none" title={basis === 'margin' ? t('Margin on the selling price') : t('Margin on the cost')}>{t('Margin %')}</th>,
  }
  return (
    <div className="pb-24">
      <PageHeader back={{ href: '/procurement/bills', label: t('Vendor bills') }} title={doc ? `${t('Purchase invoice')} ${doc.number}` : t('New purchase invoice')}
        description={t('The supplier’s invoice with the goods: they come into the warehouse at their cost, and you set the selling prices here.')}
        actions={editable && <>
          {doc && <ConfirmDialog trigger={<Button variant="ghost"><Trash2 /> {t('Delete')}</Button>} title={t('Delete this draft?')} description={t('Nothing was received or posted yet.')}
            destructive confirmLabel={t('Delete')} onConfirm={async () => { await del.mutateAsync(doc.id); navigate('/procurement/bills') }} />}
          {doc && <DuplicateButton table="vendor_bills" id={doc.id} />}
          <Button variant="outline" loading={save.isPending && !complete.isPending} disabled={!h.vendor_id || !h.vendor_invoice_number.trim()} onClick={() => void saveDraft()}><Save /> {t('Save draft')}</Button>
          <Button disabled={!!problem} title={problem ?? undefined} onClick={() => setConfirm(true)}><CheckCheck /> {t('Complete')}</Button>
        </>} />
      {/* why the main button is not active yet, in words, not only on hover */}
      {editable && problem && <p className="-mt-2 mb-3 text-right text-xs text-muted-foreground">{t('To complete: {what}', { what: problem.toLowerCase() })}</p>}
      {doc && <PriceRiseCard billId={doc.id} version={doc.updated_at} currency={base} />}

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Supplier')}</Label>
            <SearchSelect value={h.vendor_id || null} onChange={(v) => set('vendor_id', v ?? '')} placeholder={t('Choose the supplier')} remote={registry}
              options={(vendors.data ?? []).filter((v) => v.is_active || v.id === h.vendor_id).map((v) => ({ value: v.id, label: v.name, hint: [v.code, v.tax_number].filter(Boolean).join(' · ') }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-no">{t('Supplier’s invoice no.')}</Label><Input id="pi-no" value={h.vendor_invoice_number} onChange={(e) => set('vendor_invoice_number', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-fiscal">{t('Fiscal number')}</Label><Input id="pi-fiscal" value={h.vendor_fiscal_number} onChange={(e) => set('vendor_fiscal_number', e.target.value)} placeholder={t('From the supplier’s fiscal invoice')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-date">{t('Invoice date')}</Label><Input id="pi-date" type="date" value={h.bill_date} onChange={(e) => set('bill_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-recv">{t('Received on')}</Label><Input id="pi-recv" type="date" value={h.receive_date} placeholder={h.bill_date} onChange={(e) => set('receive_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Into the warehouse')}</Label>
            <Select value={h.warehouse_id} onValueChange={(v) => set('warehouse_id', v)}><SelectTrigger aria-label={t('Into the warehouse')}><SelectValue placeholder={t('Choose the warehouse')} /></SelectTrigger>
              <SelectContent>{(warehouses.data ?? []).filter((w) => w.is_active).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div className="grid gap-1.5"><Label>{t('Currency')}</Label>
              <Select value={h.currency_code} onValueChange={(v) => set('currency_code', v)}><SelectTrigger aria-label={t('Currency')}><SelectValue /></SelectTrigger>
                <SelectContent>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="pi-rate">{t('Exchange rate')}<Hint id="exchange_rate" /></Label><Input id="pi-rate" inputMode="decimal" disabled={h.currency_code === base} value={h.currency_code === base ? '1' : h.exchange_rate}
              placeholder={t('of the day')} onChange={(e) => set('exchange_rate', e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('Payment terms')}<Hint id="payment_terms" /></Label>
            <Select value={h.payment_term_id || 'none'} onValueChange={(v) => set('payment_term_id', v === 'none' ? '' : v)}><SelectTrigger aria-label={t('Payment terms')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{t('Immediately')}</SelectItem>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-due">{t('Due date')}<Hint id="due_date" /></Label><Input id="pi-due" type="date" value={h.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Payment')}</Label>
            <Select value={h.pay_bank_account_id || 'later'} onValueChange={(v) => set('pay_bank_account_id', v === 'later' ? '' : v)}><SelectTrigger aria-label={t('Payment')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="later">{t('Not paid yet')}</SelectItem>
                {(banks.data ?? []).filter((b) => b.is_active && b.currency_code === h.currency_code).map((b) => <SelectItem key={b.id} value={b.id}>{t('Paid now from {name}', { name: td(b.name) })}</SelectItem>)}
              </SelectContent></Select></div>
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4"><Label htmlFor="pi-notes">{t('Notes')}</Label><Textarea id="pi-notes" rows={1} value={h.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full max-w-xl">
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={codeRef} value={code} onChange={(e) => { setCode(e.target.value); setListOpen(true) }} onKeyDown={onCodeKey}
              onFocus={() => setListOpen(true)} onBlur={() => window.setTimeout(() => setListOpen(false), 150)}
              className="pl-8" placeholder={catalog.ready ? t('Scan the barcode, or type the code or the name') : t('Loading the items…')} aria-label={t('Barcode, code or name')}
              role="combobox" aria-expanded={listOpen && fits.length > 0} aria-controls="pi-fits" aria-autocomplete="list" disabled={!editable} />
            {listOpen && fits.length > 0 && (
              <ul id="pi-fits" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-[13px] shadow-md">
                {fits.map((it, i) => (
                  <li key={it.variant_id} role="option" aria-selected={i === pick}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5', i === pick && 'bg-accent')}
                    onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); take(it.variant_id) }}>
                    <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{[it.sku, it.barcodes[0]?.[0]].filter(Boolean).join(' · ')}</span>
                    {it.cost > 0 && <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">{fmt(it.cost, 2)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {editable && <Button variant="outline" onClick={() => setImporting(true)} disabled={!catalog.ready} title={t('Paste the lines from Excel, or choose the supplier’s file')}>
            <FileSpreadsheet /> {t('From Excel')}</Button>}
          <ColumnsMenu hidden={hiddenCols} onChange={setHiddenCols} order={colOrder} onOrder={setColOrder} onReset={() => tableCols.set(null)} />
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Label htmlFor="pi-margin" className="whitespace-nowrap text-[13px] text-muted-foreground">{t('Margin for all')}<Hint id="margin_all" /></Label>
            <Input id="pi-margin" inputMode="decimal" className="h-8 w-20 text-right" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="25" />
            <Button size="sm" variant="outline" disabled={!margin || !rows.length} onClick={applyMargin}><Percent /> {t('Set prices')}</Button>
            <Button size="sm" disabled={!advised} onClick={applyAdvice}><Sparkles /> {t('Take the recommendations')}{advised > 0 && ` (${advised})`}</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table id="pi-lines" className="w-full text-[13px]" style={{ minWidth: 300 + shownCols.length * 80 }}>
            <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t('Item')}</th>
                {shownCols.map((k) => <React.Fragment key={k}>{heads[k]}</React.Fragment>)}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {calc.length === 0 && (
                <tr><td colSpan={shownCols.length + 3} className="px-3 py-10 text-center text-muted-foreground">
                  <PackagePlus className="mx-auto mb-2 size-6" />{t('Scan or type the first item above.')}</td></tr>
              )}
              {calc.map((c, n) => {
                const tracked = c.i && c.i.tracking !== 'none'
                const lastChanged = c.i?.last && c.price > 0 && Math.abs(num(c.i.last.price) - c.price) > 0.0001
                const cells: Record<string, React.ReactNode> = {
                      qty: <td className="px-1 py-1"><Input data-nav ref={(el) => { if (el) qtyRefs.current.set(c.r.key, el); else qtyRefs.current.delete(c.r.key) }} inputMode="decimal"
                      className="h-8 min-w-[64px] text-right tabular-nums" value={c.r.qty} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Quantity')}
                      onChange={(e) => upd(c.r.key, { qty: e.target.value, ...(c.r.pack ? { pq: packsFromPieces(packs.byId.get(c.r.pack), e.target.value) } : {}) })} />
                      <PackQty packs={packs.byVariant.get(c.r.variant_id)} packId={c.r.pack} packQty={c.r.pq} quantity={c.r.qty} uom={c.i?.uom} line={n + 1}
                        onChange={(v) => upd(c.r.key, { pack: v.pack_id, pq: v.pack_qty, ...(v.quantity ? { qty: String(v.quantity) } : {}) })} /></td>,
                      price: <td className="px-1 py-1"><Input data-nav inputMode="decimal" className={cn('h-8 min-w-[88px] text-right tabular-nums', lastChanged && 'border-amber-500')} value={c.r.price}
                      title={lastChanged ? t('Last time {price}', { price: fmt(num(c.i!.last!.price), 4) }) : undefined}
                      onChange={(e) => upd(c.r.key, { price: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Purchase price (without VAT)')} /></td>,
                      d1: <td data-col="d1" className="px-1 py-1"><Input data-nav inputMode="decimal" className="h-8 min-w-[56px] text-right tabular-nums" value={c.r.d1} placeholder="0" onChange={(e) => upd(c.r.key, { d1: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Disc. %')} /></td>,
                      d2: <td data-col="d2" className="px-1 py-1"><Input data-nav inputMode="decimal" className="h-8 min-w-[56px] text-right tabular-nums" value={c.r.d2} placeholder="0" onChange={(e) => upd(c.r.key, { d2: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Extra %')} /></td>,
                      cost: <td data-col="cost" className="px-2 py-2 text-right tabular-nums">{fmt(c.unit, 4)}</td>,
                      avg: <td data-col="avg" className={cn('px-2 py-2 text-right tabular-nums text-muted-foreground', c.i && c.i.avg_cost > 0 && c.costBase > c.i.avg_cost * 1.05 && 'text-amber-700 dark:text-amber-400')}>{c.i ? fmt(num(c.i.avg_cost), 4) : '…'}</td>,
                      vat: <td data-col="vat" className="px-1 py-1">
                      <Select value={c.r.tax ?? ''} onValueChange={(v) => upd(c.r.key, { tax: v })}>
                        <SelectTrigger className="h-8 min-w-[110px]" aria-label={t('VAT')}><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>{(taxes.data ?? []).filter((x) => x.is_active !== false).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>,
                      net: <td data-col="net" className="px-2 py-2 text-right tabular-nums">{fmt(c.net)}</td>,
                      gross: <td data-col="gross" className="px-2 py-2 text-right tabular-nums">{fmt(c.net + c.vat)}</td>,
                      cur: <td data-col="cur" className="px-2 py-2 text-right tabular-nums text-muted-foreground">{c.curGross == null ? '…' : fmt(c.curGross)}</td>,
                      rec: <td data-col="rec" className="px-1 py-1 text-right">
                      {c.rec ? (
                        <button type="button" className="w-full rounded-md px-1.5 py-1 text-right hover:bg-muted disabled:hover:bg-transparent" disabled={c.rec.from === 'current'}
                          title={c.rec.from === 'current' ? t('The price now already keeps the margin') : t('Click to use this price')}
                          onClick={() => upd(c.r.key, { gross: String(c.rec!.gross), m: null })}>
                          <span className={cn('block tabular-nums', c.rec.from !== 'current' && 'font-medium text-primary')}>{fmt(c.rec.gross)}</span>
                          <span className="block text-[10.5px] leading-tight text-muted-foreground">
                            {c.rec.from === 'item' ? t('item target {pct}%', { pct: fmt(num(c.rec.pct), 0) })
                              : c.rec.from === 'category' ? t('{category} {pct}%', { category: c.i?.category ?? '', pct: fmt(num(c.rec.pct), 0) })
                              : c.rec.from === 'keep' ? t('same margin {pct}%', { pct: fmt(num(c.rec.pct), 1) })
                              : t('keep the price')}
                          </span>
                        </button>
                      ) : <span className="px-1.5 text-muted-foreground">{c.i ? '—' : '…'}</span>}
                    </td>,
                      new: <td data-col="new" className="px-1 py-1"><Input data-nav inputMode="decimal" className={cn('h-8 min-w-[88px] text-right tabular-nums', c.newGross != null && 'border-primary font-medium')} value={c.r.gross.startsWith('net:') ? '' : c.r.gross}
                      placeholder={c.curGross == null ? '' : fmt(c.curGross)} onChange={(e) => upd(c.r.key, { gross: e.target.value, m: null })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('New selling price (with VAT)')} /></td>,
                      margin: <td data-col="margin" className="px-1 py-1">
                      <Input data-nav inputMode="decimal" aria-label={t('Margin %')} disabled={!c.i || c.costBase <= 0}
                        className={cn('h-8 min-w-[64px] text-right tabular-nums', c.markup != null && c.markup < 0 ? 'font-medium text-destructive' : c.markup != null && c.markup < 5 ? 'text-amber-700 dark:text-amber-400' : '')}
                        value={c.r.m ?? (c.markup == null ? '' : fmt(c.markup))}
                        onChange={(e) => upd(c.r.key, { m: e.target.value, ...(c.i && c.costBase > 0 && e.target.value.trim() !== '' && e.target.value.trim() !== '-'
                          ? { gross: String(priceFor(c.costBase, num(e.target.value.replace(',', '.')), basis, c.i.sales_tax, step)) } : {}) })}
                        onBlur={() => upd(c.r.key, { m: null })} onKeyDown={next} onFocus={(e) => e.target.select()} />
                    </td>,
                }
                return (
                  <tr key={c.r.key} className="border-t align-top">
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{n + 1}</td>
                    <td className="min-w-[190px] px-2 py-1.5">
                      <p className="font-medium leading-tight">{c.r.name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.r.sku}{c.i?.uom ? ` · ${c.i.uom}` : ''}{c.i ? ` · ${t('{n} in stock', { n: formatQty(c.i.stock) })}` : ''}
                        {c.i?.last && <> · {t('last {price}', { price: fmt(num(c.i.last.price), 4) })}</>}</p>
                      {tracked && (
                        <div className="mt-1 flex gap-1.5">
                          <Input data-nav className="h-7 w-28 text-[12px]" placeholder={t('Lot')} value={c.r.lot} onChange={(e) => upd(c.r.key, { lot: e.target.value })} onKeyDown={next} aria-label={t('Lot')} />
                          {c.i?.track_expiry && <Input className="h-7 w-36 text-[12px]" type="date" value={c.r.expiry} onChange={(e) => upd(c.r.key, { expiry: e.target.value })} aria-label={t('Expiry date')} />}
                        </div>
                      )}
                    </td>
                    {shownCols.map((k) => <React.Fragment key={k}>{cells[k]}</React.Fragment>)}
                    <td className="px-1 py-1"><Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => setRows((rs) => rs.filter((r) => r.key !== c.r.key))}><Trash2 /></Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 border-t p-4 md:grid-cols-2">
          <dl className="grid content-start gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Selling value without VAT')}</dt><dd className="tabular-nums">{formatMoney(tot.sale, base)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Cost of the goods (without VAT)')}</dt><dd className="tabular-nums">{formatMoney(tot.cost, base)}</dd></div>
            <div className="flex justify-between font-medium"><dt>{t('Difference (margin, without VAT)')}</dt>
              <dd className={cn('tabular-nums', tot.sale - tot.cost < 0 && 'text-destructive')}>{formatMoney(tot.sale - tot.cost, base)}{tot.cost > 0 && tot.sale > 0 && ` · ${fmt(marginOf(tot.sale, tot.cost, basis) ?? 0)} %`}</dd></div>
          </dl>
          <dl className="grid content-start gap-1 text-sm md:ml-auto md:w-80">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Before discount (without VAT)')}</dt><dd className="tabular-nums">{fmt(tot.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Discounts')}</dt><dd className="tabular-nums">{Math.abs(tot.gross - tot.net) < 0.005 ? fmt(0) : `−${fmt(tot.gross - tot.net)}`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Amount without VAT')}</dt><dd className="tabular-nums">{fmt(tot.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="tabular-nums">{fmt(tot.vat)}</dd></div>
            <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>{t('Total (with VAT)')}</dt><dd className="tabular-nums">{formatMoney(tot.net + tot.vat, h.currency_code)}</dd></div>
          </dl>
        </div>
      </Card>

      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('Complete the purchase invoice')}</DialogTitle>
              <DialogDescription>{t('This cannot be undone here; a mistake is corrected with a credit note or a return to the supplier.')}</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-1.5 text-sm">
              <li>· {t('{n} items come into {warehouse}', { n: rows.length, warehouse: td(warehouses.data?.find((w) => w.id === h.warehouse_id)?.name ?? '') })}</li>
              <li>· {t('The invoice of {amount} with VAT is posted to {vendor}', { amount: formatMoney(tot.net + tot.vat, h.currency_code), vendor: vendor?.name ?? '' })}</li>
              {changing > 0 && <li>· {tn(changing, '{n} selling price changes', '{n} selling prices change')}</li>}
              {payBank && <li>· {t('Paid now from {name}', { name: td(payBank.name) })}</li>}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
              <Button loading={complete.isPending} onClick={() => complete.mutate()}><CheckCheck /> {t('Complete')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">{t('Transport, customs and other costs are added afterwards with')} <Link className="underline" to="/inventory/landed-costs">{t('Landed costs')}</Link>.</p>
      {guard.dialog}
      <ImportLinesDialog open={importing} onOpenChange={setImporting} vendorId={h.vendor_id || null} itemOptions={itemOptions} onAdd={addImported}
        onHeader={(x) => setH((v) => ({ ...v, vendor_invoice_number: v.vendor_invoice_number || x.number || '', bill_date: !doc && x.date ? x.date : v.bill_date,
          vendor_id: v.vendor_id || x.vendor_id || '' }))} />
    </div>
  )
}
