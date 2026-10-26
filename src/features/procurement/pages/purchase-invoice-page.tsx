import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, PackagePlus, Percent, Save, ScanBarcode, Sparkles, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCurrencies, useWarehouses } from '@/features/inventory/api'
import { useBankAccounts } from '@/features/finance/api'
import { usePaymentTerms } from '@/features/sales/api'
import { useTaxCodes } from '@/features/tax/api'
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
  /** the margin while it is being typed in its box */
  m?: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
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
      tax: l.tax_code_id, gross: '', lot: l.lot_number ?? '', expiry: l.expiry_date ?? '',
      // the stored new price is net; it becomes gross once the item's VAT is known (below)
      ...(l.sales_price_new != null ? { gross: `net:${l.sales_price_new}` } : {}),
    }
  }))
  const [code, setCode] = React.useState('')
  const [margin, setMargin] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const codeRef = React.useRef<HTMLInputElement>(null)
  const qtyRefs = React.useRef(new Map<string, HTMLInputElement>())

  // defaults from the first warehouse and the vendor
  React.useEffect(() => { if (!h.warehouse_id && warehouses.data?.length) set('warehouse_id', warehouses.data.find((w) => w.is_active)?.id ?? '') }, [warehouses.data]) // eslint-disable-line react-hooks/exhaustive-deps
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
    return { r, qty, price, disc, unit, net, vat, gross: qty * price, i, costBase, curGross, newGross, saleNet, markup, rec }
  })
  const tot = calc.reduce((s, c) => ({ gross: s.gross + c.gross, net: s.net + c.net, vat: s.vat + c.vat, sale: s.sale + c.saleNet * c.qty, cost: s.cost + c.costBase * c.qty }),
    { gross: 0, net: 0, vat: 0, sale: 0, cost: 0 })

  const addItem = (variantId: string) => {
    const it = companyId ? itemOffline(companyId, variantId) : null
    if (!it) return
    const existing = rows.find((r) => r.variant_id === variantId && !r.lot)
    if (existing) {
      setRows((rs) => rs.map((r) => r.key === existing.key ? { ...r, qty: String(num(r.qty) + 1) } : r))
      setTimeout(() => qtyRefs.current.get(existing.key)?.select(), 0)
      return
    }
    const key = newKey()
    setRows((rs) => [...rs, { key, variant_id: it.variant_id, sku: it.sku, name: it.name, qty: '1', price: it.cost ? String(it.cost) : '', d1: '', d2: '', tax: null, gross: '', lot: '', expiry: '' }])
    setTimeout(() => qtyRefs.current.get(key)?.select(), 30)
  }
  const onCode = () => {
    const c = code.trim(); if (!c || !companyId) return
    const hit = findOffline(companyId, c)
    if (hit?.kind === 'variant') { addItem(hit.item.variant_id); setCode('') }
    else {
      const found = searchOffline(companyId, c, 2)
      if (found.length === 1) { addItem(found[0].variant_id); setCode('') } else toast.error(t('No item with the code {code}', { code: c }))
    }
  }
  const upd = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => r.key === key ? { ...r, ...patch } : r))
  // keyboard: Enter goes to the next box of the row; at the end of the row back to the code box
  const next = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const row = (e.target as HTMLElement).closest('tr')
    const boxes = Array.from(row?.querySelectorAll<HTMLInputElement>('input[data-nav]') ?? [])
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
  const complete = useMutation({
    mutationFn: async () => {
      const id = await save.mutateAsync(payload())
      return { id, r: unwrap(await supabase.rpc('purchase_invoice_complete', { p_bill: id })) as unknown as { number: string; receipt: string | null; prices_changed: number; payment_status: string | null } }
    },
    onSuccess: async ({ id, r }) => {
      await qc.invalidateQueries({ queryKey: ['proc'] })
      toast.success(t('Invoice {number} posted', { number: r.number }) + (r.receipt ? ` · ${t('goods in with {receipt}', { receipt: r.receipt })}` : '')
        + (r.prices_changed ? ` · ${tn(r.prices_changed, '{n} price changed', '{n} prices changed')}` : ''))
      navigate(`/procurement/bills/${id}`)
    },
    onError: (e) => { setConfirm(false); toast.error(tServer(describeError(e))) },
  })
  const editable = can('invoicing.write')
  const changing = calc.filter((c) => c.newGross != null && c.curGross != null && Math.abs(c.newGross - c.curGross) > 0.004).length
  const payBank = banks.data?.find((b) => b.id === h.pay_bank_account_id)

  return (
    <div className="pb-24">
      <PageHeader back={{ href: '/procurement/bills', label: t('Vendor bills') }} title={doc ? `${t('Purchase invoice')} ${doc.number}` : t('New purchase invoice')}
        description={t('The supplier’s invoice with the goods: they come into the warehouse at their cost, and you set the selling prices here.')}
        actions={editable && <>
          {doc && <ConfirmDialog trigger={<Button variant="ghost"><Trash2 /> {t('Delete')}</Button>} title={t('Delete this draft?')} description={t('Nothing was received or posted yet.')}
            destructive confirmLabel={t('Delete')} onConfirm={async () => { await del.mutateAsync(doc.id); navigate('/procurement/bills') }} />}
          <Button variant="outline" loading={save.isPending && !complete.isPending} disabled={!h.vendor_id || !h.vendor_invoice_number.trim()} onClick={() => void saveDraft()}><Save /> {t('Save draft')}</Button>
          <Button disabled={!!problem} title={problem ?? undefined} onClick={() => setConfirm(true)}><CheckCheck /> {t('Complete')}</Button>
        </>} />

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Supplier')}</Label>
            <SearchSelect value={h.vendor_id || null} onChange={(v) => set('vendor_id', v ?? '')} placeholder={t('Choose the supplier')}
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
            <div className="grid gap-1.5"><Label htmlFor="pi-rate">{t('Rate')}</Label><Input id="pi-rate" inputMode="decimal" disabled={h.currency_code === base} value={h.currency_code === base ? '1' : h.exchange_rate}
              placeholder={t('of the day')} onChange={(e) => set('exchange_rate', e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('Payment terms')}</Label>
            <Select value={h.payment_term_id || 'none'} onValueChange={(v) => set('payment_term_id', v === 'none' ? '' : v)}><SelectTrigger aria-label={t('Payment terms')}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">{t('Immediately')}</SelectItem>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="pi-due">{t('Due date')}</Label><Input id="pi-due" type="date" value={h.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{t('Payment')}</Label>
            <Select value={h.pay_bank_account_id || 'later'} onValueChange={(v) => set('pay_bank_account_id', v === 'later' ? '' : v)}><SelectTrigger aria-label={t('Payment')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="later">{t('Later (on credit)')}</SelectItem>
                {(banks.data ?? []).filter((b) => b.is_active && b.currency_code === h.currency_code).map((b) => <SelectItem key={b.id} value={b.id}>{t('Paid now from {name}', { name: td(b.name) })}</SelectItem>)}
              </SelectContent></Select></div>
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4"><Label htmlFor="pi-notes">{t('Notes')}</Label><Textarea id="pi-notes" rows={1} value={h.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full max-w-md">
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCode() } }}
              className="pl-8" placeholder={catalog.ready ? t('Scan the barcode or type the code, then Enter') : t('Loading the items…')} aria-label={t('Barcode or code')} disabled={!editable} />
          </div>
          <div className="w-72"><SearchSelect value={null} onChange={(v) => v && addItem(v)} placeholder={t('…or search by name')}
            options={itemOptions} /></div>
          <div className="ml-auto flex items-center gap-1.5">
            <Label htmlFor="pi-margin" className="whitespace-nowrap text-[13px] text-muted-foreground">{t('Margin for all')}</Label>
            <Input id="pi-margin" inputMode="decimal" className="h-8 w-20 text-right" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="25" />
            <Button size="sm" variant="outline" disabled={!margin || !rows.length} onClick={applyMargin}><Percent /> {t('Set prices')}</Button>
            <Button size="sm" disabled={!advised} onClick={applyAdvice}><Sparkles /> {t('Take the recommendations')}{advised > 0 && ` (${advised})`}</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1340px] text-[13px]">
            <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t('Item')}</th>
                <th className="w-20 px-2 py-2 text-right font-medium">{t('Qty')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Purchase price')}</th>
                <th className="w-16 px-2 py-2 text-right font-medium">{t('Disc. %')}</th>
                <th className="w-16 px-2 py-2 text-right font-medium">{t('Extra %')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Cost')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Avg. cost now')}</th>
                <th className="w-24 px-2 py-2 font-medium">{t('VAT')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Without VAT')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('With VAT')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Selling price now')}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t('Recommended')}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t('New selling price')}</th>
                <th className="w-20 px-2 py-2 text-right font-medium" title={basis === 'margin' ? t('Margin on the selling price') : t('Margin on the cost')}>{t('Margin %')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {calc.length === 0 && (
                <tr><td colSpan={16} className="px-3 py-10 text-center text-muted-foreground">
                  <PackagePlus className="mx-auto mb-2 size-6" />{t('Scan or type the first item above.')}</td></tr>
              )}
              {calc.map((c, n) => {
                const tracked = c.i && c.i.tracking !== 'none'
                const lastChanged = c.i?.last && c.price > 0 && Math.abs(num(c.i.last.price) - c.price) > 0.0001
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
                    <td className="px-1 py-1"><Input data-nav ref={(el) => { if (el) qtyRefs.current.set(c.r.key, el); else qtyRefs.current.delete(c.r.key) }} inputMode="decimal"
                      className="h-8 min-w-[64px] text-right tabular-nums" value={c.r.qty} onChange={(e) => upd(c.r.key, { qty: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Quantity')} /></td>
                    <td className="px-1 py-1"><Input data-nav inputMode="decimal" className={cn('h-8 min-w-[88px] text-right tabular-nums', lastChanged && 'border-amber-500')} value={c.r.price}
                      title={lastChanged ? t('Last time {price}', { price: fmt(num(c.i!.last!.price), 4) }) : undefined}
                      onChange={(e) => upd(c.r.key, { price: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Purchase price')} /></td>
                    <td className="px-1 py-1"><Input data-nav inputMode="decimal" className="h-8 min-w-[56px] text-right tabular-nums" value={c.r.d1} placeholder="0" onChange={(e) => upd(c.r.key, { d1: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Disc. %')} /></td>
                    <td className="px-1 py-1"><Input data-nav inputMode="decimal" className="h-8 min-w-[56px] text-right tabular-nums" value={c.r.d2} placeholder="0" onChange={(e) => upd(c.r.key, { d2: e.target.value })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('Extra %')} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(c.unit, 4)}</td>
                    <td className={cn('px-2 py-2 text-right tabular-nums text-muted-foreground', c.i && c.i.avg_cost > 0 && c.costBase > c.i.avg_cost * 1.05 && 'text-amber-700 dark:text-amber-400')}>{c.i ? fmt(num(c.i.avg_cost), 4) : '…'}</td>
                    <td className="px-1 py-1">
                      <Select value={c.r.tax ?? ''} onValueChange={(v) => upd(c.r.key, { tax: v })}>
                        <SelectTrigger className="h-8 min-w-[110px]" aria-label={t('VAT')}><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>{(taxes.data ?? []).filter((x) => x.is_active !== false).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(c.net)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(c.net + c.vat)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{c.curGross == null ? '…' : fmt(c.curGross)}</td>
                    <td className="px-1 py-1 text-right">
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
                    </td>
                    <td className="px-1 py-1"><Input data-nav inputMode="decimal" className={cn('h-8 min-w-[88px] text-right tabular-nums', c.newGross != null && 'border-primary font-medium')} value={c.r.gross.startsWith('net:') ? '' : c.r.gross}
                      placeholder={c.curGross == null ? '' : fmt(c.curGross)} onChange={(e) => upd(c.r.key, { gross: e.target.value, m: null })} onKeyDown={next} onFocus={(e) => e.target.select()} aria-label={t('New selling price')} /></td>
                    <td className="px-1 py-1">
                      <Input data-nav inputMode="decimal" aria-label={t('Margin %')} disabled={!c.i || c.costBase <= 0}
                        className={cn('h-8 min-w-[64px] text-right tabular-nums', c.markup != null && c.markup < 0 ? 'font-medium text-destructive' : c.markup != null && c.markup < 5 ? 'text-amber-700 dark:text-amber-400' : '')}
                        value={c.r.m ?? (c.markup == null ? '' : fmt(c.markup))}
                        onChange={(e) => upd(c.r.key, { m: e.target.value, ...(c.i && c.costBase > 0 && e.target.value.trim() !== '' && e.target.value.trim() !== '-'
                          ? { gross: String(priceFor(c.costBase, num(e.target.value.replace(',', '.')), basis, c.i.sales_tax, step)) } : {}) })}
                        onBlur={() => upd(c.r.key, { m: null })} onKeyDown={next} onFocus={(e) => e.target.select()} />
                    </td>
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
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Cost of the goods')}</dt><dd className="tabular-nums">{formatMoney(tot.cost, base)}</dd></div>
            <div className="flex justify-between font-medium"><dt>{t('Difference (margin)')}</dt>
              <dd className={cn('tabular-nums', tot.sale - tot.cost < 0 && 'text-destructive')}>{formatMoney(tot.sale - tot.cost, base)}{tot.cost > 0 && tot.sale > 0 && ` · ${fmt(marginOf(tot.sale, tot.cost, basis) ?? 0)} %`}</dd></div>
          </dl>
          <dl className="grid content-start gap-1 text-sm md:ml-auto md:w-80">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Invoice gross')}</dt><dd className="tabular-nums">{fmt(tot.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Discounts')}</dt><dd className="tabular-nums">−{fmt(tot.gross - tot.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Without VAT')}</dt><dd className="tabular-nums">{fmt(tot.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="tabular-nums">{fmt(tot.vat)}</dd></div>
            <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>{t('Total')}</dt><dd className="tabular-nums">{formatMoney(tot.net + tot.vat, h.currency_code)}</dd></div>
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
              <li>· {t('The invoice of {amount} is posted to {vendor}', { amount: formatMoney(tot.net + tot.vat, h.currency_code), vendor: vendor?.name ?? '' })}</li>
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
    </div>
  )
}
