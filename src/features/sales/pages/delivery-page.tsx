import { DocumentActions } from '@/components/document-actions'
import { zodResolver } from '@hookform/resolvers/zod'
import { Ban, PackageCheck, Trash2, Truck, Undo2 } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useVariantOptions, useWarehouses } from '@/features/inventory/api'
import { LocationPicker, LotPicker } from '@/features/inventory/components/pickers'
import { useDeleteSalesDocument, usePostDelivery, useSalesDocument, useSaveSalesDocument, useSetStatus } from '../api'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import { ErrorState } from '@/components/error-state'
import { t, td } from '@/i18n'
import { MoreMenu } from '@/components/more-menu'

type Delivery = Tables<'deliveries'> & {
  lines: Tables<'delivery_lines'>[]
  order: { id: string; number: string; status: string } | null
  partner: { name: string } | null
}

const schema = z.object({
  scheduled_date: z.string().min(1, 'Choose a date'),
  tracking_number: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  lines: z.array(z.object({
    variant_id: z.string().uuid(),
    sales_order_line_id: z.string().uuid().nullable(),
    location_id: z.string({ invalid_type_error: 'Choose a bin' }).uuid('Choose a bin'),
    lot_id: z.string().uuid().nullable().optional(),
    quantity: z.coerce.number().positive('Must be above 0'),
  })).min(1, 'A delivery needs at least one line'),
})
type Values = z.infer<typeof schema>

