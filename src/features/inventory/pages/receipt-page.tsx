import { zodResolver } from '@hookform/resolvers/zod'
import { useFillUnit } from '@/app/active-unit'
import { useQuery } from '@tanstack/react-query'
import { Globe2, Plus, Ship, Thermometer, Trash2 } from 'lucide-react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import {
  useCurrencies, useDocument, useLocations, usePostDocument, useReceivablePurchaseOrders, useSaveDocument, useVariantOptions,
} from '../api'
import { DocumentShell, LinesCard, SummaryCard } from '../components/document-shell'
import { ReceiptAfterActions } from '../components/receipt-after'
import { ReceiptReportCard } from '../components/receipt-report'
import { supabase } from '@/lib/supabase'
import { LocationPicker, LotPicker, VariantPicker, VendorPicker, WarehousePicker } from '../components/pickers'
import { receiptSchema, type ReceiptFormValues } from '../schemas'
import { t, tEnum, tr } from '@/i18n'
import { ErrorState } from '@/components/error-state'
import { isOfflineId } from '@/lib/offline/step'
import { OpenCountBanner } from '@/features/wms/components/count-together'
import { formatQtyOf } from '@/lib/units'

type ReceiptDoc = Tables<'goods_receipts'> & {
  lines: Tables<'goods_receipt_lines'>[]
  purchase_order: { number: string; currency_code: string; exchange_rate: number } | null
}

export function ReceiptPage() {
  const { id } = useParams()
  const doc = useDocument<ReceiptDoc>('receipts', id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t('Receipt not found')} action={<Button variant="outline" size="sm" onClick={() => window.history.back()}>{t('Back')}</Button>} />
  return <ReceiptForm key={doc.data?.id ?? 'new'} doc={doc.data} />
}

