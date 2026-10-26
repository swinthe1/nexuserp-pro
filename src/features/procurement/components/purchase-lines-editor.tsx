import { Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PackQty, packsFromPieces, type PackChange } from '@/components/pack-qty'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td } from '@/i18n'
import { packForScan, usePacks } from '@/lib/packs'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, humanize, num } from '@/lib/utils'
import { useTaxCodes } from '@/features/inventory/api'
import { fetchPurchasePrice, usePurchasableVariants, type MatchLine, type PurchasePrice } from '../api'
import type { PurchaseLineValues } from '../schemas'

type LinesForm = { vendor_id: string; doc_date: string; currency_code: string; lines: PurchaseLineValues[] }
export interface PurchaseProgress { ordered: number; received: number; billed: number; isService: boolean }

export function lineAmounts(l: { quantity: unknown; unit_price: unknown; discount_pct: unknown }, rate: number) {
  const gross = Math.round(num(l.quantity) * num(l.unit_price) * 100) / 100
  const sub = Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_pct) / 100) * 100) / 100
  const tax = Math.round(sub * rate) / 100
  return { gross, sub, tax, total: sub + tax }
}
let keySeq = 0
export const newLineKey = () => `p${Date.now()}-${keySeq++}`

const SOURCE_LABEL: Record<string, string> = {
  vendor_price: msg("vendor's price"), last_purchase: msg('last price paid'), average_cost: msg('average cost'), standard_cost: msg('standard cost'),
}
export const MATCH_TONE: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  matched: 'success', not_applicable: 'secondary', not_matched: 'secondary', qty_variance: 'destructive', price_variance: 'destructive', no_receipt: 'destructive',
}
export const MATCH_LABEL: Record<string, string> = {
  matched: msg('Matched|bill'), not_applicable: msg('No order line'), not_matched: msg('Not checked'), qty_variance: msg('Quantity differs'), price_variance: msg('Price differs'), no_receipt: msg('Not received'),
}

