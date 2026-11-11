import { itemCodes } from '@/lib/item-codes'
import { PackagePlus, Plus, ScanBarcode, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PackQty, packsFromPieces, type PackChange } from '@/components/pack-qty'
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

const foldText = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

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

  // the same way in as on the purchase invoice: scan or type above, the item becomes a line, the cursor waits on its quantity
  const [code, setCode] = React.useState('')
  const [listOpen, setListOpen] = React.useState(false)
  const [pick, setPick] = React.useState(0)
  const codeRef = React.useRef<HTMLInputElement>(null)
  const qtyRefs = React.useRef(new Map<string, HTMLInputElement>())
  const dq = React.useDeferredValue(code)
  const hay = React.useMemo(() => (variants.data ?? []).map((v) => ({ v, text: foldText(`${v.name} ${v.sku ?? ''} ${v.codes ?? ''}`) })), [variants.data])
  const fits = React.useMemo(() => {
    const q = foldText(dq.trim())
    if (!q || (/^\d+$/.test(q) && q.length >= 8)) return []
    const words = q.split(/\s+/)
    const out: (typeof hay)[number]['v'][] = []
    for (const h of hay) { if (words.every((w) => h.text.includes(w))) { out.push(h.v); if (out.length >= 8) break } }
    return out
  }, [hay, dq])
  React.useEffect(() => setPick(0), [dq])
  const focusQty = (key: string) => window.setTimeout(() => { const el = qtyRefs.current.get(key); el?.focus(); el?.select() }, 60)
  const take = (variantId: string, units = 1) => {
    setCode(''); setListOpen(false)
    const all = form.getValues('lines')
    const at = all.findIndex((l) => l.variant_id === variantId && !l.advance_invoice_id && !l.sales_order_line_id)
    if (at >= 0) {
      // scanned again: one more on the same line
      const l = all[at]!, q = num(l.quantity) + units
      form.setValue(`lines.${at}.quantity`, q, { shouldDirty: true, shouldValidate: true })
      if (l.pack_id) form.setValue(`lines.${at}.pack_qty`, packsFromPieces(packs.byId.get(l.pack_id), q))
      if (l.price_source === 'auto') void applyPrice(at, variantId, q, false)
      return focusQty(l.key ?? '')
    }
    const key = newLineKey(), i = all.length
    const k = packForScan(packs.byVariant.get(variantId), units)
    lines.append({ key, variant_id: variantId, description: variants.data?.find((x) => x.id === variantId)?.name ?? '', quantity: units, unit_price: 0, discount_pct: 0,
      tax_code_id: taxes.data?.find((t) => t.scope !== 'purchase' && num(t.rate) > 0)?.id ?? null, price_source: 'auto', sales_order_line_id: null,
      pack_id: k && units > 1 ? k.id : null, pack_qty: k && units > 1 ? 1 : null }, { shouldFocus: false })
    void applyPrice(i, variantId, units, true)
    focusQty(key)
  }
  const onCode = async () => {
    const c = code.trim(); if (!c || !companyId) return
    const chosen = dq.trim() === c ? fits[Math.min(pick, fits.length - 1)] : undefined
    if (chosen && (fits.length === 1 || listOpen)) return take(chosen.id)
    const hit = await lookupCode(companyId, c).catch(() => null)
    if (hit) return take(hit.variant_id, num(hit.units_per_scan) || 1)
    if (fits.length > 1) return setListOpen(true)
    toast.error(t('No product with barcode or code “{code}”', { code: c }))
  }
  const onCodeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void onCode() }
    else if (e.key === 'ArrowDown' && fits.length) { e.preventDefault(); setListOpen(true); setPick((i) => Math.min(i + 1, fits.length - 1)) }
    else if (e.key === 'ArrowUp' && fits.length) { e.preventDefault(); setPick((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Escape') setListOpen(false)
  }
  // Enter in a line goes on to its next field, and from the last one back to the scan field
  const next = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const row = e.currentTarget.closest('tr')
    const inputs = row ? [...row.querySelectorAll<HTMLInputElement>('input[data-nav]')] : []
    const n = inputs[inputs.indexOf(e.currentTarget) + 1]
    if (n) { n.focus(); n.select() } else codeRef.current?.focus()
  }
  const variantLabel = (id?: string | null) => variants.data?.find((v) => v.id === id)
  const taxName = (id?: string | null) => { const n = taxes.data?.find((x) => x.id === id)?.name; return n ? td(n) : t('No VAT') }

  return (
    <div className="mt-4 rounded-lg border bg-card">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full max-w-xl">
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={codeRef} value={code} onChange={(e) => { setCode(e.target.value); setListOpen(true) }} onKeyDown={onCodeKey}
              onFocus={() => setListOpen(true)} onBlur={() => window.setTimeout(() => setListOpen(false), 150)}
              className="pl-8" placeholder={variants.data ? t('Scan the barcode, or type the code or the name') : t('Loading the items…')} aria-label={t('Barcode, code or name')}
              role="combobox" aria-expanded={listOpen && fits.length > 0} aria-controls="sl-fits" aria-autocomplete="list" />
            {listOpen && fits.length > 0 && (
              <ul id="sl-fits" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-[13px] shadow-md">
                {fits.map((it, i) => (
                  <li key={it.id} role="option" aria-selected={i === pick}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5', i === pick && 'bg-accent')}
                    onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); take(it.id) }}>
                    <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{itemCodes(it)}</span>
                    {it.product_type === 'stockable' && <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">{formatQtyOf(it.available, it.id)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={withVat} onCheckedChange={switchVat} aria-label={t('Type prices with VAT')} /> {t('Type prices with VAT')}</label>
            <Button type="button" size="sm" variant="outline" onClick={addLine} title={t('A line of free text, with no item: a service, a note')}><Plus /> {t('Free-text line')}</Button>
          </div>
        </div>
      ) : <div className="px-4 py-3"><h3 className="text-sm font-semibold">{t('Lines')}</h3></div>}
      {lines.fields.length === 0 ? (
        <div className="px-3 py-10 text-center text-[13px] text-muted-foreground">
          <PackagePlus className="mx-auto mb-2 size-6" />{editable ? t('Scan or type the first item above.') : t('No lines yet')}</div>
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
          <table className="doc-lines w-full min-w-[900px] text-[13px]">
            <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t('Item')}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{t('Qty')}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{withVat ? t('Unit price (with VAT)') : t('Unit price (without VAT)')}</th>
                <th className="w-20 px-2 py-2 text-right font-medium">{t('Disc. %')}</th>
                <th className="w-32 px-2 py-2 font-medium">{t('VAT')}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t('Without VAT')}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t('With VAT')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.fields.map((f, i) => {
                const l = watched?.[i]
                const amt = l ? lineAmounts(l, rateOf(l.tax_code_id)) : { sub: 0, total: 0 }
                const v = variantLabel(l?.variant_id)
                const short = v && v.product_type === 'stockable' && num(l?.quantity) > num(v.available)
                const remove = <td className="px-1 py-1"><Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button></td>
                if (l?.advance_invoice_id) return (
                  <tr key={f.id} className="border-t bg-muted/30">
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td colSpan={4} className="px-2 py-2"><span className="font-medium">{t('Advance deducted')}</span> · {l.description}</td>
                    <td className="px-2 py-2">{taxName(l.tax_code_id)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{formatMoney(amt.sub, currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{formatMoney(amt.total, currency)}</td>
                    {remove}
                  </tr>
                )
                return (
                  <tr key={f.id} className="border-t align-top">
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="min-w-[240px] px-1 py-1">
                      {/* the name as it goes on the document: it can be reworded; a line with no item is free text */}
                      <FormField control={form.control} name={`lines.${i}.description`} render={({ field }) => (
                        <FormItem className="space-y-0"><FormControl><Input className={cn('h-8 font-medium', v && 'border-transparent bg-transparent px-1 shadow-none hover:border-input focus-visible:border-input')}
                          placeholder={t('Description on the document')} aria-label={t('Description, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      {v && <p className="px-1 text-[11px] text-muted-foreground">{itemCodes(v)}{v.uom_code ? ` · ${v.uom_code}` : ''}{v.product_type === 'stockable' ? ` · ${t('{qty} available', { qty: formatQtyOf(v.available, v.id) })}` : ''}</p>}
                    </td>
                    <td className="px-1 py-1">
                      <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                        <FormItem className="space-y-0"><FormControl><Input data-nav type="number" step="any" min="0" className={cn('h-8 min-w-[70px] text-right tabular-nums', short && 'border-warning')} aria-label={t('Quantity, line {n}', { n: i + 1 })}
                          {...field} ref={(el) => { field.ref(el); const k = l?.key ?? f.id; if (el) qtyRefs.current.set(k, el); else qtyRefs.current.delete(k) }}
                          onKeyDown={next} onFocus={(e) => e.target.select()}
                          onChange={(e) => { field.onChange(e); if (l?.pack_id) form.setValue(`lines.${i}.pack_qty`, packsFromPieces(packs.byId.get(l.pack_id), e.target.value)) }}
                          onBlur={() => { field.onBlur(); if (l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, num(field.value) || 1, false) }} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <PackQty packs={l?.variant_id ? packs.byVariant.get(l.variant_id) : undefined} packId={l?.pack_id} packQty={l?.pack_qty} quantity={l?.quantity}
                        uom={v?.uom_code} line={i + 1} onChange={(c) => { setPack(i, c); if (c.quantity && l?.variant_id && l.price_source === 'auto') void applyPrice(i, l.variant_id, c.quantity, false) }} />
                      {short && <p className="mt-1 text-right text-2xs text-warning">{t('only {qty} free', { qty: formatQty(v.available, v?.uom_code) })}</p>}
                    </td>
                    <td className="px-1 py-1">
                      {withVat && l ? (
                        <GrossPriceInput net={num(l.unit_price)} rate={rateOf(l.tax_code_id)} quantity={num(l.quantity)} discountPct={num(l.discount_pct)} manual={l.price_source === 'manual'} line={i + 1}
                          onNet={(n) => { form.setValue(`lines.${i}.unit_price`, n, { shouldDirty: true, shouldValidate: true }); form.setValue(`lines.${i}.price_source`, 'manual') }} />
                      ) : <FormField control={form.control} name={`lines.${i}.unit_price`} render={({ field }) => (
                        <FormItem className="space-y-0"><FormControl><Input data-nav type="number" step="any" min="0" className="h-8 min-w-[80px] text-right tabular-nums" aria-label={t('Unit price, line {n}', { n: i + 1 })}
                          {...field} onKeyDown={next} onFocus={(e) => e.target.select()} onChange={(e) => { field.onChange(e); form.setValue(`lines.${i}.price_source`, 'manual') }} /></FormControl><FormMessage /></FormItem>
                      )} />}
                      {l?.price_source === 'auto' && l.variant_id && <p className="mt-0.5 text-right text-2xs text-muted-foreground">{t('automatic price')}</p>}
                      {l && rateOf(l.tax_code_id) > 0 && num(l.unit_price) > 0 && <p className="text-right text-2xs text-muted-foreground">{withVat
                        ? t('Without VAT {amount}', { amount: formatNumberWith(num(l.unit_price), { minimumFractionDigits: 2, maximumFractionDigits: 4 }) })
                        : t('With VAT {amount}', { amount: formatMoney(num(l.unit_price) * (1 + rateOf(l.tax_code_id) / 100), currency) })}</p>}
                    </td>
                    <td className="px-1 py-1">
                      <FormField control={form.control} name={`lines.${i}.discount_pct`} render={({ field }) => (
                        <FormItem className="space-y-0"><FormControl><Input data-nav type="number" step="any" min="0" max="100" className="h-8 min-w-[52px] text-right tabular-nums" aria-label={t('Discount, line {n}', { n: i + 1 })}
                          {...field} onKeyDown={next} onFocus={(e) => e.target.select()} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </td>
                    <td className="px-1 py-1">
                      <FormField control={form.control} name={`lines.${i}.tax_code_id`} render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <SelectTrigger className="h-8 min-w-[78px]" aria-label={t('VAT, line {n}', { n: i + 1 })}><SelectValue placeholder={t('No VAT')} /></SelectTrigger>
                          <SelectContent>{(taxes.data ?? []).filter((x) => x.scope !== 'purchase' && x.is_active).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                        </Select>
                      )} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(amt.sub, currency)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{formatMoney(amt.total, currency)}</td>
                    {remove}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {lines.fields.length > 0 && (
        <div className="border-t p-4">
          <dl className="grid content-start gap-1 text-sm md:ml-auto md:w-80">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Before discount (without VAT)')}</dt><dd className="tabular-nums">{formatMoney(totals.gross, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Discounts')}</dt><dd className="tabular-nums">{discount < 0.005 ? formatMoney(0, currency) : `−${formatMoney(discount, currency)}`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('Amount without VAT')}</dt><dd className="tabular-nums">{formatMoney(totals.sub, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('VAT')}</dt><dd className="tabular-nums">{formatMoney(totals.tax, currency)}</dd></div>
            <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>{t('Total (with VAT)')}</dt><dd className="tabular-nums">{formatMoney(totals.total, currency)}</dd></div>
          </dl>
        </div>
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
