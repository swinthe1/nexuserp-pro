import { zodResolver } from '@/lib/zod-resolver'
import { useFillUnit } from '@/app/active-unit'
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useDocument, useLocations, usePostDocument, useSaveDocument, useStockLevels, useVariantOptions } from '../api'
import { DocumentShell, LinesCard, SummaryCard } from '../components/document-shell'
import { LocationPicker, LotPicker, VariantPicker, WarehousePicker } from '../components/pickers'
import { adjustmentSchema, type AdjustmentFormValues } from '../schemas'
import { msg, t } from '@/i18n'
import { ErrorState } from '@/components/error-state'
import { formatQtyOf } from '@/lib/units'

type AdjustmentDoc = Tables<'stock_adjustments'> & { lines: Tables<'stock_adjustment_lines'>[] }

export const ADJUSTMENT_REASONS: Record<AdjustmentFormValues['reason'], string> = {
  opening: msg('Opening stock'),
  count: msg('Stock count result'),
  correction: msg('Correction'),
  found: msg('Found stock'),
  damage: msg('Damaged (to scrap)'),
  expiry: msg('Expired (to scrap)'),
  loss: msg('Loss or shrinkage'),
  theft: msg('Theft'),
  waste: msg('Thrown away (to scrap)'),
  internal_use: msg('Used in the company'),
}

export function AdjustmentPage() {
  const { id } = useParams()
  const doc = useDocument<AdjustmentDoc>('adjustments', id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t('Adjustment not found')} action={<Button variant="outline" size="sm" onClick={() => window.history.back()}>{t('Back')}</Button>} />
  return <AdjustmentForm key={doc.data?.id ?? 'new'} doc={doc.data} />
}

