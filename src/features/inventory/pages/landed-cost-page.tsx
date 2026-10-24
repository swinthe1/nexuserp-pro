import { zodResolver } from '@hookform/resolvers/zod'
import { Globe2, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useDocument, usePostDocument, usePostedReceipts, useSaveDocument } from '../api'
import { DocumentShell, LinesCard, SummaryCard } from '../components/document-shell'
import { landedCostSchema, type LandedCostFormValues } from '../schemas'
import { msg, t, tEnum } from '@/i18n'
import { ErrorState } from '@/components/error-state'

type Allocation = Tables<'landed_cost_allocations'> & { line: { quantity: number; unit_cost: number | null; variant: { sku: string; name: string } } }
type LandedDoc = Tables<'landed_costs'> & {
  charges: Tables<'landed_cost_charges'>[]
  receipts: Tables<'landed_cost_receipts'>[]
  allocations: Allocation[]
}

const METHOD_HELP: Record<LandedCostFormValues['allocation_method'], string> = {
  value: msg('In proportion to each line’s value — the usual choice for customs duty and insurance.'),
  quantity: msg('Per unit received.'),
  weight: msg('By weight (needs product weights) — the usual choice for transport.'),
  volume: msg('By volume (needs product volumes) — for bulky goods.'),
  equal: msg('Split equally across the lines.'),
}

export function LandedCostPage() {
  const { id } = useParams()
  const doc = useDocument<LandedDoc>('landed-costs', id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t('Landed cost not found')} action={<Button variant="outline" size="sm" onClick={() => window.history.back()}>{t('Back')}</Button>} />
  return <LandedCostForm key={doc.data?.id ?? 'new'} doc={doc.data} />
}

