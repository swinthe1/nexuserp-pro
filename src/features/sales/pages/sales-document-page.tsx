import { useQueryClient } from '@tanstack/react-query'
import { useRegistryRemote } from '@/lib/registry'
import { DocumentActions } from '@/components/document-actions'
import { AdvanceButton, AdvancesCard } from '../components/advances'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Ban, Check, CheckCheck, FileText, PackageCheck, PackageOpen, Receipt, Repeat, RotateCcw, Send, ShoppingCart, Trash2, Truck, Undo2, X,
} from 'lucide-react'
import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { useGuard } from '@/components/guard'
import { isOfflineId } from '@/lib/offline/step'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCurrencies, useWarehouses } from '@/features/inventory/api'
import {
  useConfirmOrder, useConvertQuote, useCreateDelivery, useCreateInvoice, useCreditNote, useCustomers, useDeleteSalesDocument,
  useMembers, useOrderAvailability, usePaymentTerms, usePostInvoice, usePriceLists, useReserveOrder, useSalesDocument,
  useSaveSalesDocument, useSetStatus, type SalesKind,
} from '../api'
import { SalesLinesEditor, type LineProgress } from '../components/sales-lines-editor'
import { salesDocSchema, type SalesDocValues } from '../schemas'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import { ErrorState } from '@/components/error-state'
import { RepeatInvoiceDialog } from '../recurring'
import { msg, t, td, tr } from '@/i18n'

type DocKind = Exclude<SalesKind, 'deliveries'>
type AnyLine = Tables<'sales_quote_lines'> & Partial<Tables<'sales_order_lines'>> & Partial<Tables<'sales_invoice_lines'>>
type Doc = Record<string, unknown> & {
  id: string; number: string; status: string; partner_id: string; currency_code: string; exchange_rate: number
  payment_term_id: string | null; salesperson_id: string | null; notes: string | null; created_at: string
  total: number; total_base: number; subtotal: number; tax_total: number; lines: AnyLine[]
}

const CFG: Record<DocKind, {
  title: string; newTitle: string; list: string; table: string; date: string; second: string; secondLabel: string; writePerm: string
}> = {
  quotes: { title: msg('Quote not found'), newTitle: msg('New quote'), list: '/sales/quotes', table: 'sales_quotes', date: 'quote_date', second: 'valid_until', secondLabel: msg('Valid until'), writePerm: 'sales.write' },
  orders: { title: msg('Sales order not found'), newTitle: msg('New sales order'), list: '/sales/orders', table: 'sales_orders', date: 'order_date', second: 'requested_date', secondLabel: msg('Requested delivery'), writePerm: 'sales.write' },
  invoices: { title: msg('Invoice not found'), newTitle: msg('New invoice'), list: '/sales/invoices', table: 'sales_invoices', date: 'invoice_date', second: 'due_date', secondLabel: msg('Due date'), writePerm: 'invoicing.write' },
}

export function SalesDocumentPage({ kind }: { kind: DocKind }) {
  const { id } = useParams()
  const doc = useSalesDocument<Doc>(kind, id)
  if (id && doc.isLoading) return <Skeleton className="mx-auto h-[480px] max-w-6xl" />
  if (id && doc.isError) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
  if (id && !doc.data) return <EmptyState title={t(CFG[kind].title)} description={t('It may have been deleted.')} action={<Button asChild variant="outline"><Link to={CFG[kind].list}>{t('Back to the list')}</Link></Button>} />
  return <SalesDocumentForm key={`${doc.data?.id ?? 'new'}-${doc.data?.status ?? ''}-${doc.data?.updated_at ?? ''}`} kind={kind} doc={doc.data} />
}