function ReceiptForm({ doc }: { doc?: ReceiptDoc }) {
  const navigate = useNavigate()
  const { company } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const save = useSaveDocument('receipts')
  const post = usePostDocument('receipts')
  const pos = useReceivablePurchaseOrders()
  const locations = useLocations()
  const variants = useVariantOptions()
  const currencies = useCurrencies()
  const editable = !doc || doc.status === 'draft'

  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema),
    disabled: !editable,
    defaultValues: doc ? {
      id: doc.id, warehouse_id: doc.warehouse_id, receipt_type: doc.receipt_type as ReceiptFormValues['receipt_type'],
      purchase_order_id: doc.purchase_order_id, vendor_id: doc.vendor_id, receipt_date: doc.receipt_date,
      vendor_delivery_note: doc.vendor_delivery_note ?? '', currency_code: doc.currency_code, exchange_rate: doc.exchange_rate,
      is_import: doc.is_import, origin_country: doc.origin_country ?? '', customs_declaration_number: doc.customs_declaration_number ?? '',
      customs_declaration_date: doc.customs_declaration_date ?? '', notes: doc.notes ?? '', driver_name: doc.driver_name ?? '',
      lines: doc.lines.map((l) => ({
        po_line_id: l.po_line_id, variant_id: l.variant_id, location_id: l.location_id, lot_id: l.lot_id, quantity: l.quantity,
        unit_price: l.unit_price, qc_status: l.qc_status as 'accepted', temperature: l.temperature, qc_reason: l.qc_reason ?? '',
      })),
    } : {
      warehouse_id: '', receipt_type: 'purchase', purchase_order_id: null, vendor_id: null, receipt_date: todayISO(),
      vendor_delivery_note: '', currency_code: base, exchange_rate: 1, is_import: false, origin_country: '',
      customs_declaration_number: '', customs_declaration_date: '', notes: '', driver_name: '', lines: [],
    },
  })
  useFillUnit((v) => form.setValue('warehouse_id', v), form.getValues('warehouse_id'), !doc)
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const isReturn = form.watch('receipt_type') === 'customer_return'
  const [warehouseId, poId, currency, rate, isImport, watchedLines] = useWatch({
    control: form.control, name: ['warehouse_id', 'purchase_order_id', 'currency_code', 'exchange_rate', 'is_import', 'lines'],
  })
  const selectedPo = pos.data?.find((p) => p.id === poId)
  const trackingOf = (vid?: string) => variants.data?.find((v) => v.id === vid)?.tracking ?? 'none'
  // cold goods: the highest temperature they may arrive at
  const cold = useQuery({
    queryKey: ['cold-products', company?.id], enabled: !!company?.id, staleTime: 5 * 60_000,
    queryFn: async () => new Map(((await supabase.from('products').select('id, max_temperature').eq('company_id', company!.id).not('max_temperature', 'is', null)).data ?? [])
      .map((p) => [p.id, Number(p.max_temperature)])),
  })
  const maxTemp = (vid?: string) => { const pid = variants.data?.find((v) => v.id === vid)?.product_id; return pid ? cold.data?.get(pid) : undefined }
  const hasCold = (watchedLines ?? []).some((l) => maxTemp(l.variant_id) != null)
  const defaultLocation = (wh: string) =>
    locations.data?.find((l) => l.warehouse_id === wh && l.location_type === 'receiving')?.id ??
    locations.data?.find((l) => l.warehouse_id === wh && l.location_type === 'internal')?.id ?? ''

  const applyPo = (poId: string | null) => {
    form.setValue('purchase_order_id', poId)
    const po = pos.data?.find((p) => p.id === poId)
    if (!po) return
    form.setValue('vendor_id', po.vendor_id)
    form.setValue('warehouse_id', po.warehouse_id)
    form.setValue('currency_code', po.currency_code)
    form.setValue('exchange_rate', po.exchange_rate)
    if (po.currency_code !== base) form.setValue('is_import', true)
    const loc = defaultLocation(po.warehouse_id)
    lines.replace(po.lines
      .filter((l) => l.variant_id && num(l.quantity) - num(l.qty_received) > 0)
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ po_line_id: l.id, variant_id: l.variant_id!, location_id: loc, lot_id: null, quantity: num(l.quantity) - num(l.qty_received), unit_price: null, qc_status: 'accepted' as const, temperature: null, qc_reason: '' })))
  }

  const poLine = (lineId?: string | null) => selectedPo?.lines.find((l) => l.id === lineId)
  const linePrice = (i: number) => {
    const l = watchedLines?.[i]
    if (!l) return 0
    if (l.unit_price !== null && l.unit_price !== undefined && String(l.unit_price) !== '') return num(l.unit_price)
    const pl = poLine(l.po_line_id)
    return pl ? num(pl.unit_price) * (1 - num(pl.discount_pct) / 100) : 0
  }
  const total = (watchedLines ?? []).reduce((s, l, i) => s + (l.qc_status === 'rejected' ? 0 : num(l.quantity) * linePrice(i)), 0)
  const foreign = currency && currency !== base

  const persist = async (v: ReceiptFormValues) => {
    const { lines: ls, id: docId, ...header } = v
    return save.mutateAsync({
      header: {
        ...header, id: docId ?? doc?.id, vendor_delivery_note: header.vendor_delivery_note || null, origin_country: header.origin_country || null,
        customs_declaration_number: header.customs_declaration_number || null, customs_declaration_date: header.customs_declaration_date || null,
        notes: header.notes || null, driver_name: header.driver_name || null,
      },
      children: { goods_receipt_lines: ls.map((l) => ({ ...l, lot_id: l.lot_id || null, po_line_id: l.po_line_id || null, temperature: l.temperature ?? null, qc_reason: l.qc_reason || null })) },
      label: t('Goods receipt {ref}: {n} lines', { ref: header.vendor_delivery_note || doc?.number || '', n: ls.length }),
    })
  }
  const onSave = form.handleSubmit(async (v) => {
    const newId = await persist(v)
    if (isOfflineId(newId)) { toast.success(t('Saved on this device'), { description: t('It is sent when the connection is back.') }); navigate('/inventory/receipts'); return }
    toast.success(t('Draft saved'))
    if (!doc) navigate(`/inventory/receipts/${newId}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))

  const onPost = async () => {
    let savedId: string | undefined
    await form.handleSubmit(async (v) => { savedId = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    if (!savedId) throw new Error('invalid')
    const res = await post.mutateAsync(savedId)
    if (res.status === 'queued') {
      toast.success(t('Saved on this device'), { description: t('The goods are received in the stock when the connection is back.') })
      navigate('/inventory/receipts'); return
    }
    const d = res.detail as { total_value?: number; clearance_status?: string } | undefined
    toast.success(t('Goods received'), {
      description: d?.clearance_status === 'pending'
        ? t('{amount} added to the stock value and average costs updated. Add the landed cost once customs is cleared.', { amount: formatMoney(d?.total_value, base) })
        : t('{amount} added to the stock value and average costs updated.', { amount: formatMoney(d?.total_value, base) }),
    })
    navigate(`/inventory/receipts/${savedId}`, { replace: true })
  }

  const posted = doc && doc.status === 'done'

  return (
    <Form {...form}>
      <DocumentShell
        kind="receipts"
        doc={doc}
        newTitle={t('New goods receipt')}
        writePerm="wms.write"
        saving={save.isPending}
        posting={post.isPending}
        onSave={() => void onSave()}
        onPost={onPost}
        postLabel={t('Receive goods')}
        postConfirm={<>{t('Stock is added to the selected locations and the weighted average cost of each product is recalculated. Posted receipts can\'t be edited.')}</>}
        banner={<>{posted && <ReceiptReportCard receiptId={doc.id} version={doc.updated_at} />}{posted && <ReceiptAfterActions doc={doc} nameOf={(v) => variants.data?.find((x) => x.id === v)?.name ?? ''} />}{posted && doc.is_import && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
            <Globe2 className="size-4 text-warning" />
            <span className="flex-1">
              {tr('Imported goods · customs declaration {number} · clearance {status}', { number: <strong>{doc.customs_declaration_number}</strong>, status: <StatusBadge status={doc.clearance_status} /> })}
            </span>
            {doc.clearance_status === 'pending' && (
              <Can perm="procurement.write">
                <Button size="sm" variant="outline" asChild><Link to={`/inventory/landed-costs/new?receipt=${doc.id}`}><Ship /> {t('Add landed cost')}</Link></Button>
              </Can>
            )}
          </div>
        )}</>}
        lines={
        <LinesCard
            title={t('Products received')}
            error={form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message}
            action={editable && (
              <Button type="button" size="sm" variant="outline" disabled={!warehouseId}
                onClick={() => lines.append({ po_line_id: null, variant_id: '', location_id: defaultLocation(warehouseId), lot_id: null, quantity: 1, unit_price: null, qc_status: 'accepted', temperature: null, qc_reason: '' })}>
                <Plus /> {t('Add line')}
              </Button>
            )}
          >
            {lines.fields.length === 0 ? (
              <EmptyState compact title={warehouseId ? t('No lines yet') : t('Choose a warehouse first')} description={t('Pick a purchase order to load its lines, or add products one by one. Scanning a barcode into the product field works too.')} />
            ) : (
              <Table className={hasCold ? 'min-w-[1180px]' : 'min-w-[1040px]'}>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[200px]">{t('Product')}</TableHead>
                  <TableHead className="min-w-[150px]">{t('Location')}</TableHead>
                  <TableHead className="min-w-[150px]">{t('Lot')}</TableHead>
                  <TableHead className="min-w-[110px] text-right">{t('Qty')}</TableHead>
                  <TableHead className="min-w-[150px] text-right">{t('Unit price without VAT ({currency})', { currency: currency ?? base ?? '' })}</TableHead>
                  {hasCold && <TableHead className="min-w-[100px]">°C</TableHead>}
                  <TableHead className="min-w-[150px]">QC</TableHead>
                  <TableHead className="w-28 text-right">{posted ? t('Unit cost without VAT ({currency})', { currency: base ?? '' }) : t('Line value (without VAT)')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>
                  {lines.fields.map((f, i) => {
                    const l = watchedLines?.[i]
                    const pl = poLine(l?.po_line_id)
                    const postedLine = posted ? doc.lines[i] : undefined
                    return (
                      <TableRow key={f.id} className="align-top hover:bg-transparent">
                        <TableCell>
                          <FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (
                            <FormItem><FormControl><VariantPicker value={field.value} onChange={(v) => field.onChange(v ?? '')} disabled={field.disabled || !!l?.po_line_id} /></FormControl><FormMessage /></FormItem>
                          )} />
                          {pl && <p className="mt-1 text-xs text-muted-foreground">{t('Order line {n}: {qty} still to receive', { n: pl.line_no, qty: formatQtyOf(num(pl.quantity) - num(pl.qty_received), l?.variant_id) })}</p>}
                        </TableCell>
                        <TableCell>
                          <FormField control={form.control} name={`lines.${i}.location_id`} render={({ field }) => (
                            <FormItem><FormControl><LocationPicker warehouseId={warehouseId} value={field.value} onChange={(v) => field.onChange(v ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>
                          )} />
                        </TableCell>
                        <TableCell>
                          {trackingOf(l?.variant_id) !== 'none' ? (
                            <FormField control={form.control} name={`lines.${i}.lot_id`} render={({ field }) => (
                              <FormItem><FormControl><LotPicker variantId={l?.variant_id} value={field.value} onChange={field.onChange} disabled={field.disabled} allowCreate /></FormControl><FormMessage /></FormItem>
                            )} />
                          ) : <span className="text-xs text-muted-foreground">{t('Not tracked')}</span>}
                        </TableCell>
                        <TableCell>
                          <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                            <FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[88px] text-right" aria-label={t('Quantity, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                        </TableCell>
                        <TableCell>
                          <FormField control={form.control} name={`lines.${i}.unit_price`} render={({ field }) => (
                            <FormItem><FormControl>
                              <Input type="number" step="any" min="0" className="h-9 min-w-[88px] text-right" name={field.name} aria-label={t('Unit price without VAT, line {n}', { n: i + 1 })}
                                value={isReturn ? '' : field.value ?? ''} onChange={field.onChange} disabled={field.disabled || isReturn}
                                title={isReturn ? t('A return comes back at the average cost') : undefined}
                                placeholder={isReturn ? t('Average cost') : pl ? formatMoney(num(pl.unit_price) * (1 - num(pl.discount_pct) / 100)) : '0.00'} />
                            </FormControl><FormMessage /></FormItem>
                          )} />
                        </TableCell>
                        {hasCold && <TableCell>
                          {maxTemp(l?.variant_id) != null ? (
                            <FormField control={form.control} name={`lines.${i}.temperature`} render={({ field }) => {
                              const warm = field.value != null && String(field.value) !== '' && num(field.value) > maxTemp(l?.variant_id)!
                              return (
                                <FormItem><FormControl>
                                  <Input type="number" step="0.1" className={cn('h-9 min-w-[72px] text-right', warm && 'border-destructive text-destructive')} name={field.name}
                                    aria-label={t('Temperature at the door, line {n}', { n: i + 1 })} placeholder={t('max {v}', { v: maxTemp(l?.variant_id)! })}
                                    value={field.value ?? ''} onChange={field.onChange} disabled={field.disabled} />
                                </FormControl>
                                {warm && l?.qc_status !== 'rejected' && <p className="text-xs text-destructive">{t('Too warm: refuse it')}</p>}
                                {!warm && (field.value == null || String(field.value) === '') && editable && <p className="flex items-center gap-0.5 text-xs text-muted-foreground"><Thermometer className="size-3" />{t('Cold item')}</p>}</FormItem>
                              )
                            }} />
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>}
                        <TableCell>
                          <FormField control={form.control} name={`lines.${i}.qc_status`} render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}>
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="accepted">{tEnum('accepted')}</SelectItem><SelectItem value="pending">{tEnum('pending')}</SelectItem><SelectItem value="rejected">{tEnum('rejected')}</SelectItem></SelectContent>
                            </Select>
                          )} />
                          {l?.qc_status === 'rejected' && (
                            <FormField control={form.control} name={`lines.${i}.qc_reason`} render={({ field }) => (
                              <FormItem className="mt-1"><FormControl><Input className="h-8 min-w-[140px] text-xs" placeholder={t('Why: damaged, warm, expired…')} aria-label={t('Why it was refused, line {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                          )}
                        </TableCell>
                        <TableCell className="pt-4 text-right tabular text-[13px]">
                          {postedLine ? (
                            <>{formatMoney(postedLine.unit_cost)}{num(postedLine.landed_cost_amount) > 0 && <div className="text-xs text-muted-foreground">{t('+ {amount} landed cost', { amount: formatMoney(postedLine.landed_cost_amount) })}</div>}</>
                          ) : formatMoney(l?.qc_status === 'rejected' ? 0 : num(l?.quantity) * linePrice(i))}
                        </TableCell>
                        <TableCell>
                          {editable && <Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </LinesCard>
        }
        summary={
          <SummaryCard
            rows={[
              [t('Lines'), (watchedLines ?? []).length],
              [t('Units'), formatQty((watchedLines ?? []).reduce((s, l) => s + num(l.quantity), 0))],
              [t('Value without VAT ({currency})', { currency: currency ?? base ?? '' }), formatMoney(total, currency ?? base)],
              ...(foreign ? [[t('Value without VAT ({currency})', { currency: base ?? '' }), formatMoney(total * num(rate), base)] as [string, string]] : []),
              ...(posted ? [[t('Recorded value at purchase price (without VAT)'), formatMoney(doc.total_value, base)] as [string, string]] : []),
              ...(doc?.purchase_order_id && doc.purchase_order
                ? [[t('Purchase order'), <Link key="po" className="text-primary hover:underline" to={`/procurement/orders/${doc.purchase_order_id}`}>{doc.purchase_order.number}</Link>] as [string, React.ReactNode]]
                : []),
            ]}
            footer={foreign
              ? t('Valued at the customs exchange rate (1 {currency} = {rate} {base}). Import VAT goes on the vendor or customs bill, not into the stock cost.', { currency: currency ?? '', rate: String(rate ?? ''), base: base ?? '' })
              : t('Prices are without VAT. Deductible VAT never becomes part of the stock cost.')}
          />
        }
      >
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {editable && <OpenCountBanner warehouseId={warehouseId} className="sm:col-span-2 lg:col-span-3" />}
            <FormField control={form.control} name="receipt_type" render={({ field }) => (
              <FormItem><FormLabel>{t('Receipt type')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="purchase">{t('From vendor')}</SelectItem><SelectItem value="customer_return">{t('Customer return')}</SelectItem><SelectItem value="other">{t('Other')}</SelectItem></SelectContent>
                </Select></FormItem>
            )} />
            <FormField control={form.control} name="purchase_order_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Purchase order')}</FormLabel>
                <FormControl>
                  <SearchSelect value={field.value} onChange={applyPo} clearable disabled={field.disabled} placeholder={t('Receive without PO')}
                    options={(pos.data ?? []).map((p) => ({ value: p.id, label: p.number, hint: (p.vendor as { name: string } | null)?.name }))}
                    emptyText={t('No approved purchase orders waiting.')} />
                </FormControl>
                <FormDescription>{t('Lines and prices come from the order.')}</FormDescription></FormItem>
            )} />
            <FormField control={form.control} name="vendor_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Vendor')}</FormLabel><FormControl><VendorPicker value={field.value} onChange={field.onChange} disabled={field.disabled || !!poId} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('Warehouse')}</FormLabel><FormControl>
                <WarehousePicker value={field.value} disabled={field.disabled} onChange={(v) => {
                  field.onChange(v ?? '')
                  const loc = v ? defaultLocation(v) : ''
                  form.getValues('lines').forEach((_, i) => form.setValue(`lines.${i}.location_id`, loc))
                }} />
              </FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="receipt_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Receipt date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="vendor_delivery_note" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Delivery note no.')}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="driver_name" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Driver')}</FormLabel><FormControl><Input placeholder={t('Who brought the goods')} {...field} /></FormControl></FormItem>
            )} />
            <div className="grid grid-cols-[110px_1fr] gap-2 sm:col-span-2 lg:col-span-1">
              <FormField control={form.control} name="currency_code" render={({ field }) => (
                <FormItem><FormLabel>{t('Currency')}</FormLabel>
                  <Select value={field.value ?? base} onValueChange={(v) => { field.onChange(v); if (v === base) form.setValue('exchange_rate', 1) }} disabled={field.disabled || !!poId}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
              <FormField control={form.control} name="exchange_rate" render={({ field }) => (
                <FormItem><FormLabel>{foreign ? t('Customs rate') : t('Exchange rate')}</FormLabel>
                  <FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={field.onChange} disabled={field.disabled || !foreign} /></FormControl>
                  <FormDescription>{foreign ? `${base} per 1 ${currency}` : t('Base currency')}</FormDescription><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="is_import" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-3">
                <label className="flex items-center gap-2 text-sm"><Switch checked={field.value} onCheckedChange={field.onChange} disabled={field.disabled} /> {t('Imported goods — freight and customs will be added as a landed cost after clearance')}</label>
              </FormItem>
            )} />
            {isImport && (
              <>
                <FormField control={form.control} name="customs_declaration_number" render={({ field }) => (
                  <FormItem><FormLabel>{t('Customs declaration (DUD)')}</FormLabel><FormControl><Input placeholder={t('e.g. 2026/AL/118734')} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="customs_declaration_date" render={({ field }) => (
                  <FormItem><FormLabel optional>{t('Declaration date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="origin_country" render={({ field }) => (
                  <FormItem><FormLabel optional>{t('Country of origin')}</FormLabel><FormControl><Input maxLength={2} placeholder={t('IT')} {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl></FormItem>
                )} />
              </>
            )}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-3"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>

      </DocumentShell>
    </Form>
  )
}