function LandedCostForm({ doc }: { doc?: LandedDoc }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company } = useCompany()
  const base = company?.base_currency
  const save = useSaveDocument('landed-costs')
  const post = usePostDocument('landed-costs')
  const receipts = usePostedReceipts()
  const editable = !doc || doc.status === 'draft'

  const form = useForm<LandedCostFormValues>({
    resolver: zodResolver(landedCostSchema),
    disabled: !editable,
    defaultValues: doc
      ? { id: doc.id, landed_cost_date: doc.landed_cost_date, allocation_method: doc.allocation_method as LandedCostFormValues['allocation_method'], notes: doc.notes ?? '',
          customs_declaration_number: doc.customs_declaration_number ?? '', customs_declaration_date: doc.customs_declaration_date ?? '',
          customs_value: num(doc.customs_value), import_vat_rate: num(doc.import_vat_rate) || (company?.country_code === 'XK' ? 18 : 20), import_vat: num(doc.import_vat),
          receipt_ids: doc.receipts.map((r) => r.receipt_id),
          charges: doc.charges.map((c) => ({ charge_type: c.charge_type as 'freight', description: c.description ?? '', amount: c.amount })) }
      : { landed_cost_date: todayISO(), allocation_method: 'value', notes: '', receipt_ids: params.get('receipt') ? [params.get('receipt')!] : [],
          customs_declaration_number: '', customs_declaration_date: '', customs_value: 0, import_vat_rate: company?.country_code === 'XK' ? 18 : 20, import_vat: 0,
          charges: [{ charge_type: 'freight', description: '', amount: 0 }, { charge_type: 'customs', description: t('Customs duty'), amount: 0 }] },
  })
  const charges = useFieldArray({ control: form.control, name: 'charges' })
  const [method, selected, watchedCharges, customsValue, vatRate] = useWatch({ control: form.control, name: ['allocation_method', 'receipt_ids', 'charges', 'customs_value', 'import_vat_rate'] })
  const suggestedVat = Math.round(num(customsValue) * num(vatRate)) / 100
  const total = (watchedCharges ?? []).reduce((s, c) => s + num(c.amount), 0)
  const linked = React.useMemo(() => new Set(doc?.receipts.map((r) => r.receipt_id) ?? []), [doc])
  // once posted, show only the receipts it was applied to
  const receiptList = React.useMemo(() => [...(receipts.data ?? [])]
    .filter((r) => editable || linked.has(r.id))
    .sort((a, b) => Number(b.clearance_status === 'pending') - Number(a.clearance_status === 'pending')), [receipts.data, editable, linked])

  const persist = (v: LandedCostFormValues) => {
    const { charges: cs, receipt_ids, id: docId, ...header } = v
    return save.mutateAsync({
      header: { ...header, id: docId ?? doc?.id, notes: header.notes || null,
                customs_declaration_number: header.customs_declaration_number || null, customs_declaration_date: header.customs_declaration_date || null,
                customs_value: num(header.customs_value), import_vat_rate: num(header.import_vat_rate), import_vat: num(header.import_vat) },
      children: {
        landed_cost_charges: cs.map((c) => ({ ...c, description: c.description || null })),
        landed_cost_receipts: receipt_ids.map((receipt_id) => ({ receipt_id })),
      },
    })
  }
  const onSave = form.handleSubmit(async (v) => {
    const id = await persist(v)
    toast.success(t('Draft saved'))
    if (!doc) navigate(`/inventory/landed-costs/${id}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))
  const onPost = async () => {
    let id: string | undefined
    await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    if (!id) throw new Error('invalid')
    const r = await post.mutateAsync(id)
    const d = r.detail as { capitalized: number; expensed: number }
    toast.success(t('Landed cost recorded'), {
      description: d.expensed > 0
        ? t('{amount} added to the stock value; {expensed} is for goods already sold and was booked as an expense.', { amount: formatMoney(d.capitalized, base), expensed: formatMoney(d.expensed, base) })
        : t('{amount} added to the stock value.', { amount: formatMoney(d.capitalized, base) }),
    })
    navigate(`/inventory/landed-costs/${id}`, { replace: true })
  }

  const allocTotals = (doc?.allocations ?? []).reduce((s, a) => ({ cap: s.cap + num(a.capitalized_amount), exp: s.exp + num(a.expensed_amount) }), { cap: 0, exp: 0 })

  return (
    <Form {...form}>
      <DocumentShell
        kind="landed-costs" doc={doc} newTitle={t('New landed cost')} writePerm="procurement.write"
        saving={save.isPending} posting={post.isPending} onSave={() => void onSave()} onPost={onPost}
        postLabel={t('Spread and record')}
        postConfirm={t('The total is spread over the lines of the selected receipts ({method}). The share for goods still in stock raises their average cost; the share for goods already sold is booked as an expense. Import receipts are marked as cleared.', { method: tEnum(`alloc_${method}`).toLowerCase() })}
        lines={<>
        <LinesCard
            title={t('Charges')}
            error={form.formState.errors.charges?.root?.message ?? form.formState.errors.charges?.message}
            action={editable && <Button type="button" size="sm" variant="outline" onClick={() => charges.append({ charge_type: 'other', description: '', amount: 0 })}><Plus /> {t('Add charge')}</Button>}
          >
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-44">{t('Type')}</TableHead><TableHead>{t('Description')}</TableHead><TableHead className="w-40 text-right">{t('Amount ({currency})', { currency: base ?? '' })}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
              <TableBody>
                {charges.fields.map((f, i) => (
                  <TableRow key={f.id} className="align-top hover:bg-transparent">
                    <TableCell><FormField control={form.control} name={`charges.${i}.charge_type`} render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>{['freight', 'customs', 'insurance', 'handling', 'storage', 'other'].map((c) => <SelectItem key={c} value={c}>{tEnum(`charge_${c}`)}</SelectItem>)}</SelectContent></Select>)} /></TableCell>
                    <TableCell><FormField control={form.control} name={`charges.${i}.description`} render={({ field }) => (<FormItem><FormControl><Input className="h-9" {...field} /></FormControl></FormItem>)} /></TableCell>
                    <TableCell><FormField control={form.control} name={`charges.${i}.amount`} render={({ field }) => (<FormItem><FormControl><Input type="number" step="0.01" min="0" className="h-9 min-w-[88px] text-right" {...field} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                    <TableCell>{editable && <Button type="button" variant="ghost" size="icon-sm" onClick={() => charges.remove(i)} aria-label={t('Remove charge')}><Trash2 /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow className="hover:bg-transparent"><TableCell colSpan={2}>{t('Total')}</TableCell><TableCell className="text-right tabular">{formatMoney(total)}</TableCell><TableCell /></TableRow></TableFooter>
            </Table>
          </LinesCard>
        <Card className="mt-4">
            <CardHeader><CardTitle>{t('Receipts this cost applies to')}</CardTitle><CardDescription>{t('Imports still waiting for customs clearance are listed first.')}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <FormField control={form.control} name="receipt_ids" render={({ field }) => (
                <FormItem>
                  {receiptList.length === 0 ? <EmptyState compact title={t('No posted receipts')} description={t('Receive the goods first, then add their landed cost.')} /> : (
                    <Table>
                      <TableBody>
                        {receiptList.map((r) => {
                          const on = field.value.includes(r.id)
                          return (
                            <TableRow key={r.id} className={cn('hover:bg-transparent', on && 'bg-accent/40')}>
                              <TableCell className="w-10"><Checkbox checked={on} disabled={field.disabled} aria-label={t('Apply to {number}', { number: r.number })}
                                onCheckedChange={(c) => field.onChange(c ? [...field.value, r.id] : field.value.filter((x) => x !== r.id))} /></TableCell>
                              <TableCell><Link to={`/inventory/receipts/${r.id}`} className="font-medium hover:underline">{r.number}</Link>
                                <div className="text-xs text-muted-foreground">{(r.vendor as { name: string } | null)?.name ?? t('No vendor')} · {formatDate(r.receipt_date)}</div></TableCell>
                              <TableCell className="text-[13px]">{r.is_import && <span className="inline-flex items-center gap-1"><Globe2 className="size-3.5 text-muted-foreground" />{r.customs_declaration_number}</span>}</TableCell>
                              <TableCell>{r.is_import && <StatusBadge status={r.clearance_status} />}</TableCell>
                              <TableCell className="text-right tabular">{formatMoney(r.total_value, base)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                  <FormMessage className="px-4 pb-3" />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {doc?.status === 'posted' && doc.allocations.length > 0 && (
            <Card className="mt-4">
              <CardHeader><CardTitle>{t('Allocation')}</CardTitle><CardDescription>{t('How the {amount} was spread', { amount: formatMoney(doc.total_amount, base) })}</CardDescription></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Product')}</TableHead><TableHead className="text-right">{t('Qty received')}</TableHead><TableHead className="text-right">{t('Allocated')}</TableHead><TableHead className="text-right">{t('Into stock')}</TableHead><TableHead className="text-right">{t('Booked as expense')}</TableHead><TableHead className="text-right">{t('Per unit')}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {doc.allocations.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell><span className="font-medium">{a.line.variant.sku}</span> <span className="text-muted-foreground">{a.line.variant.name}</span></TableCell>
                        <TableCell className="text-right tabular">{formatQty(a.line.quantity)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(a.allocated_amount)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(a.capitalized_amount)}</TableCell>
                        <TableCell className={cn('text-right tabular', num(a.expensed_amount) > 0 && 'text-warning')}>{formatMoney(a.expensed_amount)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(num(a.allocated_amount) / num(a.line.quantity))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>}
        summary={<SummaryCard rows={[
          [t('Goods receipts'), (selected ?? []).length],
          [t('Charges'), formatMoney(total, base)],
          ...(doc?.status === 'posted' ? [[t('Added to stock value'), formatMoney(allocTotals.cap, base)], [t('Expense (goods sold)'), formatMoney(allocTotals.exp, base)]] as [string, string][] : []),
          ...(num(doc?.import_vat) > 0 ? [[t('Import VAT (deductible)'), formatMoney(doc!.import_vat, base)]] as [string, string][] : []),
        ]} footer={t('Charges are in the base currency, without VAT. Import VAT from the customs declaration can be deducted: it goes to the purchase book, not into the stock value.')} />}
      >
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-[180px_1fr]">
            <FormField control={form.control} name="landed_cost_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="allocation_method" render={({ field }) => (
              <FormItem><FormLabel>{t('Split by')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{(['value', 'weight', 'quantity', 'volume', 'equal'] as const).map((m) => <SelectItem key={m} value={m}>{tEnum(`alloc_${m}`)}</SelectItem>)}</SelectContent></Select>
                <FormDescription>{t(METHOD_HELP[field.value])}</FormDescription></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} placeholder={t('Forwarder invoice, customs declaration…')} {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader><CardTitle>{t('Customs declaration')}</CardTitle>
            <CardDescription>{t('For imports: the DUD number and the VAT paid at the border. It is listed in the purchase book under imports and deducted in the VAT return of the declaration date.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormField control={form.control} name="customs_declaration_number" render={({ field }) => (
              <FormItem className="lg:col-span-2"><FormLabel optional>{t('DUD number')}</FormLabel><FormControl><Input className="font-mono" placeholder={t('e.g. 26AL0102C001234')} {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="customs_declaration_date" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Declaration date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="customs_value" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Value for VAT')}</FormLabel><FormControl><Input type="number" min={0} step="0.01" className="tabular" {...field} value={field.value ?? ''} /></FormControl>
                <FormDescription>{t('Customs value plus duty.')}</FormDescription></FormItem>
            )} />
            <FormField control={form.control} name="import_vat_rate" render={({ field }) => (
              <FormItem><FormLabel>{t('VAT rate, %')}</FormLabel><FormControl><Input type="number" min={0} max={100} step="0.01" className="tabular" {...field} value={field.value ?? ''} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="import_vat" render={({ field }) => (
              <FormItem className="lg:col-start-5"><FormLabel optional>{t('Import VAT paid')}</FormLabel>
                <FormControl><Input type="number" min={0} step="0.01" className="tabular" placeholder={suggestedVat ? suggestedVat.toFixed(2) : '0.00'} {...field} value={field.value || ''} /></FormControl>
                <FormDescription>{suggestedVat ? t('If empty: {amount}.', { amount: formatMoney(suggestedVat, base) }) : t('If empty: value × rate.')}</FormDescription></FormItem>
            )} />
          </CardContent>
        </Card>


      </DocumentShell>
    </Form>
  )
}