function SalesDocumentForm({ kind, doc }: { kind: DocKind; doc?: Doc }) {
  const cfg = CFG[kind]
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, can } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const customers = useCustomers()
  const priceLists = usePriceLists()
  const terms = usePaymentTerms()
  const members = useMembers()
  const warehouses = useWarehouses()
  const currencies = useCurrencies()
  const save = useSaveSalesDocument(kind)
  const setStatus = useSetStatus(kind)
  const del = useDeleteSalesDocument(kind)
  const convert = useConvertQuote()
  const confirm = useConfirmOrder()
  const reserve = useReserveOrder()
  const createDelivery = useCreateDelivery()
  const createInvoice = useCreateInvoice()
  const postInvoice = usePostInvoice()
  const guard = useGuard()
  const creditNote = useCreditNote()
  const [repeat, setRepeat] = React.useState(false)

  const isCredit = kind === 'invoices' && doc?.document_type === 'credit_note'
  const editable = (!doc || doc.status === 'draft') && can(cfg.writePerm)
  const isOpenOrder = kind === 'orders' && !!doc && ['confirmed', 'partially_delivered'].includes(doc.status)
  const availability = useOrderAvailability(doc?.id, isOpenOrder)

  const form = useForm<SalesDocValues>({
    resolver: zodResolver(salesDocSchema),
    defaultValues: doc ? {
      partner_id: doc.partner_id, doc_date: doc[cfg.date] as string, second_date: (doc[cfg.second] as string | null) ?? '',
      currency_code: doc.currency_code, exchange_rate: doc.exchange_rate, price_list_id: (doc.price_list_id as string | null) ?? null,
      payment_term_id: doc.payment_term_id, salesperson_id: doc.salesperson_id, warehouse_id: (doc.warehouse_id as string | null) ?? null,
      customer_reference: (doc.customer_reference as string | null) ?? '', notes: doc.notes ?? '', terms: (doc.terms as string | null) ?? '',
      lines: [...doc.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({
        key: l.id, variant_id: l.variant_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
        discount_pct: l.discount_pct, tax_code_id: l.tax_code_id, price_source: 'manual' as const, sales_order_line_id: l.sales_order_line_id ?? null,
        pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
        advance_invoice_id: (l as { advance_invoice_id?: string | null }).advance_invoice_id ?? null, account_id: (l as { account_id?: string | null }).account_id ?? null,
      })),
    } : {
      partner_id: params.get('customer') ?? (undefined as unknown as string), doc_date: todayISO(),
      second_date: kind === 'quotes' ? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) : '',
      currency_code: base, exchange_rate: 1, price_list_id: null, payment_term_id: null, salesperson_id: null,
      warehouse_id: null, customer_reference: '', notes: '', terms: '', lines: [],
    },
  })
  const [partnerId, currency] = useWatch({ control: form.control, name: ['partner_id', 'currency_code'] })
  const partner = customers.data?.find((c) => c.id === partnerId)

  React.useEffect(() => {
    if (!doc && kind === 'orders' && !form.getValues('warehouse_id') && warehouses.data?.length) form.setValue('warehouse_id', warehouses.data[0]!.id)
  }, [doc, kind, warehouses.data, form])

  const onCustomer = (id: string | null) => {
    form.setValue('partner_id', id as string, { shouldValidate: true })
    const c = customers.data?.find((x) => x.id === id)
    if (!c) return
    form.setValue('price_list_id', c.price_list_id)
    form.setValue('payment_term_id', c.payment_term_id)
    if (c.salesperson_id) form.setValue('salesperson_id', c.salesperson_id)
    if (c.currency_code) form.setValue('currency_code', c.currency_code)
  }
  const registry = useRegistryRemote('customer', (id) => onCustomer(id))

  const persist = async (v: SalesDocValues) => {
    const header: Record<string, unknown> = {
      id: doc?.id, partner_id: v.partner_id, [cfg.date]: v.doc_date, currency_code: v.currency_code, exchange_rate: v.exchange_rate,
      price_list_id: v.price_list_id ?? null, payment_term_id: v.payment_term_id ?? null, salesperson_id: v.salesperson_id ?? null,
      notes: v.notes || null, terms: v.terms || null, customer_reference: v.customer_reference || null, warehouse_id: v.warehouse_id ?? null,
      opportunity_id: !doc && kind === 'quotes' ? params.get('opportunity') : undefined,
    }
    if (v.second_date) header[cfg.second] = v.second_date
    else if (kind !== 'invoices') header[cfg.second] = null
    if (kind === 'invoices' && !v.second_date) header.due_date = v.doc_date
    if (!doc && kind === 'orders' && !v.warehouse_id) throw new Error(t('Choose a warehouse'))
    const kindName = kind === 'quotes' ? t('Quote') : kind === 'orders' ? t('Sales order') : t('Invoice')
    return save.mutateAsync({
      header,
      label: t('{kind}: {n} lines, {amount} without VAT', { kind: kindName, n: v.lines.length,
        amount: v.lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 - Number(l.discount_pct || 0) / 100), 0).toFixed(2) }),
      lines: v.lines.map((l, i) => ({
        line_no: i + 1, variant_id: l.variant_id ?? null, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
        discount_pct: l.discount_pct, tax_code_id: l.tax_code_id ?? null, sales_order_line_id: l.sales_order_line_id ?? null,
        pack_id: l.pack_id ?? null, pack_qty: l.pack_qty ?? null,
        advance_invoice_id: (l as { advance_invoice_id?: string | null }).advance_invoice_id ?? null, account_id: (l as { account_id?: string | null }).account_id ?? null,
      })),
    })
  }
  const saveOnly = form.handleSubmit(async (v) => {
    const id = await persist(v)
    if (isOfflineId(id)) { toast.success(t('Saved on this device'), { description: t('The draft is sent when the connection is back; its number comes then.') }); navigate(cfg.list); return }
    toast.success(t('Draft saved'))
    if (!doc) navigate(`${cfg.list}/${id}`, { replace: true })
  }, () => toast.error(t('Fix the highlighted fields first')))
  /** saves the draft (if editable) and returns its id, or undefined if the form is invalid */
  const saveFirst = async () => {
    if (!editable) return doc?.id
    let id: string | undefined
    await form.handleSubmit(async (v) => { id = await persist(v) }, () => toast.error(t('Fix the highlighted fields first')))()
    if (isOfflineId(id)) {
      toast.success(t('Saved on this device as a draft'), { description: t('Confirming or posting needs internet; do it when the connection is back.') })
      navigate(cfg.list); return undefined
    }
    return id
  }
  const go = (id: string) => navigate(`${cfg.list}/${id}`, { replace: true })

  /* -------------------------------------------------------- actions */
  const actions: React.ReactNode[] = []
  if (kind === 'quotes' && doc) {
    if (doc.status === 'draft') actions.push(<Button key="send" variant="outline" onClick={async () => { const id = await saveFirst(); if (id) { await setStatus.mutateAsync({ id, status: 'sent' }); toast.success(t('Quote marked as sent')) } }}><Send /> {t('Mark as sent')}</Button>)
    if (doc.status === 'sent') {
      actions.push(<Button key="rej" variant="ghost" onClick={() => setStatus.mutate({ id: doc.id, status: 'rejected' })}><X /> {t('Customer said no')}</Button>)
      actions.push(<Button key="back" variant="ghost" onClick={() => setStatus.mutate({ id: doc.id, status: 'draft' })}><Undo2 /> {t('Edit again')}</Button>)
    }
    if (['sent', 'accepted'].includes(doc.status)) {
      actions.push(<ConfirmDialog key="conv" trigger={<Button><ShoppingCart /> {t('Create order')}</Button>} title={t('Turn this quote into a sales order?')}
        description={t('The customer accepted. A draft sales order is created with the same lines and prices, and the deal is marked as won.')} confirmLabel={t('Create order')}
        onConfirm={async () => { const so = await convert.mutateAsync(doc.id); toast.success(t('Sales order created')); navigate(`/sales/orders/${so}`) }} />)
    }
    if (['rejected', 'expired'].includes(doc.status)) actions.push(<Button key="reopen" variant="outline" onClick={() => setStatus.mutate({ id: doc.id, status: 'draft' })}><RotateCcw /> {t('Reopen as draft')}</Button>)
  }
  if (kind === 'orders' && (!doc || doc.status === 'draft') && can('sales.write')) {
    {
      actions.push(<ConfirmDialog key="conf" trigger={<Button><Check /> {t('Confirm order')}</Button>} title={t('Confirm this order?')}
        description={t("The order is checked against the discount limits and the customer's credit limit, then stock is reserved in the warehouse. Lines can't be changed afterwards.")}
        confirmLabel={t('Confirm order')}
        onConfirm={async () => {
          const id = await saveFirst(); if (!id) throw new Error('invalid')
          // a new order is saved first; if confirmation is refused, open the saved draft so it isn't created twice
          const status = await confirm.mutateAsync(id).catch((e) => { if (!doc) go(id); throw e })
          if (status === 'pending_approval') toast.message(t('Sent for approval'), { description: t('The approver has been notified.') })
          else toast.success(t('Order confirmed'), { description: t('Available stock has been reserved.') })
          go(id)
        }} />)
    }
  }
  if (kind === 'orders' && doc) {
    if (isOpenOrder) {
      if (availability.data?.some((a) => num(a.to_reserve) > 0 && num(a.available) > 0)) {
        actions.push(<Button key="res" variant="outline" loading={reserve.isPending} onClick={async () => { const n = await reserve.mutateAsync(doc.id); toast.success(t('{qty} more reserved', { qty: formatQty(n) })) }}><PackageOpen /> {t('Reserve stock')}</Button>)
      }
      const deliverable = availability.data?.some((a) => a.is_stockable && num(a.ordered) - num(a.delivered) > 0 && num(a.reserved) + num(a.available) > 0)
      if (deliverable && (can('wms.write') || can('sales.write'))) {
        actions.push(<Button key="del" variant="outline" loading={createDelivery.isPending} onClick={async () => { const d = await createDelivery.mutateAsync(doc.id); toast.success(t('Delivery created')); navigate(`/sales/deliveries/${d}`) }}><Truck /> {t('Create delivery')}</Button>)
      }
    }
    if (['confirmed', 'partially_delivered'].includes(doc.status) && doc.invoice_status !== 'invoiced' && can('invoicing.write')) {
      actions.push(<AdvanceButton key="adv" order={{ id: doc.id, total: num(doc.total), currency_code: doc.currency_code as string }} />)
    }
    if (['confirmed', 'partially_delivered', 'delivered', 'closed'].includes(doc.status) && doc.invoice_status !== 'invoiced' && can('invoicing.write')) {
      actions.push(<Button key="inv" loading={createInvoice.isPending} onClick={async () => { const i = await createInvoice.mutateAsync(doc.id); toast.success(t('Draft invoice created')); navigate(`/sales/invoices/${i}`) }}><Receipt /> {t('Create invoice')}</Button>)
    }
    if (doc.status === 'partially_delivered') {
      actions.push(<ConfirmDialog key="close" trigger={<Button variant="ghost"><CheckCheck /> {t('Close order')}</Button>} title={t('Close the order without delivering the rest?')}
        description={t("The rest of the order won't be delivered. Its reserved stock is released.")} confirmLabel={t('Close order')}
        onConfirm={() => setStatus.mutateAsync({ id: doc.id, status: 'closed' })} />)
    }
    if (['pending_approval', 'confirmed'].includes(doc.status) && doc.lines.every((l) => !num(l.qty_delivered))) {
      actions.push(<ConfirmDialog key="cancel" trigger={<Button variant="ghost" className="text-destructive"><Ban /> {t('Cancel order|sales')}</Button>} title={t('Cancel {number}?', { number: doc.number })}
        description={t('Reserved stock is released. The order stays on record as cancelled.')} confirmLabel={t('Cancel order|sales')} destructive
        onConfirm={() => setStatus.mutateAsync({ id: doc.id, status: 'cancelled', extra: { cancel_reason: t('Cancelled by user') } })} />)
    }
  }
  if (kind === 'invoices' && (!doc || doc.status === 'draft') && can('invoicing.write')) {
    {
      actions.push(<ConfirmDialog key="post" trigger={<Button><FileText /> {isCredit ? t('Post credit note') : t('Post invoice')}</Button>} title={isCredit ? t('Post this credit note?') : t('Post this invoice?')}
        description={<>{t('It gets its final number and can no longer be changed — corrections are made with a credit note.')}{' '}
          {company?.country_code === 'AL' || company?.country_code === 'XK' ? t('It is sent to the tax authority for fiscalization.') : ''}</>}
        confirmLabel={t('Post')}
        onConfirm={async () => {
          const id = await saveFirst(); if (!id) throw new Error('invalid')
          // the guard: what looks unusual against earlier invoices, before anything is posted
          if (!(await guard.check('sales_invoice', id))) { if (!doc) go(id); return }
          await postInvoice.mutateAsync(id).catch((e) => { if (!doc) go(id); throw e }); toast.success(isCredit ? t('Credit note posted') : t('Invoice posted')); go(id)
        }} />)
    }
  }
  if (kind === 'invoices' && doc) {
    if (doc.status === 'posted' && !isCredit) {
      actions.push(<Button key="cn" variant="outline" loading={creditNote.isPending} onClick={async () => { const cn = await creditNote.mutateAsync(doc.id); toast.success(t('Draft credit note created — adjust the lines, then post it')); navigate(`/sales/invoices/${cn}`) }}><Undo2 /> {t('Credit note')}</Button>)
    }
    if (!isCredit && can('invoicing.write')) {
      actions.push(<Button key="repeat" variant="outline" onClick={() => setRepeat(true)}><Repeat /> {t('Repeat')}</Button>)
    }
    if (doc.status === 'posted' && !isCredit && Number(doc.amount_due) > 0 && can('invoicing.write')) {
      actions.push(<Button key="pay" asChild><Link to={`/finance/payments/new?type=customer_payment&partner=${doc.partner_id}&doc=${doc.id}`}>{t('Record payment')}</Link></Button>)
    }
  }

  const progress: Record<number, LineProgress> | undefined = kind === 'orders' && doc && doc.status !== 'draft'
    ? Object.fromEntries([...doc.lines].sort((a, b) => a.line_no - b.line_no).map((l, i) => [i, { ordered: l.quantity, delivered: l.qty_delivered ?? 0, invoiced: l.qty_invoiced ?? 0, reserved: l.qty_reserved ?? 0 }]))
    : undefined

  const title = doc ? doc.number : t(cfg.newTitle)
  const body = (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField control={form.control} name="partner_id" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-1"><FormLabel>{t('Customer')}</FormLabel>
                <FormControl><SearchSelect value={field.value} onChange={onCustomer} disabled={!editable} placeholder={t('Choose a customer')} remote={registry}
                  options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.tax_number ?? c.code, keywords: [c.code] }))} /></FormControl>
                {partner && <FormDescription>{[partner.email, partner.phone].filter(Boolean).join(' · ') || partner.code}{num(partner.default_discount_pct) > 0 && ` · ${t('{pct}% customer discount', { pct: partner.default_discount_pct })}`}</FormDescription>}
                <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="doc_date" render={({ field }) => (
              <FormItem><FormLabel>{kind === 'quotes' ? t('Quote date') : kind === 'orders' ? t('Order date') : t('Invoice date')}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="second_date" render={({ field }) => (
              <FormItem><FormLabel optional={kind !== 'quotes'}>{t(cfg.secondLabel)}</FormLabel><FormControl><Input type="date" disabled={!editable} {...field} /></FormControl>
                {kind === 'invoices' && editable && <FormDescription>{t('Leave empty to follow the payment terms.')}</FormDescription>}</FormItem>
            )} />
            {kind !== 'invoices' && (
              <FormField control={form.control} name="price_list_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Price list')}</FormLabel>
                  <Select value={field.value ?? '__auto'} onValueChange={(v) => field.onChange(v === '__auto' ? null : v)} disabled={!editable}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__auto">{t("Customer's or default list")}</SelectItem>
                      {(priceLists.data ?? []).filter((p) => p.is_active).map((p) => <SelectItem key={p.id} value={p.id}>{td(p.name)} ({p.currency_code})</SelectItem>)}
                    </SelectContent>
                  </Select></FormItem>
              )} />
            )}
            <FormField control={form.control} name="payment_term_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Payment terms')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Immediate')} /></SelectTrigger></FormControl>
                  <SelectContent>{(terms.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{td(x.name)}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            <FormField control={form.control} name="salesperson_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Salesperson')}</FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t('Unassigned')} /></SelectTrigger></FormControl>
                  <SelectContent>{(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent>
                </Select></FormItem>
            )} />
            {kind === 'orders' && (
              <FormField control={form.control} name="warehouse_id" render={({ field }) => (
                <FormItem><FormLabel>{t('Send from')}</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!editable}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t('Warehouse')} /></SelectTrigger></FormControl>
                    <SelectContent>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
            )}
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <FormField control={form.control} name="currency_code" render={({ field }) => (
                <FormItem><FormLabel>{t('Currency')}</FormLabel>
                  <Select value={field.value} onValueChange={(v) => { field.onChange(v); if (v === base) form.setValue('exchange_rate', 1) }} disabled={!editable}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{(currencies.data ?? []).map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
              <FormField control={form.control} name="exchange_rate" render={({ field }) => (
                <FormItem><FormLabel>{t('Exchange rate')}</FormLabel><FormControl><Input type="number" step="any" disabled={!editable || currency === base} {...field} /></FormControl>
                  <FormDescription>{currency === base ? t('Company currency') : t('{base} per 1 {currency}', { base, currency })}</FormDescription><FormMessage /></FormItem>
              )} />
            </div>
            {kind === 'orders' && (
              <FormField control={form.control} name="customer_reference" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Customer order no.')}</FormLabel><FormControl><Input disabled={!editable} {...field} /></FormControl></FormItem>
              )} />
            )}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="sm:col-span-2 lg:col-span-3"><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} {...field} /></FormControl></FormItem>
            )} />
            {kind === 'quotes' && (
              <FormField control={form.control} name="terms" render={({ field }) => (
                <FormItem className="sm:col-span-2 lg:col-span-3"><FormLabel optional>{t('Terms shown to the customer')}</FormLabel><FormControl><Textarea rows={2} disabled={!editable} placeholder={t('Delivery within 7 working days. Prices exclude VAT.')} {...field} /></FormControl></FormItem>
              )} />
            )}
          </CardContent>
        </Card>
        <SidePanel kind={kind} doc={doc} availability={availability.data} currency={currency} base={base} />
      </div>
      <SalesLinesEditor form={form} editable={editable} currency={currency} progress={progress} showProgress={!!progress} />
    </>
  )

  return (
    <Form {...form}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          back={{ href: cfg.list, label: kind === 'quotes' ? t('Quotes') : kind === 'orders' ? t('Sales orders') : t('Invoices') }}
          title={<>{isCredit && <span className="mr-2 text-muted-foreground">{t('Credit note')}</span>}{kind === 'invoices' && doc?.is_advance && <span className="mr-2 text-muted-foreground">{t('Advance invoice')}</span>}{title}</>}
          meta={doc && <>
            <StatusBadge status={doc.status} />
            {kind === 'orders' && doc.status !== 'draft' && <StatusBadge status={doc.invoice_status as string} />}
            {kind === 'invoices' && doc.status === 'posted' && <StatusBadge status={doc.payment_status as string} />}
          </>}
          description={doc ? t('Created {date}', { date: formatDate(doc.created_at, true) }) : undefined}
          actions={<>{doc && <DocumentActions id={doc.id} kind={kind === 'quotes' ? 'sales_quote' : kind === 'orders' ? 'sales_order' : 'sales_invoice'}
            alt={kind === 'quotes' ? [{ kind: 'proforma_quote', label: t('pro forma') }] : kind === 'orders' ? [{ kind: 'proforma', label: t('pro forma') }] : undefined} />}<Can perm={kind === 'orders' ? 'sales.read' : cfg.writePerm}>
            {doc && editable && (
              <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete draft {number}?', { number: doc.number })}
                description={t('The draft disappears from the lists. Its number is not used again.')} confirmLabel={t('Delete draft')} destructive
                onConfirm={async () => { await del.mutateAsync(doc.id); navigate(cfg.list) }} />
            )}
            {editable && <Button variant={doc ? 'outline' : 'default'} onClick={() => void saveOnly()} loading={save.isPending}>{doc ? t('Save draft') : t('Create draft')}</Button>}
            {actions}
          </Can></>}
        />
        {doc?.status === 'pending_approval' && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">
            {tr('Waiting for approval. It will be confirmed and stock reserved as soon as it is approved — see {link}.', { link: <Link to="/approvals" className="text-primary hover:underline">{t('Approvals')}</Link> })}
          </div>
        )}
        {doc ? (
          <Tabs defaultValue="document">
            <TabsList><TabsTrigger value="document">{t('Document')}</TabsTrigger>{kind === 'invoices' && <TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger>}<TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
            <TabsContent value="document">{body}</TabsContent>
            <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table={cfg.table} id={doc.id} /></TabsContent>
            {kind === 'invoices' && <TabsContent value="accounting"><AccountingTab sourceType={doc.document_type as string} sourceId={doc.id} /></TabsContent>}
          </Tabs>
        ) : body}
      </div>
      {repeat && doc && <RepeatInvoiceDialog invoice={{ id: doc.id, number: doc.number as string, date: doc.invoice_date as string }} onClose={() => setRepeat(false)} />}
      {guard.dialog}
    </Form>
  )
}

