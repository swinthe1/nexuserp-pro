import { Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PackQty, packsFromPieces, type PackChange } from '@/components/pack-qty'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { useTaxCodes } from '@/features/inventory/api'
import { fetchPrice, useSellableVariants } from '../api'
import type { SalesDocValues } from '../schemas'
import { t, td } from '@/i18n'
import { describeError } from '@/lib/errors'
import { packForScan, usePacks } from '@/lib/packs'

export interface LineProgress { ordered?: number; delivered?: number; invoiced?: number; reserved?: number }

/** Line amounts exactly as the database computes them (tax-exclusive prices) */
export function lineAmounts(l: { quantity: unknown; unit_price: unknown; discount_pct: unknown }, rate: number) {
  const sub = Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_pct) / 100) * 100) / 100
  const tax = Math.round(sub * rate) / 100
  return { gross: Math.round(num(l.quantity) * num(l.unit_price) * 100) / 100, sub, tax, total: sub + tax }
}

let keySeq = 0
export const newLineKey = () => `n${Date.now()}-${keySeq++}`

export function SalesLinesEditor({ form, editable, progress, currency, showProgress }: {
  form: UseFormReturn<SalesDocValues>
  editable: boolean
  progress?: Record<number, LineProgress>
  currency: string
  showProgress?: boolean
}) {
  const { companyId } = useCompany()
  const variants = useSellableVariants()
  const taxes = useTaxCodes()
  const packs = usePacks()
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const watched = useWatch({ control: form.control, name: 'lines' })
  const [partnerId, priceListId, docDate, cur] = useWatch({ control: form.control, name: ['partner_id', 'price_list_id', 'doc_date', 'currency_code'] })
  const rateOf = React.useCallback((taxId?: string | null) => num(taxes.data?.find((t) => t.id === taxId)?.rate), [taxes.data])
  const variantOptions = React.useMemo(() => (variants.data ?? []).map((v) => ({
    value: v.id, label: v.sku,
    hint: v.product_type === 'stockable' ? t('{name} · {qty} available', { name: v.name, qty: formatQty(v.available) }) : v.name,
    // the name, every barcode and each supplier's article number find it
    keywords: [v.name, ...(v.codes ? v.codes.split(' ') : [])],
  })), [variants.data])

  const applyPrice = React.useCallback(async (i: number, variantId: string, quantity: number, setDescription: boolean) => {
    try {
      const p = await fetchPrice({ companyId, partnerId, variantId, quantity, date: docDate, priceListId, currency: cur })
      if (!p) return
      form.setValue(`lines.${i}.unit_price`, num(p.unit_price), { shouldDirty: true })
      form.setValue(`lines.${i}.discount_pct`, num(p.discount_pct), { shouldDirty: true })
      form.setValue(`lines.${i}.price_source`, 'auto')
      if (setDescription) {
        const v = variants.data?.find((x) => x.id === variantId)
        if (v) form.setValue(`lines.${i}.description`, v.name, { shouldValidate: true })
        if (p.tax_code_id) form.setValue(`lines.${i}.tax_code_id`, p.tax_code_id)
      }
    } catch (e) { toast.error(describeError(e)) }
  }, [companyId, partnerId, docDate, priceListId, cur, form, variants.data])

  // customer / price list / currency changed → re-price lines that were priced automatically
  const ctxKey = `${partnerId}|${priceListId}|${cur}`
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!editable) return
    form.getValues('lines').forEach((l, i) => {
      if (l.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, num(l.quantity) || 1, false)
    })
  }, [ctxKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = (watched ?? []).reduce((acc, l) => {
    const a = lineAmounts(l, rateOf(l.tax_code_id))
    return { gross: acc.gross + a.gross, sub: acc.sub + a.sub, tax: acc.tax + a.tax, total: acc.total + a.total }
  }, { gross: 0, sub: 0, tax: 0, total: 0 })

  const setPack = (i: number, v: PackChange) => {
    form.setValue(`lines.${i}.pack_id`, v.pack_id, { shouldDirty: true })
    form.setValue(`lines.${i}.pack_qty`, v.pack_qty, { shouldDirty: true })
    if (v.quantity) form.setValue(`lines.${i}.quantity`, v.quantity, { shouldDirty: true, shouldValidate: true })
  }
  const addLine = () => lines.append({ key: newLineKey(), variant_id: null, description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_code_id: taxes.data?.find((t) => t.scope !== 'purchase' && num(t.rate) > 0)?.id ?? null, price_source: 'auto', sales_order_line_id: null, pack_id: null, pack_qty: null })

  const discount = totals.gross - totals.sub
  const variantLabel = (id?: string | null) => variants.data?.find((v) => v.id === id)
  const taxName = (id?: string | null) => { const n = taxes.data?.find((x) => x.id === id)?.name; return n ? td(n) : t('No VAT') }

  return (
    <div className="mt-4 rounded-lg border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">{t('Lines')}</h3>
        {editable && <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus /> {t('Add line')}</Button>}
      </div>
      {lines.fields.length === 0 ? (
        <EmptyState compact title={t('No lines yet')} description={t("Add products or services. Prices come from the customer's price list automatically.")} action={editable && <Button size="sm" type="button" onClick={addLine}><Plus /> {t('Add line')}</Button>} />
      ) : !editable ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-8">#</TableHead>
              <TableHead>{t('Item')}</TableHead>
              <TableHead className="text-right">{t('Qty')}</TableHead>
              <TableHead className="text-right">{t('Unit price (without VAT)')}</TableHead>
              <TableHead className="text-right">{t('Disc.')}</TableHead>
              <TableHead>{t('VAT')}</TableHead>
              {showProgress && <TableHead className="w-[220px]">{t('Delivered · invoiced')}</TableHead>}
              <TableHead className="text-right">{t('Amount (without VAT)')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(watched ?? []).map((l, i) => {
                const v = variantLabel(l.variant_id)
                const pr = progress?.[i]
                return (
                  <TableRow key={l.key ?? i} className="hover:bg-transparent">
                    <TableCell className="text-[13px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><div className="font-medium">{v?.sku ?? l.description}</div>{v && <div className="text-xs text-muted-foreground">{l.description}</div>}</TableCell>
                    <TableCell className="text-right tabular">{formatQty(l.quantity)} <span className="text-xs text-muted-foreground">{td(v?.uom_code)}</span>
                      {l.pack_id && <PackQty editable={false} packs={l.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l.pack_id} packQty={l.pack_qty} quantity={l.quantity} line={i + 1} onChange={() => undefined} />}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(l.unit_price)}
                      {rateOf(l.tax_code_id) > 0 && <div className="text-2xs text-muted-foreground">{t('With VAT {amount}', { amount: formatMoney(num(l.unit_price) * (1 + rateOf(l.tax_code_id) / 100)) })}</div>}</TableCell>
                    <TableCell className="text-right tabular">{num(l.discount_pct) ? `${num(l.discount_pct)}%` : '—'}</TableCell>
                    <TableCell className="text-[13px]">{taxName(l.tax_code_id)}</TableCell>
                    {showProgress && (
                      <TableCell>{pr && v?.product_type !== 'service' ? <ProgressBar p={pr} /> : pr ? <span className="text-xs text-muted-foreground">{t('Service · invoiced {done}/{total}', { done: formatQty(pr.invoiced), total: formatQty(pr.ordered) })}</span> : null}</TableCell>
                    )}
                    <TableCell className="text-right tabular font-medium">{formatMoney(lineAmounts(l, rateOf(l.tax_code_id)).sub)}</TableCell>
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
              <TableHead className="w-8">#</TableHead>
              <TableHead>{t('Item')}</TableHead>
              <TableHead className="w-32 text-right">{t('Qty')}</TableHead>
              <TableHead className="w-32 text-right">{t('Unit price (without VAT)')}</TableHead>
              <TableHead className="w-24 text-right">{t('Disc. %')}</TableHead>
              <TableHead className="w-36">{t('VAT')}</TableHead>
              <TableHead className="w-32 text-right">{t('Amount (without VAT)')}</TableHead>
              <TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.fields.map((f, i) => {
                const l = watched?.[i]
                const amt = l ? lineAmounts(l, rateOf(l.tax_code_id)) : { sub: 0 }
                const v = variantLabel(l?.variant_id)
                const short = v && v.product_type === 'stockable' && num(l?.quantity) > num(v.available)
                if (l?.advance_invoice_id) return (
                  <TableRow key={f.id} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell className="text-[13px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell colSpan={4} className="text-[13px]"><span className="font-medium">{t('Advance deducted')}</span> · {l.description}</TableCell>
                    <TableCell className="text-[13px]">{taxName(l.tax_code_id)}</TableCell>
                    <TableCell className="text-right tabular text-[13px] font-medium">{formatMoney(amt.sub)}</TableCell>
                    <TableCell><Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button></TableCell>
                  </TableRow>
                )
                return (
                  <TableRow key={f.id} className="align-top hover:bg-transparent">
                    <TableCell className="pt-4 text-[13px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="min-w-[280px]">
                      <div className="grid gap-1.5">
                        <FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (
                          <FormItem><FormControl>
                            <SearchSelect value={field.value} options={variantOptions} placeholder={t('Product, or leave empty for a free-text line')} clearable
                              searchPlaceholder={t('Code, name or scan')}
                              onChange={(val) => { field.onChange(val); setPack(i, { pack_id: null, pack_qty: null }); if (val) void applyPrice(i, val, num(l?.quantity) || 1, true) }}
                              onUnmatchedEnter={async (code) => {
                                const { data } = await supabase.rpc('find_variant_by_code', { p_company: companyId, p_code: code })
                                const hit = data?.[0]
                                if (!hit?.variant_id) return void toast.error(t('No product with barcode or code “{code}”', { code }))
                                field.onChange(hit.variant_id)
                                form.setValue(`lines.${i}.quantity`, num(hit.units_per_scan) || 1)
                                const k = packForScan(packs.byVariant.get(hit.variant_id), num(hit.units_per_scan))
                                setPack(i, k ? { pack_id: k.id, pack_qty: 1 } : { pack_id: null, pack_qty: null })
                                void applyPrice(i, hit.variant_id, num(hit.units_per_scan) || 1, true)
                              }} />
                          </FormControl></FormItem>
                        )} />
                        <FormField control={form.control} name={`lines.${i}.description`} render={({ field }) => (
                          <FormItem><FormControl><Input className="h-8 text-[13px]" placeholder={t('Description on the document')} aria-label={t('Description, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" className={cn('h-9 min-w-[80px] text-right', short && 'border-warning')} aria-label={t('Quantity, line {n}', { n: i + 1 })}
                          {...field} onChange={(e) => { field.onChange(e); if (l?.pack_id) form.setValue(`lines.${i}.pack_qty`, packsFromPieces(packs.byId.get(l.pack_id), e.target.value)) }}
                          onBlur={() => { field.onBlur(); if (l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, num(field.value) || 1, false) }} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <PackQty packs={l?.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l?.pack_id} packQty={l?.pack_qty} quantity={l?.quantity}
                        uom={v?.uom_code} line={i + 1} onChange={(c) => { setPack(i, c); if (c.quantity && l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, c.quantity, false) }} />
                      {short && <p className="mt-1 text-right text-2xs text-warning">{t('only {qty} free', { qty: formatQty(v.available) })}</p>}
                    </TableCell>
                    <TableCell>
                      <FormField control={form.control} name={`lines.${i}.unit_price`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[100px] text-right" aria-label={t('Unit price, line {n}', { n: i + 1 })}
                          {...field} onChange={(e) => { field.onChange(e); form.setValue(`lines.${i}.price_source`, 'manual') }} /></FormControl><FormMessage /></FormItem>
                      )} />
                      {l?.price_source === 'auto' && l.variant_id && <p className="mt-1 text-right text-2xs text-muted-foreground">{t('automatic price')}</p>}
                      {l && rateOf(l.tax_code_id) > 0 && num(l.unit_price) > 0 && <p className="mt-0.5 text-right text-2xs text-muted-foreground">{t('With VAT {amount}', { amount: formatMoney(num(l.unit_price) * (1 + rateOf(l.tax_code_id) / 100)) })}</p>}
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
                          <SelectContent>{(taxes.data ?? []).filter((x) => x.scope !== 'purchase' && x.is_active).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                    </TableCell>
                    <TableCell className="pt-4 text-right tabular text-[13px] font-medium">{formatMoney(amt.sub)}</TableCell>
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
          {discount > 0 && <><dt className="text-muted-foreground">{t('Before discount, without VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.gross)}</dd>
            <dt className="text-muted-foreground">{t('Discount')}</dt><dd className="text-right tabular text-success">−{formatMoney(discount)}</dd></>}
          <dt className="text-muted-foreground">{t('Amount without VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.sub)}</dd>
          <dt className="text-muted-foreground">{t('VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.tax)}</dd>
          <dt className="mt-1 border-t pt-2 font-semibold">{t('Total with VAT')}</dt><dd className="mt-1 border-t pt-2 text-right tabular text-base font-semibold">{formatMoney(totals.total)} <span className="text-xs font-normal text-muted-foreground">{currency}</span></dd>
        </dl>
      )}
      {form.formState.errors.lines?.message && <p className="px-4 pb-3 text-xs font-medium text-destructive">{t(form.formState.errors.lines.message)}</p>}
    </div>
  )
}

function ProgressBar({ p }: { p: LineProgress }) {
  const o = num(p.ordered) || 1
  const pct = (x: unknown) => `${Math.min(100, (num(x) / o) * 100)}%`
  return (
    <div className="grid gap-1" title={t('{delivered} delivered · {reserved} reserved · {invoiced} invoiced of {ordered}', { delivered: formatQty(p.delivered), reserved: formatQty(p.reserved), invoiced: formatQty(p.invoiced), ordered: formatQty(p.ordered) })}>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="absolute inset-y-0 left-0 bg-primary/35" style={{ width: pct(num(p.delivered) + num(p.reserved)) }} />
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(p.delivered) }} />
      </div>
      <div className="text-2xs text-muted-foreground">
        {t('{delivered}/{ordered} delivered · {invoiced} invoiced', { delivered: formatQty(p.delivered), ordered: formatQty(p.ordered), invoiced: formatQty(p.invoiced) })}
        {num(p.reserved) > 0 && <> · {t('{qty} reserved', { qty: formatQty(p.reserved) })}</>}
      </div>
    </div>
  )
}
