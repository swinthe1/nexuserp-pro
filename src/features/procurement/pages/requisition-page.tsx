import { zodResolver } from '@/lib/zod-resolver'
import { useDefaultUnit } from '@/app/active-unit'
import { Check, Plus, Send, ShoppingCart, Trash2, Undo2, X } from 'lucide-react'
import * as React from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { ErrorState } from '@/components/error-state'
import { t, td, tn } from '@/i18n'
import { formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import {
  useActiveVendors, useDecideRequisition, useDeleteProcDocument, useOrderRequisition, useProcDocument, usePurchasableVariants,
  useSaveProcDocument, useSetProcStatus, useSubmitRequisition,
} from '../api'
import { newLineKey } from '../components/purchase-lines-editor'
import { requisitionSchema, type RequisitionValues } from '../schemas'

type ReqDoc = Tables<'purchase_requisitions'> & {
  lines: Tables<'purchase_requisition_lines'>[]
  requester: { full_name: string | null } | null
  decider: { full_name: string | null } | null
  orders: { id: string; number: string; status: string; vendor: { name: string } | null }[]
}

export function RequisitionPage() {
  const { id } = useParams()
  const doc = useProcDocument<ReqDoc>('requisitions', id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-[420px] max-w-5xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t('Requisition not found')} action={<Link to="/procurement/requisitions" className="text-sm text-primary hover:underline">{t('All requisitions')}</Link>} />
  return <RequisitionForm key={`${doc.data?.id ?? 'new'}-${doc.data?.status ?? ''}`} doc={doc.data} />
}

function RequisitionForm({ doc }: { doc?: ReqDoc }) {
  const navigate = useNavigate()
  const { can, company } = useCompany()
  const { user } = useAuth()
  const warehouses = useWarehouses()
  const defUnit = useDefaultUnit(warehouses.data)
  const variants = usePurchasableVariants()
  const vendors = useActiveVendors()
  const save = useSaveProcDocument('requisitions')
  const del = useDeleteProcDocument('requisitions')
  const setStatus = useSetProcStatus('requisitions')
  const submit = useSubmitRequisition()
  const decide = useDecideRequisition()
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [orderOpen, setOrderOpen] = React.useState(false)
  const editable = (!doc || doc.status === 'draft') && can('requisitions.write')
  const base = company?.base_currency ?? 'ALL'

  const form = useForm<RequisitionValues>({
    resolver: zodResolver(requisitionSchema),
    defaultValues: doc ? {
      warehouse_id: doc.warehouse_id, required_date: doc.required_date ?? '', justification: doc.justification ?? '',
      lines: [...doc.lines].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((l) => ({
        key: l.id, variant_id: l.variant_id, description: l.description, quantity: l.quantity, estimated_unit_cost: l.estimated_unit_cost, suggested_vendor_id: l.suggested_vendor_id,
      })),
    } : { warehouse_id: null, required_date: '', justification: '', lines: [] },
  })
  const lines = useFieldArray({ control: form.control, name: 'lines' })
  const watched = useWatch({ control: form.control, name: 'lines' })
  const vmap = React.useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data])
  const total = (watched ?? []).reduce((s, l) => s + num(l.quantity) * num(l.estimated_unit_cost), 0)
  React.useEffect(() => {
    if (!doc && !form.getValues('warehouse_id') && warehouses.data?.length) form.setValue('warehouse_id', defUnit ?? warehouses.data[0]!.id)
  }, [doc, warehouses.data, form])

  const persist = (v: RequisitionValues) => save.mutateAsync({
    header: { id: doc?.id, warehouse_id: v.warehouse_id ?? null, required_date: v.required_date || null, justification: v.justification || null },
    lines: v.lines.map((l) => ({ variant_id: l.variant_id ?? null, description: l.description, quantity: l.quantity, estimated_unit_cost: l.estimated_unit_cost, suggested_vendor_id: l.suggested_vendor_id ?? null })),
  })
  const go = (id: string) => navigate(`/procurement/requisitions/${id}`, { replace: true })
  const saveOnly = form.handleSubmit(async (v) => { const id = await persist(v); toast.success(t('Draft saved')); if (!doc) go(id) }, () => toast.error(t('Fix the highlighted fields first')))

  const own = doc?.requested_by === user?.id
  const actions: React.ReactNode[] = []
  if (editable) {
    actions.push(<ConfirmDialog key="submit" trigger={<Button><Send /> {t('Submit for approval')}</Button>} title={t('Submit for approval?')}
      description={t("Purchasing is notified. You can't change the items while it is being reviewed.")} confirmLabel={t('Submit for approval')}
      onConfirm={async () => {
        let id: string | undefined
        await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
        if (!id) throw new Error('invalid')
        const status = await submit.mutateAsync(id).catch((e) => { if (!doc) go(id!); throw e })
        toast.success(status === 'approved' ? t('Approved') : t('Sent for approval'), { description: status === 'submitted' ? t('Purchasing has been notified.') : undefined })
        go(id)
      }} />)
  }
  if (doc?.status === 'submitted' && can('requisitions.approve') && (!own || can('admin.write'))) {
    actions.push(<Button key="rej" variant="outline" onClick={() => setRejectOpen(true)}><X /> {t('Reject')}</Button>)
    actions.push(<Button key="app" loading={decide.isPending} onClick={() => decide.mutate({ id: doc.id, decision: 'approved' }, { onSuccess: () => toast.success(t('Requisition approved')) })}><Check /> {t('Approve')}</Button>)
  }
  if (doc && ['submitted', 'rejected'].includes(doc.status) && (own || can('requisitions.approve'))) {
    actions.push(<Button key="back" variant="ghost" onClick={() => setStatus.mutate({ id: doc.id, status: 'draft' })}><Undo2 /> {own ? t('Edit again') : t('Send back')}</Button>)
  }
  if (doc?.status === 'approved' && can('procurement.write')) {
    actions.push(<Button key="order" onClick={() => setOrderOpen(true)}><ShoppingCart /> {t('Create purchase orders')}</Button>)
  }

  return (
    <Form {...form}>
      <div className="w-full">
        <PageHeader
          back={{ href: '/procurement/requisitions', label: t('Requisitions') }}
          title={doc ? doc.number : t('New requisition')}
          meta={doc && <StatusBadge status={doc.status} />}
          description={doc ? [t('Requested by {name} on {date}', { name: doc.requester?.full_name ?? t('someone'), date: formatDate(doc.created_at) }), doc.decided_at ? (doc.status === 'rejected' ? t('rejected by {name} on {date}', { name: doc.decider?.full_name ?? t('the approver'), date: formatDate(doc.decided_at) }) : t('decided by {name} on {date}', { name: doc.decider?.full_name ?? t('the approver'), date: formatDate(doc.decided_at) })) : null].filter(Boolean).join(' · ') : t('Tell purchasing what you need; they choose the vendor and place the order.')}
          actions={<Can perm="requisitions.read">
            {doc && editable && <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete {number}?', { number: doc.number })} description={t('The draft disappears from lists.')} confirmLabel={t('Delete')} destructive onConfirm={async () => { await del.mutateAsync(doc.id); navigate('/procurement/requisitions') }} />}
            {editable && <Button variant="outline" onClick={() => void saveOnly()} loading={save.isPending}>{doc ? t('Save draft') : t('Create draft')}</Button>}
            {actions}
          </Can>}
        />
        {doc?.status === 'rejected' && doc.rejection_reason && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px]">{t('Rejected')}: <span className="font-medium">{doc.rejection_reason}</span></div>
        )}
        {doc?.status === 'submitted' && own && !can('admin.write') && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">{t("Waiting for a decision from purchasing. You can't approve your own request.")}</div>
        )}
        <Tabs defaultValue="document">
          {doc && <TabsList><TabsTrigger value="document">{t('Request')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>}
          <TabsContent value="document">
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <Card>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                  <FormField control={form.control} name="warehouse_id" render={({ field }) => (
                    <FormItem><FormLabel optional>{t('Deliver to')}</FormLabel>
                      <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t('Warehouse')} /></SelectTrigger></FormControl>
                        <SelectContent>{(warehouses.data ?? []).filter((w) => w.is_active).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
                      </Select></FormItem>
                  )} />
                  <FormField control={form.control} name="required_date" render={({ field }) => (
                    <FormItem><FormLabel optional>{t('Needed by')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="justification" render={({ field }) => (
                    <FormItem className="sm:col-span-2"><FormLabel optional>{t("What it's for")}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} placeholder={t('e.g. Restock for the summer terrace')} {...field} /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t('Summary')}</CardTitle></CardHeader>
                <CardContent className="grid gap-2 text-[13px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Items')}</span><span className="tabular font-medium">{watched?.length ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Estimated cost (without VAT)')}</span><span className="tabular font-medium">{formatMoney(total, base)}</span></div>
                  {(doc?.orders.length ?? 0) > 0 && (
                    <div className="mt-1 grid gap-1.5 border-t pt-2">
                      {doc!.orders.map((o) => (
                        <Link key={o.id} to={`/procurement/orders/${o.id}`} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-primary hover:bg-secondary">
                          <span className="truncate">{o.number} · {o.vendor?.name}</span><StatusBadge status={o.status} />
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card className="mt-4">
              <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
                <CardTitle>{t('Items')}</CardTitle>
                {editable && <Button type="button" size="sm" variant="outline" onClick={() => lines.append({ key: newLineKey(), variant_id: null, description: '', quantity: 1, estimated_unit_cost: 0, suggested_vendor_id: null })}><Plus /> {t('Add item')}</Button>}
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {lines.fields.length === 0 ? <EmptyState compact title={t('No items yet')} description={t('Pick products from the catalogue, or describe anything else you need.')} /> : (
                  <Table className="min-w-[820px]">
                    <TableHeader><TableRow className="hover:bg-transparent">
                      <TableHead>{t('Item')}</TableHead><TableHead className="w-28 text-right">{t('Qty')}</TableHead><TableHead className="w-32 text-right">{t('Estimated unit cost (without VAT)')}</TableHead>
                      <TableHead className="w-52">{t('Suggested vendor')}</TableHead><TableHead className="w-32 text-right">{t('Estimate (without VAT)')}</TableHead><TableHead className="w-10" />
                    </TableRow></TableHeader>
                    <TableBody>
                      {lines.fields.map((f, i) => {
                        const l = watched?.[i]
                        const v = l?.variant_id ? vmap.get(l.variant_id) : undefined
                        return (
                          <TableRow key={f.id} className="align-top hover:bg-transparent">
                            <TableCell className="min-w-[260px]">
                              <div className="grid gap-1.5">
                                <FormField control={form.control} name={`lines.${i}.variant_id`} render={({ field }) => (
                                  <FormItem><FormControl><SearchSelect value={field.value} clearable disabled={!editable} placeholder={t('Catalogue product (optional)')}
                                    options={(variants.data ?? []).map((x) => ({ value: x.id, label: x.sku, hint: x.name, keywords: [x.name] }))}
                                    onChange={(val) => {
                                      field.onChange(val)
                                      const x = val ? vmap.get(val) : undefined
                                      if (x) { form.setValue(`lines.${i}.description`, x.name, { shouldValidate: true }); if (!num(form.getValues(`lines.${i}.estimated_unit_cost`))) form.setValue(`lines.${i}.estimated_unit_cost`, Math.round(num(x.avg_cost) * 100) / 100) }
                                    }} /></FormControl></FormItem>
                                )} />
                                <FormField control={form.control} name={`lines.${i}.description`} render={({ field }) => (
                                  <FormItem><FormControl><Input className="h-8 text-[13px]" placeholder={t('What is needed')} disabled={!editable} aria-label={t('Description, item {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>
                                )} />
                                {v && v.product_type !== 'service' && <p className="text-2xs text-muted-foreground">{t('{qty} on hand', { qty: formatQty(v.on_hand) })} · {t('{qty} already on order', { qty: formatQty(v.incoming) })}</p>}
                              </div>
                            </TableCell>
                            <TableCell><FormField control={form.control} name={`lines.${i}.quantity`} render={({ field }) => <FormItem><FormControl><Input type="number" step="any" className="h-9 text-right" disabled={!editable} aria-label={t('Quantity, item {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>} /></TableCell>
                            <TableCell><FormField control={form.control} name={`lines.${i}.estimated_unit_cost`} render={({ field }) => <FormItem><FormControl><Input type="number" step="any" className="h-9 text-right" disabled={!editable} aria-label={t('Estimated cost without VAT, item {n}', { n: i + 1 })} {...field} /></FormControl><FormMessage /></FormItem>} /></TableCell>
                            <TableCell><FormField control={form.control} name={`lines.${i}.suggested_vendor_id`} render={({ field }) => (
                              <SearchSelect value={field.value} onChange={field.onChange} clearable disabled={!editable} placeholder={t('Any vendor')}
                                options={(vendors.data ?? []).filter((x) => x.is_active).map((x) => ({ value: x.id, label: x.name }))} />
                            )} /></TableCell>
                            <TableCell className="pt-4 text-right tabular text-[13px] font-medium">{formatMoney(num(l?.quantity) * num(l?.estimated_unit_cost))}</TableCell>
                            <TableCell>{editable && <Button type="button" variant="ghost" size="icon-sm" onClick={() => lines.remove(i)} aria-label={t('Remove item {n}', { n: i + 1 })}><Trash2 /></Button>}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              {form.formState.errors.lines?.message && <p className="px-4 pb-3 text-xs font-medium text-destructive">{t(form.formState.errors.lines.message)}</p>}
            </Card>
          </TabsContent>
          {doc && <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table="purchase_requisitions" id={doc.id} /></TabsContent>}
        </Tabs>
        {doc && <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onConfirm={(reason) => decide.mutateAsync({ id: doc.id, decision: 'rejected', reason }).then(() => { toast.success(t('Requisition rejected')) })} />}
        {doc && <OrderDialog open={orderOpen} onOpenChange={setOrderOpen} doc={doc} />}
      </div>
    </Form>
  )
}

function RejectDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Reject this requisition?')}</DialogTitle><DialogDescription>{t('The requester sees the reason and can change the request and submit it again.')}</DialogDescription></DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Use the stock in the Tirana store first')} aria-label={t('Reason')} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={!reason.trim()} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onOpenChange(false) } catch { /* toast */ } finally { setBusy(false) } }}>{t('Reject')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OrderDialog({ open, onOpenChange, doc }: { open: boolean; onOpenChange: (o: boolean) => void; doc: ReqDoc }) {
  const navigate = useNavigate()
  const vendors = useActiveVendors()
  const order = useOrderRequisition()
  const [vendor, setVendor] = React.useState<string | null>(null)
  const unassigned = doc.lines.filter((l) => !l.suggested_vendor_id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Create purchase orders')}</DialogTitle>
          <DialogDescription>{t("One draft order per vendor, priced from each vendor's price list. You can review them before submitting.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-[13px]">
          {unassigned.length > 0 ? <>
            <p>{tn(unassigned.length, "{n} item has no suggested vendor. It goes to the item's preferred vendor, or else to:", "{n} items have no suggested vendor. They go to each item's preferred vendor, or else to:")}</p>
            <Label className="sr-only" htmlFor="fallback-vendor">{t('Vendor')}</Label>
            <SearchSelect value={vendor} onChange={setVendor} clearable placeholder={t('Preferred vendor of each item')}
              options={(vendors.data ?? []).filter((x) => x.is_active).map((x) => ({ value: x.id, label: x.name }))} />
          </> : <p>{t('Every item has a suggested vendor.')}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button loading={order.isPending} onClick={async () => {
            const r = await order.mutateAsync({ id: doc.id, vendorId: vendor })
            onOpenChange(false)
            toast.success(tn(r.orders.length, '{n} purchase order created', '{n} purchase orders created'))
            navigate(r.orders.length === 1 ? `/procurement/orders/${r.orders[0]}` : '/procurement/orders')
          }}>{t('Create orders')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