export function PurchaseLinesEditor({ form: anyForm, editable, currency, progress, match, title, allowAdd = true }: {
  // the PO and bill forms both carry vendor/date/currency/lines; the editor only touches those
  form: UseFormReturn<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  editable: boolean
  currency: string
  progress?: Record<number, PurchaseProgress>
  match?: Record<number, MatchLine>
  title?: string
  allowAdd?: boolean
}) {
  const form = anyForm as UseFormReturn<LinesForm>
  const { companyId } = useCompany()
  const variants = usePurchasableVariants()
  const taxes = useTaxCodes()
  const packs = usePacks()
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const watched = useWatch({ control: form.control, name: 'lines' })
  const [vendorId, docDate, cur] = useWatch({ control: form.control, name: ['vendor_id', 'doc_date', 'currency_code'] })
  const [hints, setHints] = React.useState<Record<string, PurchasePrice>>({})
  const rateOf = React.useCallback((taxId?: string | null) => num(taxes.data?.find((t) => t.id === taxId)?.rate), [taxes.data])
  const vmap = React.useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data])
  const options = React.useMemo(() => (variants.data ?? []).map((v) => ({
    value: v.id, label: v.sku,
    hint: v.product_type === 'service' ? v.name : `${v.name} · ${t('{qty} on hand', { qty: formatQty(v.on_hand) })}`,
    keywords: [v.name],
  })), [variants.data])

  const applyPrice = React.useCallback(async (i: number, variantId: string, quantity: number, setDescription: boolean) => {
    if (!vendorId) { toast.message(t('Choose the vendor first to fill in prices')); return }
    try {
      const p = await fetchPurchasePrice({ companyId, vendorId, variantId, quantity, currency: cur, date: docDate })
      if (!p) return
      const key = form.getValues(`lines.${i}.key`)
      setHints((h) => ({ ...h, [key]: p }))
      if (p.unit_price != null && (p.source === 'vendor_price' || p.source === 'last_purchase' || !num(form.getValues(`lines.${i}.unit_price`)))) {
        form.setValue(`lines.${i}.unit_price`, num(p.unit_price), { shouldDirty: true })
        form.setValue(`lines.${i}.price_source`, 'auto')
      }
      if (setDescription) {
        const v = vmap.get(variantId)
        if (v) form.setValue(`lines.${i}.description`, v.name, { shouldValidate: true })
        if (p.tax_code_id) form.setValue(`lines.${i}.tax_code_id`, p.tax_code_id)
      }
    } catch (e) { toast.error(String((e as Error).message)) }
  }, [companyId, vendorId, cur, docDate, form, vmap])

  // vendor or currency changed → re-price automatically priced lines
  const ctx = `${vendorId}|${cur}`
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!editable) return
    form.getValues('lines').forEach((l, i) => { if (l.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, num(l.quantity) || 1, false) })
  }, [ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = (watched ?? []).reduce((acc, l) => {
    const a = lineAmounts(l, rateOf(l.tax_code_id))
    return { gross: acc.gross + a.gross, sub: acc.sub + a.sub, tax: acc.tax + a.tax, total: acc.total + a.total }
  }, { gross: 0, sub: 0, tax: 0, total: 0 })
  const discount = totals.gross - totals.sub
  const taxName = (id?: string | null) => { const n = taxes.data?.find((x) => x.id === id)?.name; return n ? td(n) : t('No VAT') }
  const setPack = (i: number, v: PackChange) => {
    form.setValue(`lines.${i}.pack_id`, v.pack_id, { shouldDirty: true })
    form.setValue(`lines.${i}.pack_qty`, v.pack_qty, { shouldDirty: true })
    if (v.quantity) form.setValue(`lines.${i}.quantity`, v.quantity, { shouldDirty: true, shouldValidate: true })
  }
  const addLine = () => lines.append({
    key: newLineKey(), variant_id: null, description: '', quantity: 1, unit_price: 0, discount_pct: 0,
    tax_code_id: taxes.data?.find((t) => t.scope !== 'sales' && num(t.rate) > 0 && t.is_active)?.id ?? null, price_source: 'auto',
    po_line_id: null, receipt_line_id: null, requisition_line_id: null, pack_id: null, pack_qty: null,
  })

  const matchCell = (lineNo: number) => {
    const m = match?.[lineNo]
    if (!m) return null
    return (
      <div className="mt-1 flex flex-col items-end gap-0.5">
        <Badge variant={MATCH_TONE[m.status] ?? 'secondary'}>{MATCH_LABEL[m.status] ? t(MATCH_LABEL[m.status]!) : humanize(m.status)}</Badge>
        {m.status === 'qty_variance' && m.qty_variance != null && <span className="text-2xs text-destructive">{t('+{qty} over what was received', { qty: formatQty(m.qty_variance) })}{m.expected_qty != null && ` (${formatQty(m.expected_qty)})`}</span>}
        {m.status === 'price_variance' && m.price_variance != null && <span className="text-2xs text-destructive">{t('+{amount} per unit over the order', { amount: formatMoney(m.price_variance) })}{m.po_net_price != null && ` (${formatMoney(m.po_net_price)})`}</span>}
        {m.status === 'matched' && num(m.price_variance) !== 0 && m.price_variance != null && <span className="text-2xs text-muted-foreground">{t('{amount} per unit, within tolerance', { amount: `${num(m.price_variance) > 0 ? '+' : ''}${formatMoney(m.price_variance)}` })}</span>}
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">{title ?? t('Lines')}</h3>
        {editable && allowAdd && <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus /> {t('Add line')}</Button>}
      </div>
      {lines.fields.length === 0 ? (
        <EmptyState compact title={t('No lines yet')} description={t("Add products, services or free-text items. Prices come from the vendor's price list or the last price paid.")} action={editable && allowAdd && <Button size="sm" type="button" onClick={addLine}><Plus /> {t('Add line')}</Button>} />
      ) : !editable ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-8">#</TableHead><TableHead>{t('Item')}</TableHead><TableHead className="text-right">{t('Qty')}</TableHead>
              <TableHead className="text-right">{t('Unit price')}</TableHead><TableHead className="text-right">{t('Discount')}</TableHead><TableHead>{t('VAT')}</TableHead>
              {progress && <TableHead className="w-[220px]">{t('Received · billed')}</TableHead>}
              <TableHead className="text-right">{t('Amount')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(watched ?? []).map((l, i) => {
                const v = l.variant_id ? vmap.get(l.variant_id) : undefined
                const pr = progress?.[i]
                return (
                  <TableRow key={l.key ?? i} className="align-top hover:bg-transparent">
                    <TableCell className="text-[13px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><div className="font-medium">{v?.sku ?? l.description}</div>{v && <div className="text-xs text-muted-foreground">{l.description}</div>}</TableCell>
                    <TableCell className="text-right tabular">{formatQty(l.quantity)} <span className="text-xs text-muted-foreground">{td(v?.uom_code)}</span>
                      {l.pack_id && <PackQty editable={false} packs={l.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l.pack_id} packQty={l.pack_qty} quantity={l.quantity} line={i + 1} onChange={() => undefined} />}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(l.unit_price)}</TableCell>
                    <TableCell className="text-right tabular">{num(l.discount_pct) ? `${num(l.discount_pct)}%` : '—'}</TableCell>
                    <TableCell className="text-[13px]">{taxName(l.tax_code_id)}</TableCell>
                    {progress && <TableCell>{pr ? <ProgressBar p={pr} /> : null}</TableCell>}
                    <TableCell className="text-right tabular font-medium">{formatMoney(lineAmounts(l, rateOf(l.tax_code_id)).sub)}{matchCell(i + 1)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-8">#</TableHead><TableHead>{t('Item')}</TableHead><TableHead className="w-32 text-right">{t('Qty')}</TableHead>
              <TableHead className="w-32 text-right">{t('Unit price')}</TableHead><TableHead className="w-24 text-right">{t('Discount %')}</TableHead>
              <TableHead className="w-36">{t('VAT')}</TableHead><TableHead className="w-36 text-right">{t('Amount')}</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.fields.map((f, i) => {
                const l = watched?.[i]
                const amt = l ? lineAmounts(l, rateOf(l.tax_code_id)) : { sub: 0 }
                const v = l?.variant_id ? vmap.get(l.variant_id) : undefined
                const h = l ? hints[l.key] : undefined
                const belowMoq = h?.min_order_qty && num(l?.quantity) < num(h.min_order_qty)
                const linked = !!l?.po_line_id
                return (
                  <TableRow key={f.id} className="align-top hover:bg-transparent">
                    <TableCell className="pt-4 text-[13px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="min-w-[280px]">
                      <div className="grid gap-1.5">
                        <FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (
                          <FormItem><FormControl>
                            <SearchSelect value={field.value} options={options} clearable disabled={linked}
                              placeholder={t('Product, or leave empty for a free-text line')} searchPlaceholder={t('SKU, name or scan')}
                              onChange={(val) => { field.onChange(val); setPack(i, { pack_id: null, pack_qty: null }); if (val) void applyPrice(i, val, num(l?.quantity) || 1, true) }}
                              onUnmatchedEnter={async (code) => {
                                const { data } = await supabase.rpc('find_variant_by_code', { p_company: companyId, p_code: code })
                                const hit = data?.[0]
                                if (!hit?.variant_id) return void toast.error(t('No product with barcode or SKU “{code}”', { code }))
                                field.onChange(hit.variant_id)
                                const k = packForScan(packs.byVariant.get(hit.variant_id), num(hit.units_per_scan))
                                setPack(i, k ? { pack_id: k.id, pack_qty: 1, quantity: k.factor } : { pack_id: null, pack_qty: null })
                                void applyPrice(i, hit.variant_id, k ? k.factor : num(l?.quantity) || 1, true)
                              }} />
                          </FormControl></FormItem>
                        )} />
                        <FormField control={form.control} name={`lines.${i}.description`} render={({ field }) => (
                          <FormItem><FormControl><Input className="h-8 text-[13px]" placeholder={t('Description')} aria-label={t('Description, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        {v && v.product_type !== 'service' && (
                          <p className="text-2xs text-muted-foreground">
                            {t('{qty} on hand', { qty: formatQty(v.on_hand) })} · {t('{qty} on order', { qty: formatQty(v.incoming) })}{v.reorder_min != null && ` · ${t('reorder at {qty}', { qty: formatQty(v.reorder_min) })}`}
                            {h?.vendor_sku && ` · ${t('vendor code {code}', { code: h.vendor_sku })}`}{num(h?.lead_time_days) > 0 && ` · ${t('{n} days delivery time', { n: h!.lead_time_days })}`}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" className={cn('h-9 min-w-[80px] text-right', belowMoq && 'border-warning')} aria-label={t('Quantity, line {n}', { n: i + 1 })}
                          {...field} onChange={(e) => { field.onChange(e); if (l?.pack_id) form.setValue(`lines.${i}.pack_qty`, packsFromPieces(packs.byId.get(l.pack_id), e.target.value)) }}
                          onBlur={() => { field.onBlur(); if (l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, num(field.value) || 1, false) }} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <PackQty packs={l?.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l?.pack_id} packQty={l?.pack_qty} quantity={l?.quantity}
                        uom={v?.uom_code} line={i + 1} onChange={(c) => { setPack(i, c); if (c.quantity && l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, c.quantity, false) }} />
                      {belowMoq && <p className="mt-1 text-right text-2xs text-warning">{t('vendor minimum {qty}', { qty: formatQty(h!.min_order_qty) })}</p>}
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.unit_price`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[100px] text-right" aria-label={t('Unit price, line {n}', { n: i + 1 })}
                          {...field} onChange={(e) => { field.onChange(e); form.setValue(`lines.${i}.price_source`, 'manual') }} /></FormControl><FormMessage /></FormItem>
                      )} />
                      {l?.price_source === 'auto' && h?.source && <p className="mt-1 text-right text-2xs text-muted-foreground">{SOURCE_LABEL[h.source] ? t(SOURCE_LABEL[h.source]!) : h.source}</p>}
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.discount_pct`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" max="100" className="h-9 min-w-[70px] text-right" aria-label={t('Discount, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.tax_code_id`} render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9" aria-label={t('VAT, line {n}', { n: i + 1 })}><SelectValue placeholder={t('No VAT')} /></SelectTrigger>
                          <SelectContent>{(taxes.data ?? []).filter((x) => x.scope !== 'sales' && x.is_active).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                    </TableCell>
                    <TableCell className="pt-4 text-right tabular text-[13px] font-medium">{formatMoney(amt.sub)}{matchCell(i + 1)}</TableCell>
                    <TableCell><Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {lines.fields.length > 0 && (
        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t px-4 py-3 text-[13px]">
          {discount > 0 && <><dt className="text-muted-foreground">{t('Before discount')}</dt><dd className="text-right tabular">{formatMoney(totals.gross)}</dd>
            <dt className="text-muted-foreground">{t('Discount')}</dt><dd className="text-right tabular text-success">−{formatMoney(discount)}</dd></>}
          <dt className="text-muted-foreground">{t('Net')}</dt><dd className="text-right tabular">{formatMoney(totals.sub)}</dd>
          <dt className="text-muted-foreground">{t('VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.tax)}</dd>
          <dt className="mt-1 border-t pt-2 font-semibold">{t('Total')}</dt><dd className="mt-1 border-t pt-2 text-right tabular text-base font-semibold">{formatMoney(totals.total)} <span className="text-xs font-normal text-muted-foreground">{currency}</span></dd>
        </dl>
      )}
      {form.formState.errors.lines?.message && <p className="px-4 pb-3 text-xs font-medium text-destructive">{t(form.formState.errors.lines.message)}</p>}
    </div>
  )
}

function ProgressBar({ p }: { p: PurchaseProgress }) {
  const o = num(p.ordered) || 1
  const pct = (x: unknown) => `${Math.min(100, (num(x) / o) * 100)}%`
  return (
    <div className="grid gap-1" title={t('{received} received · {billed} billed of {ordered}', { received: formatQty(p.received), billed: formatQty(p.billed), ordered: formatQty(p.ordered) })}>
      {!p.isService && (
        <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(p.received) }} />
        </div>
      )}
      <div className="text-2xs text-muted-foreground">
        {p.isService ? t('Service') : <><span className="tabular text-foreground">{formatQty(p.received)}</span>/{formatQty(p.ordered)} {t('received')}</>}
        {' · '}<span className="tabular text-foreground">{formatQty(p.billed)}</span> {t('billed')}
      </div>
    </div>
  )
}
