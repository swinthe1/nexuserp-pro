import { zodResolver } from '@hookform/resolvers/zod'
import { useFillUnit } from '@/app/active-unit'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatQty, num, todayISO } from '@/lib/utils'
import { useDocument, useLocations, usePostDocument, useSaveDocument, useShipTransfer, useVariantOptions, useWarehouseLevels } from '../api'
import { ReceiveTransferCard } from '../components/receive-transfer'
import { Switch } from '@/components/ui/switch'
import { DocumentShell, LinesCard, SummaryCard } from '../components/document-shell'
import { LocationPicker, LotPicker, VariantPicker, WarehousePicker } from '../components/pickers'
import { transferSchema, type TransferFormValues } from '../schemas'
import { t } from '@/i18n'
import { ErrorState } from '@/components/error-state'

type TransferDoc = Tables<'stock_transfers'> & { lines: Tables<'stock_transfer_lines'>[] }

export function TransferPage() {
  const { id } = useParams()
  const doc = useDocument<TransferDoc>('transfers', id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t('Transfer not found')} action={<Button variant="outline" size="sm" onClick={() => window.history.back()}>{t('Back')}</Button>} />
  return <TransferForm key={doc.data?.id ?? 'new'} doc={doc.data} />
}

function TransferForm({ doc }: { doc?: TransferDoc }) {
  const navigate = useNavigate()
  const save = useSaveDocument('transfers')
  const post = usePostDocument('transfers')
  const variants = useVariantOptions()
  const locations = useLocations()
  const ship = useShipTransfer()
  const editable = !doc || doc.status === 'draft'

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    disabled: !editable,
    defaultValues: doc
      ? { id: doc.id, from_warehouse_id: doc.from_warehouse_id, to_warehouse_id: doc.to_warehouse_id, transfer_date: doc.transfer_date, notes: doc.notes ?? '', is_request: doc.is_request,
          lines: doc.lines.map((l) => ({ variant_id: l.variant_id, from_location_id: l.from_location_id, to_location_id: l.to_location_id, lot_id: l.lot_id, quantity: l.quantity })) }
      : { from_warehouse_id: '', to_warehouse_id: '', transfer_date: todayISO(), notes: '', is_request: false, lines: [] },
  })
  // a transfer goes out of the unit one works in
  useFillUnit((v) => form.setValue('from_warehouse_id', v), form.getValues('from_warehouse_id'), !doc)
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const [fromWh, toWh, watched] = useWatch({ control: form.control, name: ['from_warehouse_id', 'to_warehouse_id', 'lines'] })
  const levels = useWarehouseLevels(editable ? fromWh || undefined : undefined)
  // between two stores the goods travel (ship, then the other store receives); inside one store they move at once
  const betweenStores = !!fromWh && !!toWh && fromWh !== toWh
  const stockLoc = (wh: string) => locations.data?.find((l) => l.warehouse_id === wh && l.location_type === 'internal')?.id ?? ''
  const availableAt = (variantId?: string, loc?: string, lot?: string | null) =>
    (levels.data ?? []).filter((l) => l.variant_id === variantId && l.location_id === loc && (l.lot_id ?? null) === (lot ?? null)).reduce((s, l) => s + num(l.available), 0)

  const persist = (v: TransferFormValues) => {
    const { lines: ls, id: docId, ...header } = v
    return save.mutateAsync({ header: { ...header, id: docId ?? doc?.id, notes: header.notes || null, is_request: !!header.is_request }, children: { stock_transfer_lines: ls.map((l) => ({ ...l, lot_id: l.lot_id || null })) } })
  }
  const onSave = form.handleSubmit(async (v) => {
    const id = await persist(v)
    toast.success(t('Draft saved'))
    if (!doc) navigate(`/inventory/transfers/${id}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))
  const onPost = async () => {
    let id: string | undefined
    await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    if (!id) throw new Error('invalid')
    if (betweenStores) {
      await ship.mutateAsync(id)
      toast.success(t('Shipped'), { description: t('The goods are on the road until the other store receives them.') })
    } else {
      await post.mutateAsync(id)
      toast.success(t('Transfer done'), { description: t('The stock was moved; its value did not change.') })
    }
    navigate(`/inventory/transfers/${id}`, { replace: true })
  }

  return (
    <Form {...form}>
      <DocumentShell
        kind="transfers" doc={doc} newTitle={t('New transfer')} writePerm="wms.write"
        saving={save.isPending} posting={post.isPending || ship.isPending} onSave={() => void onSave()} onPost={onPost}
        postLabel={betweenStores ? t('Ship') : t('Move stock')}
        postConfirm={betweenStores
          ? t('The goods leave the sending store now and are on the road until the receiving store counts and receives them. Their value does not change.')
          : t('The stock leaves the source shelves and arrives on the destination shelves right away. Average costs do not change.')}
        banner={doc?.status === 'draft' && doc.is_request
          ? <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm">{t('A request from the receiving store. Check the quantities, then ship.')}</div>
          : undefined}
        lines={doc && doc.status !== 'draft' && doc.shipped_at && doc.from_warehouse_id !== doc.to_warehouse_id && doc.lines.some((l) => l.quantity_received !== null || doc.status === 'in_transit')
          ? <ReceiveTransferCard doc={doc} />
          : <LinesCard
            title={t('Products to move')}
            error={form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message}
            action={editable && (
              <Button type="button" size="sm" variant="outline" disabled={!fromWh || !toWh}
                onClick={() => lines.append({ variant_id: '', from_location_id: stockLoc(fromWh), to_location_id: stockLoc(toWh), lot_id: null, quantity: 1 })}>
                <Plus /> {t('Add line')}
              </Button>
            )}
          >
            {lines.fields.length === 0 ? <EmptyState compact title={fromWh && toWh ? t('No lines yet') : t('Choose both warehouses first')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[200px]">{t('Product')}</TableHead><TableHead className="min-w-[150px]">{t('From shelf')}</TableHead><TableHead className="min-w-[150px]">{t('To shelf')}</TableHead>
                  <TableHead className="min-w-[140px]">{t('Lot')}</TableHead><TableHead className="w-24 text-right">{t('Available')}</TableHead><TableHead className="w-24 text-right">{t('Qty')}</TableHead><TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>
                  {lines.fields.map((f, i) => {
                    const l = watched?.[i]
                    const v = variants.data?.find((x) => x.id === l?.variant_id)
                    const avail = availableAt(l?.variant_id, l?.from_location_id, l?.lot_id)
                    return (
                      <TableRow key={f.id} className="align-top hover:bg-transparent">
                        <TableCell><FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (<FormItem><FormControl><VariantPicker value={field.value} onChange={(x) => field.onChange(x ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.from_location_id`} render={({ field }) => (<FormItem><FormControl><LocationPicker warehouseId={fromWh} value={field.value} onChange={(x) => field.onChange(x ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.to_location_id`} render={({ field }) => (<FormItem><FormControl><LocationPicker warehouseId={toWh} value={field.value} onChange={(x) => field.onChange(x ?? '')} disabled={field.disabled} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell>{v && v.tracking !== 'none' ? <FormField control={form.control} name={`lines.${i}.lot_id`} render={({ field }) => (<LotPicker variantId={l?.variant_id} value={field.value} onChange={field.onChange} disabled={field.disabled} />)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        <TableCell className={cn('pt-4 text-right tabular text-[13px]', editable && num(l?.quantity) > avail && 'text-destructive')}>{editable ? formatQty(avail) : '—'}</TableCell>
                        <TableCell><FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (<FormItem><FormControl><Input type="number" step="any" min="0" className="h-9 min-w-[88px] text-right" {...field} /></FormControl><FormMessage /></FormItem>)} /></TableCell>
                        <TableCell>{editable && <Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove line {n}', { n: i + 1 })}><Trash2 /></Button>}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </LinesCard>
        }
        summary={<SummaryCard rows={[[t('Lines'), (watched ?? []).length], [t('Units'), formatQty((watched ?? []).reduce((s, l) => s + num(l.quantity), 0))]]}
          footer={t('Use the same warehouse on both sides to move stock between shelves.')} />}
      >
        <Card>
          <CardContent className="grid items-end gap-4 p-4 sm:grid-cols-[1fr_auto_1fr_180px]">
            <FormField control={form.control} name="from_warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('From')}</FormLabel><FormControl><WarehousePicker all value={field.value} disabled={field.disabled} onChange={(v) => {
                field.onChange(v ?? ''); form.getValues('lines').forEach((_, i) => form.setValue(`lines.${i}.from_location_id`, v ? stockLoc(v) : ''))
              }} /></FormControl><FormMessage /></FormItem>
            )} />
            <ArrowRight className="mb-2.5 hidden size-4 text-muted-foreground sm:block" />
            <FormField control={form.control} name="to_warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('To')}</FormLabel><FormControl><WarehousePicker all value={field.value} disabled={field.disabled} onChange={(v) => {
                field.onChange(v ?? ''); form.getValues('lines').forEach((_, i) => form.setValue(`lines.${i}.to_location_id`, v ? stockLoc(v) : ''))
              }} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="transfer_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Date')}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-4"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="is_request" render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0 sm:col-span-4">
                <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={field.disabled} /></FormControl>
                <FormLabel className="font-normal">{t('This is a request from the receiving store')}</FormLabel>
              </FormItem>
            )} />
          </CardContent>
        </Card>
      </DocumentShell>
    </Form>
  )
}
