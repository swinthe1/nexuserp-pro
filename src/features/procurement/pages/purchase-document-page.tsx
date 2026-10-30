import { DocumentActions } from '@/components/document-actions'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Ban, CheckCheck, ClipboardCheck, FileText, PackageCheck, Receipt, Send, ShieldAlert, Tag, Trash2, Undo2,
} from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useRegistryRemote } from '@/lib/registry'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InstalmentsCard } from '@/features/finance/components/instalments'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { ErrorState } from '@/components/error-state'
import { msg, t, td } from '@/i18n'
import { formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { useCurrencies, useWarehouses } from '@/features/inventory/api'
import { useMembers, usePaymentTerms } from '@/features/sales/api'
import {
  useActiveVendors, useBillOrder, usePurchasableVariants, useDeleteProcDocument, useMatchBill, usePostBill, useProcDocument, useReceiveOrder,
  useSaveProcDocument, useSetProcStatus, useSubmitPurchaseOrder, useVendorCredit, type MatchLine,
} from '../api'
import { WithholdingCard } from '../components/withholding-card'
import { MATCH_LABEL, PurchaseLinesEditor, type PurchaseProgress } from '../components/purchase-lines-editor'
import { billSchema, purchaseOrderSchema, type BillValues, type PurchaseOrderValues } from '../schemas'
import { AccountingTab } from '@/features/finance/components/t-accounts'

type Kind = 'orders' | 'bills'
type PoDoc = Tables<'purchase_orders'> & {
  lines: Tables<'purchase_order_lines'>[]
  vendor: { id: string; name: string; email: string | null; phone: string | null } | null
  requisition: { id: string; number: string } | null
  receipts: { id: string; number: string; status: string; receipt_date: string; total_value: number }[]
  bills: { id: string; number: string; status: string; document_type: string; vendor_invoice_number: string; total: number; match_status: string }[]
}
type BillDoc = Tables<'vendor_bills'> & {
  lines: Tables<'vendor_bill_lines'>[]
  vendor: { id: string; name: string } | null
  order: { id: string; number: string; status: string; currency_code: string } | null
  original?: { id: string; number: string } | null
  credits?: { id: string; number: string; status: string; total: number }[]
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']

export function PurchaseDocumentPage({ kind }: { kind: Kind }) {
  const { id } = useParams()
  const doc = useProcDocument<PoDoc & BillDoc>(kind, id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-[480px] max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={kind === 'orders' ? t('Purchase order not found') : t('Bill not found')} action={<Link to={kind === 'orders' ? '/procurement/orders' : '/procurement/bills'} className="text-sm text-primary hover:underline">{kind === 'orders' ? t('All purchase orders') : t('All vendor bills')}</Link>} />
  // a draft that brings goods in is edited on the purchase invoice screen
  if (kind === 'bills' && doc.data?.status === 'draft' && (doc.data as BillDoc).warehouse_id) return <Navigate to={`/procurement/invoice/${doc.data.id}`} replace />
  const key = `${doc.data?.id ?? 'new'}-${doc.data?.status ?? ''}-${doc.data?.match_status ?? ''}`
  return kind === 'orders'
    ? <PurchaseOrderForm key={key} doc={doc.data as PoDoc | undefined} />
    : <BillForm key={key} doc={doc.data as BillDoc | undefined} />
}

/* ======================================================================== */
/*  Purchase order                                                          */
/* ======================================================================== */
function PurchaseOrderForm({ doc }: { doc?: PoDoc }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, can } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const vendors = useActiveVendors()
  const warehouses = useWarehouses()
  const currencies = useCurrencies()
  const terms = usePaymentTerms()
  const members = useMembers()
  const variants = usePurchasableVariants()
  const save = useSaveProcDocument('orders')
  const setStatus = useSetProcStatus('orders')
  const del = useDeleteProcDocument('orders')
  const submit = useSubmitPurchaseOrder()
  const receive = useReceiveOrder()
  const [billOpen, setBillOpen] = React.useState(false)
  const editable = (!doc || doc.status === 'draft') && can('procurement.write')

  const form = useForm<PurchaseOrderValues>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: doc ? {
      vendor_id: doc.vendor_id, doc_date: doc.order_date, second_date: doc.expected_date ?? '', warehouse_id: doc.warehouse_id,
      currency_code: doc.currency_code, exchange_rate: doc.exchange_rate, payment_term_id: doc.payment_term_id, buyer_id: doc.buyer_id,
      vendor_reference: doc.vendor_reference ?? '', incoterm: doc.incoterm, notes: doc.notes ?? '',
      lines: [...doc.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({
        key: l.id, variant_id: l.variant_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct,
        tax_code_id: l.tax_code_id, price_source: 'manual' as const, po_line_id: null, receipt_line_id: null, requisition_line_id: l.requisition_line_id,
        pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
      })),
    } : {
      vendor_id: params.get('vendor') ?? (undefined as unknown as string), doc_date: todayISO(), second_date: '',
      warehouse_id: (undefined as unknown as string), currency_code: base, exchange_rate: 1, payment_term_id: null, buyer_id: null,
      vendor_reference: '', incoterm: null, notes: '', lines: [],
    },
  })
  const [vendorId, currency] = useWatch({ control: form.control, name: ['vendor_id', 'currency_code'] })
  const registry = useRegistryRemote('vendor', (id) => onVendor(id))
  const vendor = vendors.data?.find((v) => v.id === vendorId)

  React.useEffect(() => {
    if (!doc && !form.getValues('warehouse_id') && warehouses.data?.length) form.setValue('warehouse_id', warehouses.data[0]!.id)
  }, [doc, warehouses.data, form])
  const onVendor = (id: string | null) => {
    form.setValue('vendor_id', id as string, { shouldValidate: true })
    const v = vendors.data?.find((x) => x.id === id)
    if (!v) return
    if (v.payment_term_id) form.setValue('payment_term_id', v.payment_term_id)
    form.setValue('currency_code', v.currency_code ?? base)
    if ((v.currency_code ?? base) === base) form.setValue('exchange_rate', 1)
  }

  const persist = async (v: PurchaseOrderValues) => save.mutateAsync({
    header: {
      id: doc?.id, vendor_id: v.vendor_id, order_date: v.doc_date, expected_date: v.second_date || null, warehouse_id: v.warehouse_id,
      currency_code: v.currency_code, exchange_rate: v.exchange_rate, payment_term_id: v.payment_term_id ?? null, buyer_id: v.buyer_id ?? null,
      vendor_reference: v.vendor_reference || null, incoterm: v.incoterm || null, notes: v.notes || null,
    },
    lines: v.lines.map((l, i) => ({
      line_no: i + 1, variant_id: l.variant_id ?? null, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      discount_pct: l.discount_pct, tax_code_id: l.tax_code_id ?? null, requisition_line_id: l.requisition_line_id ?? null,
      pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
    })),
  })
  const go = (id: string) => navigate(`/procurement/orders/${id}`, { replace: true })
  const saveOnly = form.handleSubmit(async (v) => { const id = await persist(v); toast.success(t('Draft saved')); if (!doc) go(id) },
    () => toast.error(t('Fix the highlighted fields first')))
  const saveFirst = async () => {
    if (!editable) return doc?.id
    let id: string | undefined
    await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    return id
  }

  const remaining = doc?.lines.filter((l) => num(l.quantity) > num(l.qty_received)) ?? []
  const receivedAny = doc?.lines.some((l) => num(l.qty_received) > 0)
  const actions: React.ReactNode[] = []
  if (editable) {
    actions.push(<ConfirmDialog key="submit" trigger={<Button><Send /> {t('Submit')}</Button>} title={t('Submit this purchase order?')}
      description={t("It is checked (active vendor, items that can be bought) and approved — directly, or by an approver when the amount needs it. Lines can't be changed afterwards.")}
      confirmLabel={t('Submit')}
      onConfirm={async () => {
        const id = await saveFirst(); if (!id) throw new Error('invalid')
        const status = await submit.mutateAsync(id).catch((e) => { if (!doc) go(id); throw e })
        if (status === 'pending_approval') toast.message(t('Sent for approval'), { description: t('The approver has been notified.') })
        else toast.success(t('Order approved'), { description: t('Mark it as sent once it is with the vendor.') })
        go(id)
      }} />)
  }
  if (doc && can('procurement.write')) {
    if (doc.status === 'pending_approval') {
      actions.push(<ConfirmDialog key="withdraw" trigger={<Button variant="outline"><Undo2 /> {t('Withdraw')}</Button>} title={t('Withdraw from approval?')}
        description={t('The order goes back to draft so you can change it; the pending approval is cancelled.')} confirmLabel={t('Withdraw')}
        onConfirm={() => setStatus.mutateAsync({ id: doc.id, status: 'draft' })} />)
    }
    if (doc.status === 'approved') {
      actions.push(<Button key="sent" variant="outline" onClick={() => setStatus.mutate({ id: doc.id, status: 'sent' }, { onSuccess: () => toast.success(t('Marked as sent')) })}><Send /> {t('Mark as sent')}</Button>)
    }
  }
  if (doc && ['approved', 'sent', 'partially_received'].includes(doc.status) && remaining.length > 0 && (can('wms.write') || can('procurement.write'))) {
    actions.push(<Button key="recv" loading={receive.isPending}
      onClick={async () => { const gr = await receive.mutateAsync(doc.id); toast.success(t('Draft goods receipt created'), { description: t('Check quantities and lots, then confirm it.') }); navigate(`/inventory/receipts/${gr}`) }}>
      <PackageCheck /> {t('Receive goods')}</Button>)
  }
  if (doc && ['approved', 'sent', 'partially_received', 'received', 'closed'].includes(doc.status) && doc.billing_status !== 'billed' && can('invoicing.write')) {
    actions.push(<Button key="bill" variant="outline" onClick={() => setBillOpen(true)}><Receipt /> {t('Enter bill')}</Button>)
  }
  if (doc && can('procurement.write')) {
    if (doc.status === 'partially_received' || (doc.status === 'received' && doc.billing_status !== 'billed')) {
      actions.push(<ConfirmDialog key="close" trigger={<Button variant="ghost"><CheckCheck /> {t('Close')}</Button>} title={t('Close {number}?', { number: doc.number })}
        description={doc.status === 'partially_received' ? t('The rest of the order is no longer expected. It stops counting as incoming stock.') : t('The order is finished; it will not be billed further.')}
        confirmLabel={t('Close order')} onConfirm={() => setStatus.mutateAsync({ id: doc.id, status: 'closed' })} />)
    }
    if (['approved', 'sent'].includes(doc.status) && !receivedAny && !doc.lines.some((l) => num(l.qty_billed) > 0)) {
      actions.push(<ConfirmDialog key="cancel" trigger={<Button variant="ghost" className="text-destructive"><Ban /> {t('Cancel order')}</Button>} title={t('Cancel {number}?', { number: doc.number })}
        description={t('Tell the vendor too. The order stays on record as cancelled and stops counting as incoming stock.')} confirmLabel={t('Cancel order')} destructive
        onConfirm={() => setStatus.mutateAsync({ id: doc.id, status: 'cancelled', extra: { cancel_reason: 'Cancelled by buyer' } })} />)
    }
  }

  const progress: Record<number, PurchaseProgress> | undefined = doc && doc.status !== 'draft'
    ? Object.fromEntries([...doc.lines].sort((a, b) => a.line_no - b.line_no).map((l, i) => [i, {
        ordered: l.quantity, received: l.qty_received, billed: l.qty_billed,
        isService: !l.variant_id || variants.data?.find((v) => v.id === l.variant_id)?.product_type === 'service',
      }]))
    : undefined
  const late = doc && ['approved', 'sent', 'partially_received'].includes(doc.status) && doc.expected_date && doc.expected_date < todayISO()

  const body = (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField control={form.control} name="vendor_id" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-1"><FormLabel>{t('Vendor')}</FormLabel>
                <FormControl><SearchSelect value={field.value} onChange={onVendor} disabled={!editable} placeholder={t('Choose a vendor')} remote={registry}
                  options={(vendors.data ?? []).filter((v) => v.is_active || v.id === field.value).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? v.code, keywords: [v.code] }))} /></FormControl>
                {vendor && <FormDescription>{[vendor.email, vendor.phone].filter(Boolean).join(' · ') || vendor.code}</FormDescription>}
                <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="doc_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Order date')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="second_date" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Expected delivery')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl>
                {late && <FormDescription className="text-destructive">{t('Late — {date} has passed', { date: formatDate(doc!.expected_date) })}</FormDescription>}</FormItem>
            )} />
            <FormField control={form.control} name="warehouse_id" render={({ field }) => (
              <FormItem><FormLabel>{t('Deliver to')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Warehouse')} /></SelectTrigger></FormControl>
                  <SelectContent>{(warehouses.data ?? []).filter((w) => w.is_active).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
                </Select><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="payment_term_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Payment terms')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Immediate')} /></SelectTrigger></FormControl>
                  <SelectContent>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            <FormField control={form.control} name="buyer_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Buyer')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Me')} /></SelectTrigger></FormControl>
                  <SelectContent>{(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            <CurrencyFields form={form} editable={editable} base={base} currencies={(currencies.data ?? []).map((c) => c.code)} />
            <FormField control={form.control} name="incoterm" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Delivery terms (Incoterm)')}</FormLabel>
                <Select value={field.value ?? '__none'} onValueChange={(v) => field.onChange(v === '__none' ? null : v)} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="__none">{t('Not set')}</SelectItem>{INCOTERMS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                </Select><FormDescription>{t('Imports: who pays freight and customs.')}</FormDescription></FormItem>
            )} />
            <FormField control={form.control} name="vendor_reference" render={({ field }) => (
              <FormItem><FormLabel optional>{t("Vendor's reference")}</FormLabel><FormControl><Input disabled={!editable} placeholder={t('Their offer or order no.')} {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-3"><FormLabel optional>{t('Notes to the vendor')}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>
        <PoSidePanel doc={doc} currency={currency} base={base} />
      </div>
      <PurchaseLinesEditor form={form} editable={editable} currency={currency} progress={progress} />
    </>
  )

  return (
    <Form {...form}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          back={{ href: '/procurement/orders', label: t('Purchase orders') }}
          title={doc ? doc.number : t('New purchase order')}
          meta={doc && <>
            <StatusBadge status={doc.status} />
            {doc.status !== 'draft' && doc.status !== 'cancelled' && <StatusBadge status={doc.billing_status} />}
            {late && <Badge variant="destructive">{t('Late')}</Badge>}
          </>}
          description={doc ? `${doc.vendor?.name ?? ''} · ${t('created {date}', { date: formatDate(doc.created_at, true) })}` : undefined}
          actions={<Can perm="procurement.read">
            {doc && <DocumentActions id={doc.id} kind="purchase_order" />}
            {doc && editable && (
              <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete draft {number}?', { number: doc.number })}
                description={t('The draft disappears from lists. Its number is not reused.')} confirmLabel={t('Delete draft')} destructive
                onConfirm={async () => { await del.mutateAsync(doc.id); navigate('/procurement/orders') }} />
            )}
            {editable && <Button variant="outline" onClick={() => void saveOnly()} loading={save.isPending}>{doc ? t('Save draft') : t('Create draft')}</Button>}
            {actions}
          </Can>}
        />
        {doc?.status === 'pending_approval' && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
            {t("Waiting for approval — the amount is above the company's limit.")} <Link to="/approvals" className="text-primary hover:underline">{t('Open approvals')}</Link>
          </div>
        )}
        {doc ? (
          <Tabs defaultValue="document">
            <TabsList><TabsTrigger value="document">{t('Document')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
            <TabsContent value="document">{body}</TabsContent>
            <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table="purchase_orders" id={doc.id} /></TabsContent>
          </Tabs>
        ) : body}
        {doc && <BillFromPoDialog open={billOpen} onOpenChange={setBillOpen} po={doc} />}
      </div>
    </Form>
  )
}

function CurrencyFields({ form, editable, base, currencies }: {
  form: ReturnType<typeof useForm<PurchaseOrderValues>> | ReturnType<typeof useForm<BillValues>>; editable: boolean; base: string; currencies: string[]
}) {
  const f = form as ReturnType<typeof useForm<PurchaseOrderValues>>
  const currency = useWatch({ control: f.control, name: 'currency_code' })
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <FormField control={f.control} name="currency_code" render={({ field }) => (
        <FormItem><FormLabel>{t('Currency')}</FormLabel>
          <Select value={field.value} onValueChange={(v) => { field.onChange(v); if (v === base) f.setValue('exchange_rate', 1) }} disabled={!editable}>
            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
            <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select></FormItem>
      )} />
      <FormField control={f.control} name="exchange_rate" render={({ field }) => (
        <FormItem><FormLabel>{t('Exchange rate')}</FormLabel><FormControl><Input type="number" step="any" disabled={!editable || currency === base} {...field} /></FormControl>
          <FormDescription>{currency === base ? t('Base currency') : t('{base} per 1 {currency}', { base, currency })}</FormDescription><FormMessage /></FormItem>
      )} />
    </div>
  )
}

function PoSidePanel({ doc, currency, base }: { doc?: PoDoc; currency: string; base: string }) {
  if (!doc) {
    return (
      <Card><CardHeader><CardTitle>{t('How prices are filled in')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-[13px] text-muted-foreground">
          <p>{t('Choosing a product takes, in this order:')}</p>
          <ol className="list-decimal pl-4"><li>{t("the vendor's price list (with their minimum order and delivery time)")}</li><li>{t('the last price paid to this vendor')}</li><li>{t("the item's average cost")}</li></ol>
          <p>{t('Orders above the approval limit wait for an approver before they can be received.')}</p>
        </CardContent>
      </Card>
    )
  }
  const ordered = doc.lines.reduce((s, l) => s + num(l.line_subtotal), 0)
  const received = doc.lines.reduce((s, l) => s + num(l.line_subtotal) * Math.min(1, num(l.qty_received) / (num(l.quantity) || 1)), 0)
  const billed = doc.lines.reduce((s, l) => s + num(l.line_subtotal) * Math.min(1, num(l.qty_billed) / (num(l.quantity) || 1)), 0)
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>{t('Summary')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-[13px]">
          <Row k={t('Amount without VAT')}>{formatMoney(doc.subtotal)} {currency}</Row>
          <Row k={t('VAT')}>{formatMoney(doc.tax_total)} {currency}</Row>
          <Row k={t('Total (with VAT)')}><span className="text-base">{formatMoney(doc.total)} {currency}</span></Row>
          {currency !== base && <Row k={t('Total with VAT ({currency})', { currency: base })}>{formatMoney(doc.total_base)}</Row>}
          {doc.status !== 'draft' && <>
            <div className="mt-1 border-t pt-2" />
            <Row k={t('Received')}>{ordered ? Math.round((received / ordered) * 100) : 0}%</Row>
            <Row k={t('Billed')}>{ordered ? Math.round((billed / ordered) * 100) : 0}%</Row>
          </>}
          {(doc.requisition || doc.receipts.length > 0 || doc.bills.length > 0) && (
            <div className="mt-1 grid gap-1.5 border-t pt-2">
              {doc.requisition && <DocLink href={`/procurement/requisitions/${doc.requisition.id}`} label={t('Requisition {number}', { number: doc.requisition.number })} />}
              {doc.receipts.map((r) => <DocLink key={r.id} href={`/inventory/receipts/${r.id}`} label={`${r.number} · ${formatDate(r.receipt_date)}`} status={r.status} />)}
              {doc.bills.map((b) => <DocLink key={b.id} href={`/procurement/bills/${b.id}`} label={`${b.number} · ${b.vendor_invoice_number}`} status={b.status === 'posted' ? b.match_status : b.status} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tabular text-right font-medium">{children}</span></div>
}
function DocLink({ href, label, status }: { href: string; label: string; status?: string }) {
  return (
    <Link to={href} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-primary hover:bg-secondary">
      <span className="truncate">{label}</span>{status && <StatusBadge status={status} label={MATCH_LABEL[status] ? t(MATCH_LABEL[status]!) : undefined} />}
    </Link>
  )
}

function BillFromPoDialog({ open, onOpenChange, po }: { open: boolean; onOpenChange: (o: boolean) => void; po: PoDoc }) {
  const navigate = useNavigate()
  const bill = useBillOrder()
  const [number, setNumber] = React.useState('')
  const [date, setDate] = React.useState(todayISO())
  React.useEffect(() => { if (open) { setNumber(''); setDate(todayISO()) } }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enter the vendor's bill")}</DialogTitle>
          <DialogDescription>{t('Lines are filled in from {number}: what was received for goods, what was ordered for services. Adjust them to the paper bill; differences are flagged before posting.', { number: po.number })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="vin">{t("Vendor's invoice number")}</Label><Input id="vin" autoFocus value={number} onChange={(e) => setNumber(e.target.value)} placeholder={t('As printed on their invoice')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="vdate">{t('Invoice date')}</Label><Input id="vdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button disabled={!number.trim()} loading={bill.isPending} onClick={async () => {
            const id = await bill.mutateAsync({ id: po.id, vendorInvoice: number.trim(), date })
            onOpenChange(false); toast.success(t('Draft bill created')); navigate(`/procurement/bills/${id}`)
          }}>{t('Create bill')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ======================================================================== */
/*  Vendor bill                                                             */
/* ======================================================================== */
function BillForm({ doc }: { doc?: BillDoc }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, can } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const vendors = useActiveVendors()
  const currencies = useCurrencies()
  const terms = usePaymentTerms()
  const save = useSaveProcDocument('bills')
  const del = useDeleteProcDocument('bills')
  const setStatus = useSetProcStatus('bills')
  const matchBill = useMatchBill()
  const post = usePostBill()
  const credit = useVendorCredit()
  const [overrideOpen, setOverrideOpen] = React.useState(false)
  const isCredit = doc?.document_type === 'vendor_credit'
  const editable = (!doc || doc.status === 'draft') && can('invoicing.write')
  const canOverride = can('invoicing.write') && (can('procurement.approve') || can('invoicing.approve'))

  const form = useForm<BillValues>({
    resolver: zodResolver(billSchema),
    defaultValues: doc ? {
      vendor_id: doc.vendor_id, vendor_invoice_number: doc.vendor_invoice_number, doc_date: doc.bill_date, second_date: doc.due_date,
      currency_code: doc.currency_code, exchange_rate: doc.exchange_rate, payment_term_id: doc.payment_term_id, notes: doc.notes ?? '',
      lines: [...doc.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({
        key: l.id, variant_id: l.variant_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct,
        tax_code_id: l.tax_code_id, price_source: 'manual' as const, po_line_id: l.po_line_id, receipt_line_id: l.receipt_line_id, requisition_line_id: null,
        pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
      })),
    } : {
      vendor_id: params.get('vendor') ?? (undefined as unknown as string), vendor_invoice_number: '', doc_date: todayISO(), second_date: '',
      currency_code: base, exchange_rate: 1, payment_term_id: null, notes: '', lines: [],
    },
  })
  const [vendorId, currency] = useWatch({ control: form.control, name: ['vendor_id', 'currency_code'] })
  const onVendor = (id: string | null) => {
    form.setValue('vendor_id', id as string, { shouldValidate: true })
    const v = vendors.data?.find((x) => x.id === id)
    if (!v) return
    form.setValue('payment_term_id', v.payment_term_id)
    form.setValue('currency_code', v.currency_code ?? base)
  }
  const registry = useRegistryRemote('vendor', (id) => onVendor(id))

  const persist = async (v: BillValues) => save.mutateAsync({
    header: {
      id: doc?.id, vendor_id: v.vendor_id, vendor_invoice_number: v.vendor_invoice_number, bill_date: v.doc_date,
      due_date: v.second_date || v.doc_date, currency_code: v.currency_code, exchange_rate: v.exchange_rate,
      payment_term_id: v.payment_term_id ?? null, notes: v.notes || null,
    },
    lines: v.lines.map((l, i) => ({
      line_no: i + 1, variant_id: l.variant_id ?? null, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      discount_pct: l.discount_pct, tax_code_id: l.tax_code_id ?? null, po_line_id: l.po_line_id ?? null, receipt_line_id: l.receipt_line_id ?? null,
      pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
    })),
  })
  const go = (id: string) => navigate(`/procurement/bills/${id}`, { replace: true })
  const saveFirst = async () => {
    if (!editable) return doc?.id
    let id: string | undefined
    await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    return id
  }
  const saveOnly = form.handleSubmit(async (v) => { const id = await persist(v); toast.success(t('Draft saved')); if (!doc) go(id) },
    () => toast.error(t('Fix the highlighted fields first')))

  const savedMatch: Record<number, MatchLine> | undefined = doc && doc.match_status !== 'not_matched' && !isCredit
    ? Object.fromEntries(doc.lines.map((l) => [l.line_no, { line_no: l.line_no, status: l.match_status, qty_variance: l.qty_variance, price_variance: l.price_variance }]))
    : undefined
  const match = matchBill.data
    ? Object.fromEntries(matchBill.data.lines.map((l) => [l.line_no, l]))
    : savedMatch
  const matchStatus = matchBill.data?.status ?? doc?.match_status

  const doPost = async (reason?: string) => {
    const r = await post.mutateAsync({ id: doc!.id, overrideReason: reason })
    toast.success(isCredit ? t('Credit note posted') : t('Bill posted'), {
      description: num(r.capitalized_variance) !== 0 ? t('{amount} price difference added to stock value', { amount: `${formatMoney(r.capitalized_variance)} ${base}` }) : undefined,
    })
  }

  const actions: React.ReactNode[] = []
  if (doc && editable && !isCredit && doc.purchase_order_id) {
    actions.push(<Button key="match" variant="outline" loading={matchBill.isPending}
      onClick={async () => { const id = await saveFirst(); if (!id) return; const m = await matchBill.mutateAsync(id); toast[m.status === 'exception' ? 'error' : 'success'](m.status === 'exception' ? t('The bill does not match — see the flagged lines') : t('The bill matches the order and the goods received')) }}>
      <ClipboardCheck /> {t('Check against the order')}</Button>)
  }
  if (doc && editable) {
    actions.push(<ConfirmDialog key="post" trigger={<Button><FileText /> {isCredit ? t('Post credit note') : t('Post bill')}</Button>} title={isCredit ? t('Post this credit note?') : t('Post this bill?')}
      description={isCredit ? t('The billed quantities on the order are reduced and the amount owed to the vendor goes down.')
        : t('It is checked against the order and the goods received. A small price difference within tolerance updates the stock value. The bill can no longer be changed.')}
      confirmLabel={t('Post')}
      onConfirm={async () => {
        const id = await saveFirst(); if (!id) throw new Error('invalid')
        try { await doPost() } catch (e) {
          if (String((e as Error).message).includes('does not match')) {
            await matchBill.mutateAsync(id).catch(() => undefined)
            if (canOverride) setOverrideOpen(true)
          }
          throw e
        }
      }} />)
  }
  if (doc && doc.status === 'posted' && !isCredit && can('invoicing.write')) {
    actions.push(<Button key="cn" variant="outline" loading={credit.isPending}
      onClick={async () => { const id = await credit.mutateAsync(doc.id); toast.success(t('Draft credit note created — adjust it to the vendor’s document, then post it')); navigate(`/procurement/bills/${id}`) }}>
      <Undo2 /> {t('Record credit note')}</Button>)
  }
  if (doc && doc.status === 'posted' && !isCredit && Number(doc.amount_due) > 0 && can('invoicing.write')) {
    actions.push(<Button key="pay" asChild><Link to={`/finance/payments/new?type=vendor_payment&partner=${doc.vendor_id}&doc=${doc.id}`}>{t('Pay this bill')}</Link></Button>)
  }

  const body = (
    <>
      {matchStatus === 'exception' && doc?.status === 'draft' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2"><ShieldAlert className="size-4 text-destructive" /> {t('This bill does not match the order or the goods received. Correct the flagged lines to the order, or ask the vendor for a corrected bill.')}</span>
          {canOverride && <Button size="sm" variant="outline" onClick={() => setOverrideOpen(true)}>{t('Post anyway…')}</Button>}
        </div>
      )}
      {doc?.match_status === 'overridden' && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
          {t('Posted despite a mismatch. Reason:')} <span className="font-medium">{doc.match_override_reason}</span>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField control={form.control} name="vendor_id" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-1"><FormLabel>{t('Vendor')}</FormLabel>
                <FormControl><SearchSelect value={field.value} onChange={onVendor} disabled={!editable || !!doc?.purchase_order_id} placeholder={t('Choose a vendor')} remote={registry}
                  options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? v.code }))} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="vendor_invoice_number" render={({ field }) => (
              <FormItem><FormLabel>{isCredit ? t("Vendor's credit note no.") : t("Vendor's invoice no.")}</FormLabel><FormControl><Input disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="doc_date" render={({ field }) => (
              <FormItem><FormLabel>{t('Invoice date')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="payment_term_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Payment terms')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Immediate')} /></SelectTrigger></FormControl>
                  <SelectContent>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            <FormField control={form.control} name="second_date" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Due date')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl>
                {editable && <FormDescription>{t('Follows the payment terms when they change.')}</FormDescription>}</FormItem>
            )} />
            <CurrencyFields form={form} editable={editable && !doc?.purchase_order_id} base={base} currencies={(currencies.data ?? []).map((c) => c.code)} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-3"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} {...field} /></FormControl></FormItem>
            )} />
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <BillSidePanel doc={doc} currency={currency} base={base} matchStatus={matchStatus} vendorId={vendorId} />
          {doc && doc.status === 'posted' && doc.document_type === 'vendor_bill' && <WithholdingCard bill={doc} />}
        </div>
      </div>
      <PurchaseLinesEditor form={form} editable={editable} currency={currency} match={match} />
    </>
  )

  return (
    <Form {...form}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          back={{ href: '/procurement/bills', label: t('Vendor bills') }}
          title={<>{isCredit && <span className="mr-2 text-muted-foreground">{t('Credit note')}</span>}{doc ? doc.number : t('New vendor bill')}</>}
          meta={doc && <>
            <StatusBadge status={doc.status} />
            {doc.status === 'posted' && <StatusBadge status={doc.payment_status} />}
            {!isCredit && matchStatus && matchStatus !== 'not_matched' && <MatchBadge status={matchStatus} />}
          </>}
          description={doc ? `${doc.vendor?.name ?? ''} · ${t('invoice {number}', { number: doc.vendor_invoice_number })}` : t('For bills without a purchase order — or open the order and use “Enter bill”.')}
          actions={<Can perm="invoicing.read">
            {doc && editable && (
              <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete draft {number}?', { number: doc.number })}
                description={t('The draft disappears; its quantities can be billed again.')} confirmLabel={t('Delete draft')} destructive
                onConfirm={async () => { await del.mutateAsync(doc.id); navigate('/procurement/bills') }} />
            )}
            {doc && editable && <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: doc.id, status: 'cancelled' })}><Ban /> {t('Cancel bill')}</Button>}
            {doc && !isCredit && doc.status === 'posted' && doc.lines.some((l) => l.variant_id) && (
              <Button variant="outline" size="sm" asChild><Link to={`/inventory/labels?bill=${doc.id}`}><Tag /> {t('Labels')}</Link></Button>
            )}
            {editable && <Button variant="outline" onClick={() => void saveOnly()} loading={save.isPending}>{doc ? t('Save draft') : t('Create draft')}</Button>}
            {actions}
          </Can>}
        />
        {doc ? (
          <Tabs defaultValue="document">
            <TabsList><TabsTrigger value="document">{t('Document')}</TabsTrigger><TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger><TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
            <TabsContent value="document">{body}</TabsContent>
            <TabsContent value="accounting"><AccountingTab sourceType={doc.document_type} sourceId={doc.id} /></TabsContent>
            <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table="vendor_bills" id={doc.id} /></TabsContent>
          </Tabs>
        ) : body}
        {doc && <OverrideDialog open={overrideOpen} onOpenChange={setOverrideOpen} onConfirm={doPost} />}
      </div>
    </Form>
  )
}

export function MatchBadge({ status }: { status: string }) {
  const tone = status === 'matched' ? 'success' : status === 'exception' ? 'destructive' : status === 'overridden' ? 'warning' : 'secondary'
  const key = { matched: msg('Matches order and receipt'), exception: msg('Does not match'), overridden: msg('Posted despite mismatch'), not_applicable: msg('No order'), not_matched: msg('Not checked') }[status]
  const label = key ? t(key) : humanize(status)
  return <Badge variant={tone}>{label}</Badge>
}

function BillSidePanel({ doc, currency, base, matchStatus, vendorId }: { doc?: BillDoc; currency: string; base: string; matchStatus?: string; vendorId?: string }) {
  if (!doc) {
    return (
      <Card><CardHeader><CardTitle>{t('Checking against the order')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-[13px] text-muted-foreground">
          <p>{t('Bills entered from a purchase order are checked line by line:')}</p>
          <ul className="list-disc pl-4"><li>{t('quantity billed ≤ quantity received (services: ordered)')}</li><li>{t('price within the allowed difference from the order')}</li></ul>
          <p>{t('A bill typed in here without an order is posted as is.')}</p>
          {vendorId && <p><Link className="text-primary hover:underline" to={`/procurement/orders?vendor=${vendorId}`}>{t("This vendor's orders")}</Link></p>}
        </CardContent>
      </Card>
    )
  }
  const capitalized = doc.lines.reduce((s, l) => s + num(l.capitalized_variance), 0)
  const expensed = doc.lines.reduce((s, l) => s + num(l.expensed_variance), 0)
  return (
    <div className="grid gap-4">
    <Card>
      <CardHeader><CardTitle>{t('Summary')}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-[13px]">
        <Row k={t('Amount without VAT')}>{formatMoney(doc.subtotal)} {currency}</Row>
        <Row k={t('VAT')}>{formatMoney(doc.tax_total)} {currency}</Row>
        <Row k={t('Total (with VAT)')}><span className="text-base">{formatMoney(doc.total)} {currency}</span></Row>
        {currency !== base && <Row k={t('Total with VAT ({currency})', { currency: base })}>{formatMoney(doc.total_base)}</Row>}
        <Row k={t('Due date')}>{formatDate(doc.due_date)}</Row>
        {doc.status === 'posted' && <Row k={t('Still to pay (with VAT)')}>{formatMoney(doc.amount_due)} {currency}</Row>}
        {doc.document_type !== 'vendor_credit' && matchStatus && <Row k={t('Check against order')}><MatchBadge status={matchStatus} /></Row>}
        {(capitalized !== 0 || expensed !== 0) && <>
          <Row k={t('Added to stock value (without VAT)')}>{formatMoney(capitalized)} {base}</Row>
          {expensed !== 0 && <Row k={t('On goods already sold (without VAT)')}>{formatMoney(expensed)} {base}</Row>}
        </>}
        {(doc.order || doc.original || doc.receipt_id || (doc.credits?.length ?? 0) > 0) && (
          <div className="mt-1 grid gap-1.5 border-t pt-2">
            {doc.receipt_id && <DocLink href={`/inventory/receipts/${doc.receipt_id}`} label={t('The goods came in with the receipt')} />}
            {doc.order && <DocLink href={`/procurement/orders/${doc.order.id}`} label={t('Order {number}', { number: doc.order.number })} status={doc.order.status} />}
            {doc.original && <DocLink href={`/procurement/bills/${doc.original.id}`} label={t('Corrects {number}', { number: doc.original.number })} />}
            {doc.credits?.map((c) => <DocLink key={c.id} href={`/procurement/bills/${c.id}`} label={t('Credit note {number}', { number: c.number })} status={c.status} />)}
          </div>
        )}
      </CardContent>
    </Card>
    {doc.document_type === 'vendor_bill' && (
      <InstalmentsCard docType="vendor_bill" id={doc.id} total={num(doc.total)} date={doc.bill_date} status={doc.status} currency={currency} />
    )}
    </div>
  )
}

function OverrideDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Post despite the mismatch?')}</DialogTitle>
          <DialogDescription>{t('The reason and your name are stored on the bill and shown to auditors.')}</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('Reason')} placeholder={t('e.g. Agreed price increase from 1 Nov, confirmed by email')} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button disabled={reason.trim().length < 5} loading={busy} onClick={async () => {
            setBusy(true)
            try { await onConfirm(reason.trim()); onOpenChange(false) } catch { /* toast shown */ } finally { setBusy(false) }
          }}>{t('Post anyway')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