function SidePanel({ kind, doc, availability, currency, base }: {
  kind: DocKind; doc?: Doc; currency: string; base: string
  availability?: { line_id: string | null; sku: string | null; ordered: number | null; reserved: number | null; delivered: number | null; to_reserve: number | null; available: number | null; incoming: number | null; is_stockable: boolean | null }[]
}) {
  const qc = useQueryClient()
  if (!doc) {
    return (
      <Card><CardHeader><CardTitle>{t('How prices are filled in')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-[13px] text-muted-foreground">
          <p>{t('Choosing a product fills in its price automatically, in this order:')}</p>
          <ol className="list-decimal pl-4">
            <li>{t('a special price agreed with this customer')}</li>
            <li>{t("the customer's price list (or the one chosen here), with prices by quantity")}</li>
            <li>{t("the product's own price")}</li>
          </ol>
          <p>{t("The customer's standard discount applies unless the price has its own. You can always type a different price.")}</p>
        </CardContent>
      </Card>
    )
  }
  const rows: [React.ReactNode, React.ReactNode][] = [
    [t('Amount without VAT'), `${formatMoney(doc.subtotal)} ${currency}`],
    [t('VAT'), `${formatMoney(doc.tax_total)} ${currency}`],
    [t('Total with VAT'), <span className="text-base">{formatMoney(doc.total)} {currency}</span>],
  ]
  if (currency !== base) rows.push([t('Total with VAT ({currency})', { currency: base }), formatMoney(doc.total_base)])
  if (kind === 'invoices' && doc.status === 'posted') rows.push([t('Still to pay (with VAT)'), `${formatMoney(doc.amount_due as number)} ${currency}`])

  const links: { label: string; href: string; status?: string }[] = []
  if (kind === 'quotes') {
    const opp = doc.opportunity as { id: string; name: string } | null
    if (opp) links.push({ label: t('Deal: {name}', { name: opp.name }), href: `/crm/pipeline?open=${opp.id}` })
    ;((doc.orders as { id: string; number: string; status: string }[] | null) ?? []).forEach((o) => links.push({ label: o.number, href: `/sales/orders/${o.id}`, status: o.status }))
  }
  if (kind === 'orders') {
    const q = doc.quote as { id: string; number: string } | null
    if (q) links.push({ label: t('Quote {number}', { number: q.number }), href: `/sales/quotes/${q.id}` })
    ;((doc.deliveries as { id: string; number: string; status: string }[] | null) ?? []).forEach((d) => links.push({ label: d.number, href: `/sales/deliveries/${d.id}`, status: d.status }))
    ;((doc.invoices as { id: string; number: string; status: string; deleted_at?: string | null }[] | null) ?? []).filter((i) => !i.deleted_at).forEach((i) => links.push({ label: i.number, href: `/sales/invoices/${i.id}`, status: i.status }))
  }
  if (kind === 'invoices') {
    const o = doc.order as { id: string; number: string } | null
    if (o) links.push({ label: t('Order {number}', { number: o.number }), href: `/sales/orders/${o.id}` })
    const orig = doc.original as { id: string; number: string } | null
    if (orig) links.push({ label: t('Corrects {number}', { number: orig.number }), href: `/sales/invoices/${orig.id}` })
  }
  const fiscal = kind === 'invoices' ? ((doc.fiscal as { status: string; iic: string | null; fic: string | null; error_message: string | null }[] | null) ?? [])[0] : undefined

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>{t('Summary')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-[13px]">
          {rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tabular font-medium">{v}</span></div>)}
          {kind === 'invoices' && doc.status === 'posted' && (
            <div className="mt-1 flex justify-between gap-3 border-t pt-2"><span className="text-muted-foreground">{t('Fiscalization')}</span>
              <span className="text-right"><StatusBadge status={doc.fiscal_status as string} />{fiscal?.fic && <div className="mt-1 font-mono text-2xs">{fiscal.fic}</div>}</span>
            </div>
          )}
          {links.length > 0 && (
            <div className="mt-1 grid gap-1.5 border-t pt-2">
              {links.map((l) => (
                <Link key={l.href} to={l.href} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-primary hover:bg-secondary">
                  <span className="truncate">{l.label}</span>{l.status && <StatusBadge status={l.status} />}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {kind === 'orders' && availability && availability.some((a) => a.is_stockable) && (
        <Card>
          <CardHeader><CardTitle>{t('Stock for this order')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-[13px]">
            {availability.filter((a) => a.is_stockable).map((a) => {
              const open = num(a.ordered) - num(a.delivered)
              const short = num(a.to_reserve)
              return (
                <div key={a.line_id} className="grid gap-0.5">
                  <div className="flex justify-between"><span className="font-medium">{a.sku}</span>
                    {open <= 0 ? <Badge variant="success"><PackageCheck className="size-3" /> {t('Delivered')}</Badge>
                      : short > 0 ? <Badge variant="warning">{t('{qty} waiting for stock', { qty: formatQty(short) })}</Badge> : <Badge variant="success">{t('Reserved')}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {open <= 0 ? t('All {qty} delivered', { qty: formatQty(a.ordered) }) : <>{t('Reserved {reserved} of {open} open · {free} free in the warehouse', { reserved: formatQty(a.reserved), open: formatQty(open), free: formatQty(a.available) })}{num(a.incoming) > 0 && ` · ${t('{qty} incoming', { qty: formatQty(a.incoming) })}`}</>}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
      {kind === 'orders' && doc.status !== 'draft' && <AdvancesCard orderId={doc.id} />}
      {kind === 'invoices' && doc.status === 'draft' && doc.document_type === 'sales_invoice' && !doc.is_advance && (
        <AdvancesCard partnerId={doc.partner_id as string} draftInvoiceId={doc.id} onDeducted={() => void qc.invalidateQueries({ queryKey: ['sales'] })} />
      )}
      {kind === 'orders' && doc.status === 'draft' && <p className={cn('px-1 text-xs text-muted-foreground')}>{t("Confirming checks the discount limit and the customer's credit, then reserves stock.")}</p>}
    </div>
  )
}
