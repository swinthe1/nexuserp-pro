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
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { useTaxCodes, lookupCode } from '@/features/inventory/api'
import { fetchPrice, useSellableVariants } from '../api'
import type { SalesDocValues } from '../schemas'
import { formatNumberWith, t, td } from '@/i18n'
import { describeError } from '@/lib/errors'
import { packForScan, usePacks } from '@/lib/packs'
import { formatQtyOf } from '@/lib/units'

export interface LineProgress { ordered?: number; delivered?: number; invoiced?: number; reserved?: number }

/** Line amounts exactly as the database computes them (tax-exclusive prices) */
export function lineAmounts(l: { quantity: unknown; unit_price: unknown; discount_pct: unknown }, rate: number) {
  const sub = Math.round(num(l.quantity) * num(l.unit_price) * (1 - num(l.discount_pct) / 100) * 100) / 100
  const tax = Math.round(sub * rate) / 100
  return { gross: Math.round(num(l.quantity) * num(l.unit_price) * 100) / 100, sub, tax, total: sub + tax }
}

/** the price without VAT (4 decimals, as stored) whose line comes out at exactly this price with VAT,
 *  when one exists; otherwise the nearest one */
export function netFromGross(gross: number, quantity: number, discountPct: number, rate: number) {
  const net0 = Math.round(gross / (1 + rate / 100) * 10000) / 10000
  const q = quantity > 0 ? quantity : 1
  const want = Math.round(q * gross * (1 - discountPct / 100) * 100) / 100
  let best = net0, bestDiff = Infinity
  for (let k = 0; k <= 60; k++) {
    for (const sgn of k ? [1, -1] : [1]) {
      const net = Math.round((net0 + sgn * k / 10000) * 10000) / 10000
      if (net < 0) continue
      const diff = Math.abs(lineAmounts({ quantity: q, unit_price: net, discount_pct: discountPct }, rate).total - want)
      if (diff < bestDiff - 1e-9) { best = net; bestDiff = diff }
      if (diff < 0.005) return net
    }
  }
  return best
}

const GROSS_KEY = 'drispro.sales.priceWithVat'
const readGross = () => { try { return localStorage.getItem(GROSS_KEY) === '1' } catch { return false } }