export function DeliveryPage() {
  const { id } = useParams()
  const doc = useSalesDocument<Delivery>('deliveries', id)
  if (doc.isLoading) return <Skeleton className="mx-auto h-[420px] max-w-6xl" />
  if (doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (!doc.data) return <EmptyState title={t('Delivery not found')} description={t('It may have been deleted. Go back to the list of deliveries.')} action={<Button asChild variant="outline"><Link to="/sales/deliveries">{t('Deliveries')}</Link></Button>} />
  return <DeliveryForm key={`${doc.data.id}-${doc.data.status}-${doc.data.updated_at}`} doc={doc.data} />
}

function DeliveryForm({ doc }: { doc: Delivery }) {
  const navigate = useNavigate()
  const { company, can } = useCompany()
  const variants = useVariantOptions()
  const warehouses = useWarehouses()
  const save = useSaveSalesDocument('deliveries')
  const setStatus = useSetStatus('deliveries')
  const post = usePostDelivery()
  const del = useDeleteSalesDocument('deliveries')
  const editable = ['draft', 'ready'].includes(doc.status) && can('wms.write')

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      scheduled_date: doc.scheduled_date, tracking_number: doc.tracking_number ?? '', notes: doc.notes ?? '',
      lines: doc.lines.map((l) => ({ variant_id: l.variant_id, sales_order_line_id: l.sales_order_line_id, location_id: l.location_id, lot_id: l.lot_id, quantity: l.quantity })),
    },
  })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const vmap = React.useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data])
  const warehouse = warehouses.data?.find((w) => w.id === doc.warehouse_id)

  const persist = (v: Values) => save.mutateAsync({
    header: { id: doc.id, scheduled_date: v.scheduled_date, tracking_number: v.tracking_number || null, notes: v.notes || null },
    lines: v.lines.map((l) => ({ ...l, lot_id: l.lot_id ?? null })),
  })
  const onSave = form.handleSubmit(async (v) => { await persist(v); toast.success(t('Delivery saved')) })
  const saveThen = async (fn: () => Promise<unknown>) => {
    if (!editable) return fn()
    let ok = false
    await form.handleSubmit(async (v) => { await persist(v); ok = true }, () => toast.error(t('Fix the highlighted lines first')))()
    if (!ok) throw new Error('invalid')
    return fn()
  }

  const units = form.watch('lines').reduce((s, l) => s + num(l.quantity), 0)
  return (
    <Form {...form}>
      <div className="w-full">
        <PageHeader
          back={{ href: '/sales/deliveries', label: t('Deliveries') }}
          title={doc.number}
          meta={<StatusBadge status={doc.status} />}
          description={t('To {customer} · from {warehouse}', { customer: doc.partner?.name ?? t('customer'), warehouse: warehouse?.name ? td(warehouse.name) : t('the warehouse') })}
          actions={<><DocumentActions id={doc.id} kind="delivery" /><Can perm="wms.write">
            <MoreMenu items={[
              { label: t('Ready to ship'), icon: Truck, hidden: doc.status !== 'draft',
                onSelect: () => saveThen(() => setStatus.mutateAsync({ id: doc.id, status: 'ready' })).then(() => toast.success(t('Ready to ship'))).catch(() => {}) },
              { label: t('Back to draft'), icon: Undo2, hidden: doc.status !== 'ready', onSelect: () => setStatus.mutate({ id: doc.id, status: 'draft' }) },
              { label: t('Cancel delivery'), icon: Ban, hidden: !editable, separate: true,
                confirm: { title: t('Cancel {number}?', { number: doc.number }), description: t('The delivery stays on record as cancelled. The order stays open with its stock reserved.'), confirmLabel: t('Cancel delivery') },
                onSelect: () => setStatus.mutateAsync({ id: doc.id, status: 'cancelled' }) },
              { label: t('Delete'), icon: Trash2, destructive: true, hidden: doc.status !== 'draft',
                confirm: { title: t('Delete {number}?', { number: doc.number }), description: t("Nothing has left the warehouse yet; the order's reservations stay in place.") },
                onSelect: async () => { await del.mutateAsync(doc.id); navigate(doc.order ? `/sales/orders/${doc.order.id}` : '/sales/deliveries') } },
            ]} />
            {editable && <Button variant="outline" onClick={() => void onSave()} loading={save.isPending}>{t('Save')}</Button>}
            {editable && (
              <ConfirmDialog trigger={<Button><PackageCheck /> {t('Complete delivery')}</Button>} title={t('Complete this delivery?')}
                description={t("{units} units leave {warehouse}. Stock goes down, the order's reservations are used up and the cost of the goods is recorded at average cost.", { units: formatQty(units), warehouse: warehouse?.name ? td(warehouse.name) : t('the warehouse') })}
                confirmLabel={t('Complete delivery')}
                onConfirm={async () => {
                  const r = await saveThen(() => post.mutateAsync(doc.id)) as { cost: number }
                  toast.success(t('Delivery completed'), { description: t('Cost of goods {amount}, without VAT', { amount: formatMoney(r.cost, company?.base_currency) }) })
                }} />
            )}
          </Can></>}
        />
        <Tabs defaultValue="document">
          <TabsList><TabsTrigger value="document">{t('Document')}</TabsTrigger><TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
          <TabsContent value="document">
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <Card>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                  <FormField control={form.control} name="scheduled_date" render={({ field }) => (
                    <FormItem><FormLabel>{t('Delivery date')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="tracking_number" render={({ field }) => (
                    <FormItem><FormLabel optional>{t('Tracking number')}</FormLabel><FormControl><Input disabled={!editable} {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem className="sm:col-span-2"><FormLabel optional>{t('Notes for the driver')}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} {...field} /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t('Summary')}</CardTitle></CardHeader>
                <CardContent className="grid gap-2 text-[13px]">
                  <Row k={t('Order|sales')}>{doc.order ? <Link className="text-primary hover:underline" to={`/sales/orders/${doc.order.id}`}>{doc.order.number}</Link> : '—'}</Row>
                  <Row k={t('Lines')}>{lines.fields.length}</Row>
                  <Row k={t('Units')}>{formatQty(units)}</Row>
                  {doc.status === 'done' && <><Row k={t('Shipped')}>{formatDate(doc.done_at, true)}</Row><Row k={t('Cost of goods (without VAT)')}>{formatMoney(doc.total_cost)} {company?.base_currency}</Row></>}
                </CardContent>
              </Card>
            </div>
            <Card className="mt-4">
              <CardHeader className="py-3"><CardTitle>{t("What's being shipped")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('Product')}</TableHead><TableHead className="w-[200px]">{t('Pick from')}</TableHead><TableHead className="w-[200px]">{t('Lot')}</TableHead>
                    <TableHead className="w-[120px] text-right">{t('Quantity')}</TableHead>{doc.status === 'done' && <TableHead className="text-right">{t('Unit cost (without VAT)')}</TableHead>}<TableHead className="w-10" />
                  </TableRow></TableHeader>
                  <TableBody>
                    {lines.fields.map((f, i) => {
                      const v = vmap.get(f.variant_id)
                      return (
                        <TableRow key={f.id}>
                          <TableCell><div className="font-medium">{v?.sku ?? '…'}</div><div className="text-xs text-muted-foreground">{v?.name}</div></TableCell>
                          <TableCell>
                            <FormField control={form.control} name={`lines.${i}.location_id`} render={({ field, fieldState }) => (
                              <FormItem><LocationPicker warehouseId={doc.warehouse_id} value={field.value} onChange={field.onChange} disabled={!editable} aria-invalid={!!fieldState.error} /><FormMessage /></FormItem>
                            )} />
                          </TableCell>
                          <TableCell>
                            {v?.tracking && v.tracking !== 'none'
                              ? <FormField control={form.control} name={`lines.${i}.lot_id`} render={({ field }) => <LotPicker variantId={f.variant_id} value={field.value} onChange={field.onChange} disabled={!editable} />} />
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => (
                              <FormItem><FormControl><Input type="number" step="any" className="text-right tabular" disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </TableCell>
                          {doc.status === 'done' && <TableCell className="text-right tabular">{formatMoney(doc.lines[i]?.unit_cost)}</TableCell>}
                          <TableCell>{editable && lines.fields.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={t('Remove line')} onClick={() => lines.remove(i)}><Trash2 /></Button>}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
              {editable && <p className="px-4 py-3 text-xs text-muted-foreground">{t("To send less than ordered, lower the quantity — what's left stays reserved on the order for a later delivery.")}</p>}
            </Card>
          </TabsContent>
          <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table="deliveries" id={doc.id} /></TabsContent>
          <TabsContent value="accounting"><AccountingTab sourceType="delivery" sourceId={doc.id} emptyHint={t('The cost of the goods is recorded in accounting when the delivery is completed.')} /></TabsContent>
        </Tabs>
      </div>
    </Form>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tabular font-medium">{children}</span></div>
}