function AdjustmentForm({ doc }: { doc?: AdjustmentDoc }) {
  const navigate = useNavigate()
  const { company } = useCompany()
  const save = useSaveDocument('adjustments')
  const post = usePostDocument('adjustments')
  const variants = useVariantOptions()
  const levels = useStockLevels()
  const locations = useLocations()
  const editable = !doc || doc.status === 'draft'

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    disabled: !editable,
    defaultValues: doc
      ? { id: doc.id, warehouse_id: doc.warehouse_id, adjustment_date: doc.adjustment_date, reason: doc.reason as AdjustmentFormValues['reason'], notes: doc.notes ?? '',
          lines: doc.lines.map((l) => ({ variant_id: l.variant_id, location_id: l.location_id, lot_id: l.lot_id, quantity_change: l.quantity_change, unit_cost: l.unit_cost })) }
      : { warehouse_id: '', adjustment_date: todayISO(), reason: 'correction', notes: '', lines: [] },
  })
  useFillUnit((v) => form.setValue('warehouse_id', v), form.getValues('warehouse_id'), !doc)
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const [warehouseId, reason, watched] = useWatch({ control: form.control, name: ['warehouse_id', 'reason', 'lines'] })
  const variantOf = (id?: string) => variants.data?.find((v) => v.id === id)
  const onHandAt = (variantId?: string, locationId?: string, lotId?: string | null) =>
    (levels.data ?? []).filter((l) => l.variant_id === variantId && l.location_id === locationId && (l.lot_id ?? null) === (lotId ?? null))
      .reduce((s, l) => s + num(l.on_hand), 0)
  const estimate = (watched ?? []).reduce((s, l) => s + num(l.quantity_change) * (l.unit_cost !== null && l.unit_cost !== undefined && String(l.unit_cost) !== '' ? num(l.unit_cost) : num(variantOf(l.variant_id)?.avg_cost)), 0)
  const defaultLocation = (wh: string) => locations.data?.find((l) => l.warehouse_id === wh && l.location_type === 'internal')?.id ?? ''

  const persist = (v: AdjustmentFormValues) => {
    const { lines: ls, id: docId, ...header } = v
    return save.mutateAsync({
      header: { ...header, id: docId ?? doc?.id, notes: header.notes || null },
      children: { stock_adjustment_lines: ls.map((l) => ({ ...l, lot_id: l.lot_id || null, unit_cost: l.quantity_change > 0 ? l.unit_cost : null })) },
    })
  }
  const onSave = form.handleSubmit(async (v) => {
    const id = await persist(v)
    toast.success(t('Draft saved'))
    if (!doc) navigate(`/inventory/adjustments/${id}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))
  const onPost = async () => {
    let id: string | undefined = doc?.status === 'approved' ? doc.id : undefined
    if (!id) await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    if (!id) throw new Error('invalid')
    const r = await post.mutateAsync(id)
    if (r.status === 'pending_approval') toast.message(t('Sent for approval'), { description: t('The approver has been told. Complete it again once it is approved.') })
    else toast.success(t('Adjustment completed'), { description: t('Stock and its value were updated.') })
    navigate(`/inventory/adjustments/${id}`, { replace: true })
  }

  const actionLabel = doc?.status === 'approved' ? t('Complete adjustment') : t('Send and complete')

  return (
    <Form {...form}>
      <DocumentShell
        kind="adjustments"
        doc={doc}
        newTitle={t('New stock adjustment')}
        writePerm="inventory.write"
        saving={save.isPending}
        posting={post.isPending}
        onSave={() => void onSave()}
        onPost={onPost}
        postLabel={actionLabel}
        postableStatuses={['draft', 'approved']}
        postConfirm={<>{t('Increases are valued at the cost you enter (or the current average cost); decreases at the current average cost. If this amount needs approval, it goes to the approver first.')}</>}
        lines={
        <LinesCard
            title={t('Lines')}
            error={form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message}
            action={editable && (
              <Button type="button" size="sm" variant="outline" disabled={!warehouseId}
                onClick={() => lines.append({ variant_id: '', location_id: defaultLocation(warehouseId), lot_id: null, quantity_change: reason === 'opening' || reason === 'found' ? 1 : -1, unit_cost: null })}>
                <Plus /> {t('Add line')}
              </Button>
            )}
          >
            {lines.fields.length === 0 ? <EmptyState compact title={warehouseId ? t('No lines yet') : t('Choose a warehouse first')} description={t('Use + for stock found or opening stock, − for losses and damage.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[200px]">{t('Product')}</TableHead><TableHead className="min-w-[150px]">{t('Location')}</TableHead><TableHead className="min-w-[150px]">{t('Lot')}</TableHead>
                  <TableHead className="w-24 text-right">{t('On hand')}</TableHead><TableHead className="w-28 text-right">{t('Change (±)')}</TableHead>
                  <TableHead className="w-32 text-right">{t('Unit cost (without VAT)')}</TableHead><TableHead className="w-28 text-right">{t('After')}</TableHead><TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>
                  {lines.fields.map((f, i) => {
                    const l = watched?.[i]
                    const v = variantOf(l?.variant_id)
                    const oh = onHandAt(l?.variant_id, l?.location_id, l?.lot_id)
                    const after = oh + num(l?.quantity_change)
                    return (
                      <TableRow key={f.id} className="align-top hover:bg-transparent">
                        <TableCell><FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (
                          <FormItem><FormControl><VariantPicker value={field.value} onChange={(x) => field.onChange(x ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.location_id`} render={({ field }) => (
                          <FormItem><FormControl><LocationPicker warehouseId={warehouseId} value={field.value} onChange={(x) => field.onChange(x ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell>{v && v.tracking !== 'none'
                          ? <FormField control={form.control} name={`lines.${i}.lot_id`} render={({ field }) => (<LotPicker variantId={l?.variant_id} value={field.value} onChange={field.onChange} disabled={field.disabled} allowCreate={num(l?.quantity_change) > 0} />)} />
                          : <span className="text-xs text-muted-foreground">{t('Not tracked')}</span>}</TableCell>
                        <TableCell className="pt-4 text-right tabular text-[13px] text-muted-foreground">{doc?.status === 'posted' ? '—' : formatQtyOf(oh, l?.variant_id)}</TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.quantity_change`} render={({ field }) => (
                          <FormItem><FormControl><Input type="number" step="any" className={cn('h-9 min-w-[88px] text-right', num(field.value) < 0 ? 'text-destructive' : 'text-success')} {...field} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.unit_cost`} render={({ field }) => (
                          <FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[88px] text-right" value={field.value ?? ''} onChange={field.onChange}
                            disabled={field.disabled || num(l?.quantity_change) < 0} placeholder={num(l?.quantity_change) < 0 ? t('Average') : formatMoney(v?.avg_cost ?? 0)} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell className={cn('pt-4 text-right tabular text-[13px]', after < 0 && doc?.status !== 'posted' && 'font-medium text-destructive')}>{doc?.status === 'posted' ? '—' : formatQtyOf(after, l?.variant_id)}</TableCell>
                        <TableCell>{editable && <Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button>}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </LinesCard>
        }
        summary={
          <SummaryCard rows={[
            [t('Lines'), (watched ?? []).length],
            [t('Units in'), formatQty((watched ?? []).filter((l) => num(l.quantity_change) > 0).reduce((s, l) => s + num(l.quantity_change), 0))],
            [t('Units out'), formatQty((watched ?? []).filter((l) => num(l.quantity_change) < 0).reduce((s, l) => s - num(l.quantity_change), 0))],
            [doc?.status === 'posted' ? t('Recorded value at purchase price (without VAT)') : t('Estimated value at purchase price (without VAT)'), formatMoney(doc?.status === 'posted' ? doc.total_value : estimate, company?.base_currency)],
          ]} footer={doc?.status === 'pending_approval' ? t('Waiting for approval. You will be notified when it is decided.') : t('Damaged and expired goods go to the scrap location; the rest to the adjustment location.')} />
        }
      >
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
            <FormField control={form.control} name="warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('Warehouse')}</FormLabel><FormControl>
                <WarehousePicker value={field.value} disabled={field.disabled} onChange={(v) => {
                  field.onChange(v ?? '')
                  form.getValues('lines').forEach((_, i) => form.setValue(`lines.${i}.location_id`, v ? defaultLocation(v) : ''))
                }} />
              </FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="reason" render={({ field }) => (
              <FormItem><FormLabel>{t('Reason')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{Object.entries(ADJUSTMENT_REASONS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent></Select>
                {reason === 'opening' && <FormDescription>{t('Enter each line\'s unit cost — it sets the starting average.')}</FormDescription>}
              </FormItem>
            )} />
            <FormField control={form.control} name="adjustment_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-3"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} placeholder={t('Why the stock changed — shown to approvers and auditors')} {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>

      </DocumentShell>
    </Form>
  )
}