/** the price typed with VAT; the line keeps the price without VAT */
function GrossPriceInput({ net, rate, quantity, discountPct, manual, line, onNet }: {
  net: number; rate: number; quantity: number; discountPct: number; manual: boolean; line: number; onNet: (net: number) => void
}) {
  const toGross = (n: number) => (n > 0 ? String(Math.round(n * (1 + rate / 100) * 100) / 100) : n === 0 ? '0' : '')
  const [text, setText] = React.useState(() => toGross(net))
  const mine = React.useRef(net)
  // a price set from outside (the price list, a new quantity tier) shows again with VAT
  React.useEffect(() => { if (Math.abs(net - mine.current) > 1e-9) { mine.current = net; setText(toGross(net)) } }, [net]) // eslint-disable-line react-hooks/exhaustive-deps
  // a typed price follows a new quantity, discount or VAT rate so the line still adds up
  const apply = React.useCallback((v: string) => {
    const g = num(v.replace(',', '.'))
    const n = g > 0 ? netFromGross(g, quantity, discountPct, rate) : 0
    mine.current = n; onNet(n)
  }, [quantity, discountPct, rate, onNet])
  const mounted = React.useRef(false)
  React.useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (manual && text !== '') apply(text)
  }, [quantity, discountPct, rate]) // eslint-disable-line react-hooks/exhaustive-deps
  // with 4 decimals some totals cannot come out to the cent: say what the line really comes to
  const g = num(text.replace(',', '.'))
  const q = quantity > 0 ? quantity : 1
  const real = lineAmounts({ quantity: q, unit_price: net, discount_pct: discountPct }, rate).total
  const off = g > 0 && Math.abs(real - Math.round(q * g * (1 - discountPct / 100) * 100) / 100) > 0.004
  return <>
    <Input inputMode="decimal" className="h-9 min-w-[100px] text-right" aria-label={t('Unit price with VAT, line {n}', { n: line })}
      value={text} onChange={(e) => { setText(e.target.value); apply(e.target.value) }} />
    {off && <p className="mt-1 text-right text-2xs text-warning">{t('The line comes to {amount} with VAT', { amount: formatMoney(real) })}</p>}
  </>
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
  const [withVat, setWithVat] = React.useState(readGross)
  const switchVat = (v: boolean) => { setWithVat(v); try { localStorage.setItem(GROSS_KEY, v ? '1' : '0') } catch { /* private window */ } }
  const watched = useWatch({ control: form.control, name: 'lines' })
  const [partnerId, priceListId, docDate, cur] = useWatch({ control: form.control, name: ['partner_id', 'price_list_id', 'doc_date', 'currency_code'] })
  const rateOf = React.useCallback((taxId?: string | null) => num(taxes.data?.find((t) => t.id === taxId)?.rate), [taxes.data])
  const variantOptions = React.useMemo(() => (variants.data ?? []).map((v) => ({
    value: v.id, label: v.sku,
    hint: v.product_type === 'stockable' ? t('{name} · {qty} available', { name: v.name, qty: formatQtyOf(v.available, v.id) }) : v.name,
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
        {editable && <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-[13px]"><Switch checked={withVat} onCheckedChange={switchVat} aria-label={t('Type prices with VAT')} /> {t('Type prices with VAT')}</label>
          <Button type="button" size="sm" variant="outline" onClick={addLine}><Plus /> {t('Add line')}</Button>
        </div>}
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
                    <TableCell className="text-right tabular">{formatQty(l.quantity, v?.uom_code)}
                      {l.pack_id && <PackQty editable={false} packs={l.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l.pack_id} packQty={l.pack_qty} quantity={l.quantity} line={i + 1} onChange={() => undefined} />}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(l.unit_price, currency)}
                      {rateOf(l.tax_code_id) > 0 && <div className="text-2xs text-muted-foreground">{t('With VAT {amount}', { amount: formatMoney(num(l.unit_price) * (1 + rateOf(l.tax_code_id) / 100), currency) })}</div>}</TableCell>
                    <TableCell className="text-right tabular">{num(l.discount_pct) ? `${num(l.discount_pct)}%` : '—'}</TableCell>
                    <TableCell className="text-[13px]">{taxName(l.tax_code_id)}</TableCell>
                    {showProgress && (
                      <TableCell>{pr && v?.product_type !== 'service' ? <ProgressBar p={pr} unit={v?.uom_code} /> : pr ? <span className="text-xs text-muted-foreground">{t('Service · invoiced {done}/{total}', { done: formatQty(pr.invoiced, v?.uom_code), total: formatQty(pr.ordered, v?.uom_code) })}</span> : null}</TableCell>
                    )}
                    <TableCell className="text-right tabular font-medium">{formatMoney(lineAmounts(l, rateOf(l.tax_code_id)).sub, currency)}</TableCell>
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
              <TableHead className="w-32 text-right">{withVat ? t('Unit price (with VAT)') : t('Unit price (without VAT)')}</TableHead>
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
                    <TableCell className="text-right tabular text-[13px] font-medium">{formatMoney(amt.sub, currency)}</TableCell>
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
                                const hit = await lookupCode(companyId!, code).catch(() => null)
                                if (!hit) return void toast.error(t('No product with barcode or code “{code}”', { code }))
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
                      {short && <p className="mt-1 text-right text-2xs text-warning">{t('only {qty} free', { qty: formatQty(v.available, v?.uom_code) })}</p>}
                    </TableCell>
                    <TableCell>
                      {withVat && l ? (
                        <GrossPriceInput net={num(l.unit_price)} rate={rateOf(l.tax_code_id)} quantity={num(l.quantity)} discountPct={num(l.discount_pct)} manual={l.price_source === 'manual'} line={i + 1}
                          onNet={(n) => { form.setValue(`lines.${i}.unit_price`, n, { shouldDirty: true, shouldValidate: true }); form.setValue(`lines.${i}.price_source`, 'manual') }} />
                      ) : <FormField control={form.control} name={`lines.${i}.unit_price`} render={({ field }) => (
                        <FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[100px] text-right" aria-label={t('Unit price, line {n}', { n: i + 1 })}
                          {...field} onChange={(e) => { field.onChange(e); form.setValue(`lines.${i}.price_source`, 'manual') }} /></FormControl><FormMessage /></FormItem>
                      )} />}
                      {l?.price_source === 'auto' && l.variant_id && <p className="mt-1 text-right text-2xs text-muted-foreground">{t('automatic price')}</p>}
                      {l && rateOf(l.tax_code_id) > 0 && num(l.unit_price) > 0 && <p className="mt-0.5 text-right text-2xs text-muted-foreground">{withVat
                        ? t('Without VAT {amount}', { amount: formatNumberWith(num(l.unit_price), { minimumFractionDigits: 2, maximumFractionDigits: 4 }) })
                        : t('With VAT {amount}', { amount: formatMoney(num(l.unit_price) * (1 + rateOf(l.tax_code_id) / 100), currency) })}</p>}
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
                    <TableCell className="pt-4 text-right tabular text-[13px] font-medium">{formatMoney(amt.sub, currency)}</TableCell>
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
          {discount > 0 && <><dt className="text-muted-foreground">{t('Before discount, without VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.gross, currency)}</dd>
            <dt className="text-muted-foreground">{t('Discount')}</dt><dd className="text-right tabular text-success">−{formatMoney(discount, currency)}</dd></>}
          <dt className="text-muted-foreground">{t('Amount without VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.sub, currency)}</dd>
          <dt className="text-muted-foreground">{t('VAT')}</dt><dd className="text-right tabular">{formatMoney(totals.tax, currency)}</dd>
          <dt className="mt-1 border-t pt-2 font-semibold">{t('Total with VAT')}</dt><dd className="mt-1 border-t pt-2 text-right tabular text-base font-semibold">{formatMoney(totals.total, currency)}</dd>
        </dl>
      )}
      {form.formState.errors.lines?.message && <p className="px-4 pb-3 text-xs font-medium text-destructive">{t(form.formState.errors.lines.message)}</p>}
    </div>
  )
}

function ProgressBar({ p, unit }: { p: LineProgress; unit?: string | null }) {
  const o = num(p.ordered) || 1
  const pct = (x: unknown) => `${Math.min(100, (num(x) / o) * 100)}%`
  return (
    <div className="grid gap-1" title={t('{delivered} delivered · {reserved} reserved · {invoiced} invoiced of {ordered}', { delivered: formatQty(p.delivered, unit), reserved: formatQty(p.reserved, unit), invoiced: formatQty(p.invoiced, unit), ordered: formatQty(p.ordered, unit) })}>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="absolute inset-y-0 left-0 bg-primary/35" style={{ width: pct(num(p.delivered) + num(p.reserved)) }} />
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(p.delivered) }} />
      </div>
      <div className="text-2xs text-muted-foreground">
        {t('{delivered}/{ordered} delivered · {invoiced} invoiced', { delivered: formatQty(p.delivered, unit), ordered: formatQty(p.ordered, unit), invoiced: formatQty(p.invoiced, unit) })}
        {num(p.reserved) > 0 && <> · {t('{qty} reserved', { qty: formatQty(p.reserved, unit) })}</>}
      </div>
    </div>
  )
}
