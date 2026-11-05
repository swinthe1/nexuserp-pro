import { DocumentActions } from '@/components/document-actions'
import type { ColumnDef } from '@tanstack/react-table'
import { CashLimitWarning } from '../components/cash-limits'
import { ArrowDownLeft, ArrowUpRight, Trash2, Undo2, Wand2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tEnum, tr } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { usePartners } from '@/features/sales/api'
import {
  finKeys, useBankAccounts, useDeletePayment, useOpenDocuments, usePayment, usePayments, usePostPayment, useReversePayment, useSavePayment,
  type PaymentDetail, type PaymentRow,
} from '../api'
import { AccountingTab } from '../components/t-accounts'
import { CashBook, useCashAccounts } from '../components/cash-book'

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'offset', 'other'] as const

export function PaymentsPage() {
  const navigate = useNavigate()
  const { company, companyId } = useCompany()
  const payments = usePayments()
  useRealtimeInvalidate('payments', companyId, [finKeys.list(companyId, 'payments')])
  const columns = React.useMemo<ColumnDef<PaymentRow>[]>(() => [
    { accessorKey: 'payment_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    {
      accessorKey: 'document_type', filterFn: inFilter, header: t('Direction'), meta: { label: t('Direction') },
      cell: ({ getValue }) => getValue() === 'customer_payment'
        ? <span className="inline-flex items-center gap-1 text-success"><ArrowDownLeft className="size-3.5" /> {t('Received|payment')}</span>
        : <span className="inline-flex items-center gap-1"><ArrowUpRight className="size-3.5 text-muted-foreground" /> {t('Paid out')}</span>,
    },
    { id: 'partner', accessorFn: (r) => r.partner?.name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Partner')} />, meta: { label: t('Partner') } },
    { accessorKey: 'amount', header: ({ column }) => <ColumnHeader column={column} title={t('Amount')} />, meta: { label: t('Amount'), align: 'right' },
      cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.amount)} <span className="text-muted-foreground">{r.currency_code !== company?.base_currency ? r.currency_code : ''}</span></span> },
    { id: 'bank', accessorFn: (r) => td(r.bank?.name ?? ''), filterFn: inFilter, header: t('Bank or cash'), meta: { label: t('Bank or cash account') } },
    { accessorKey: 'method', filterFn: inFilter, header: t('Method'), meta: { label: t('Method') }, cell: ({ getValue }) => tEnum(getValue() as string) },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'unallocated', header: t('Not matched'), meta: { label: t('Not matched'), align: 'right' }, cell: ({ getValue }) => num(getValue()) ? <span className="tabular text-warning">{formatMoney(getValue() as number)}</span> : '—' },
  ], [company?.base_currency])
  const banks = [...new Set((payments.data ?? []).map((p) => td(p.bank?.name)).filter(Boolean))] as string[]
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'cash' ? 'cash' : 'list'
  // the unit of a payment: the unit of its cash account (a till's drawer, a unit's safe)
  const cashAccounts = useCashAccounts()
  const unitsOf = React.useMemo(() => new Map((cashAccounts.data ?? []).map((a) => [a.id, a.units.map((u) => td(u.name))])), [cashAccounts.data])
  const unitNames = [...new Set((cashAccounts.data ?? []).flatMap((a) => a.units.map((u) => td(u.name))))]
  const unitColumn = React.useMemo<ColumnDef<PaymentRow>[]>(() => unitNames.length ? [{ id: 'unit', accessorFn: (r) => (unitsOf.get(r.bank_account_id) ?? []).join(', '),
    filterFn: (row, id, v: string[]) => !v?.length || v.some((u) => String(row.getValue(id)).split(', ').includes(u)), header: t('Unit|store'), meta: { label: t('Unit|store') } }] : [], [unitsOf]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title={t('Payments|menu')} description={t('Money received from customers and paid to vendors, matched to their invoices. Posting records the bank movement and settles the invoices.')}
        actions={<Can perm="invoicing.write">
          <Button variant="outline" asChild><Link to="/finance/payments/new?type=vendor_payment"><ArrowUpRight /> {t('Pay a vendor')}</Link></Button>
          <Button asChild><Link to="/finance/payments/new?type=customer_payment"><ArrowDownLeft /> {t('Receive a payment')}</Link></Button>
        </Can>} />
      <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'cash') n.set('tab', 'cash'); else n.delete('tab'); return n }, { replace: true })} className="mb-3">
        <TabsList><TabsTrigger value="list">{t('Payments|menu')}</TabsTrigger><TabsTrigger value="cash">{t('Cash book|by day')}</TabsTrigger></TabsList>
      </Tabs>
      {tab === 'cash' ? <CashBook /> : (
      <DataTable tableKey="finance.payments" columns={[...columns, ...unitColumn]} data={payments.data} isLoading={payments.isLoading} error={payments.error}
        getRowId={(r) => r.id} exportName={t('payments')} searchPlaceholder={t('Number, partner, reference…')} onRowClick={(r) => navigate(`/finance/payments/${r.id}`)}
        preview={(r) => ({ print: { kind: 'payment', id: r.id } })}
        facets={[
          { columnId: 'document_type', title: t('Direction'), options: [{ value: 'customer_payment', label: t('Received|payment') }, { value: 'vendor_payment', label: t('Paid out') }] },
          { columnId: 'status', title: t('Status'), options: ['draft', 'pending_approval', 'approved', 'posted', 'reversed'].map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'bank', title: t('Bank or cash'), options: banks.map((b) => ({ value: b, label: b })) },
          { columnId: 'method', title: t('Method'), options: METHODS.map((m) => ({ value: m, label: tEnum(m) })) },
          ...(unitNames.length ? [{ columnId: 'unit', title: t('Unit|store'), options: unitNames.map((u) => ({ value: u, label: u })) }] : []),
        ]}
        empty={{ title: t('No payments yet'), description: t('Record what customers paid and what you paid vendors, or create payments from bank statement lines.') }} />
      )}
    </>
  )
}

export function PaymentPage() {
  const { id } = useParams()
  const p = usePayment(id)
  if (id && p.isLoading) return <Skeleton className="mx-auto h-96 max-w-5xl" />
  if (id && p.isError) return <ErrorState error={p.error} onRetry={() => void p.refetch()} />
  if (id && !p.data) return <EmptyState title={t('Payment not found')} description={t('It may have been deleted.')} action={<Button variant="outline" asChild><Link to="/finance/payments">{t('Back to payments')}</Link></Button>} />
  return <PaymentForm key={`${p.data?.id ?? 'new'}-${p.data?.status ?? ''}`} payment={p.data} />
}

function PaymentForm({ payment }: { payment?: PaymentDetail }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, can } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const kind = (payment?.document_type ?? params.get('type') ?? 'customer_payment') as 'customer_payment' | 'vendor_payment'
  const isReceipt = kind === 'customer_payment'
  const partners = usePartners()
  const banks = useBankAccounts()
  const save = useSavePayment()
  const post = usePostPayment()
  const del = useDeletePayment()
  const reverse = useReversePayment()
  const [reverseOpen, setReverseOpen] = React.useState(false)
  const editable = (!payment || payment.status === 'draft') && can('invoicing.write')

  const [partnerId, setPartnerId] = React.useState<string | null>(payment?.partner_id ?? params.get('partner'))
  const [bankId, setBankId] = React.useState<string | null>(payment?.bank_account_id ?? params.get('bank'))
  const [date, setDate] = React.useState(payment?.payment_date ?? params.get('date') ?? todayISO())
  const [method, setMethod] = React.useState<string>(payment?.method ?? 'bank_transfer')
  const [amount, setAmount] = React.useState(payment ? String(payment.amount) : params.get('amount') ?? '')
  const [reference, setReference] = React.useState(payment?.reference ?? params.get('ref') ?? '')
  const [notes, setNotes] = React.useState(payment?.notes ?? '')
  const [alloc, setAlloc] = React.useState<Record<string, string>>(() => Object.fromEntries((payment?.allocations ?? []).map((a) => [a.sales_invoice_id ?? a.vendor_bill_id!, String(a.amount)])))
  const openDocs = useOpenDocuments(kind, partnerId)
  const bank = banks.data?.find((b) => b.id === bankId)
  const currency = payment?.currency_code ?? bank?.currency_code ?? base

  React.useEffect(() => { if (!bankId && banks.data?.length) setBankId(banks.data.find((b) => b.account_kind === 'bank')?.id ?? banks.data[0]!.id) }, [banks.data, bankId])
  // preselect the document we came from
  const fromDoc = params.get('doc')
  React.useEffect(() => {
    if (!payment && fromDoc && openDocs.data && !Object.keys(alloc).length) {
      const d = openDocs.data.find((x) => x.id === fromDoc)
      if (d) { setAlloc({ [d.id]: String(d.open) }); if (!amount) setAmount(String(d.open)) }
    }
  }, [openDocs.data, fromDoc]) // eslint-disable-line react-hooks/exhaustive-deps

  const docs = editable ? (openDocs.data ?? []).filter((d) => d.currency_code === currency) : []
  const allocated = Object.values(alloc).reduce((s, v) => s + num(v), 0)
  const autoAllocate = () => {
    let left = num(amount)
    const next: Record<string, string> = {}
    for (const d of docs) { if (left <= 0) break; const take = Math.min(left, d.open); next[d.id] = String(Math.round(take * 100) / 100); left -= take }
    setAlloc(next)
  }
  const valid = !!partnerId && !!bankId && num(amount) > 0 && allocated <= num(amount) + 0.001 && docs.every((d) => num(alloc[d.id]) <= d.open + 0.001)

  const persist = () => save.mutateAsync({
    header: { id: payment?.id, document_type: kind, partner_id: partnerId, bank_account_id: bankId, payment_date: date, method, amount: num(amount),
              currency_code: currency, reference: reference || null, notes: notes || null },
    allocations: Object.entries(alloc).filter(([, v]) => num(v) > 0).map(([docId, v]) => (isReceipt ? { sales_invoice_id: docId, amount: num(v) } : { vendor_bill_id: docId, amount: num(v) })),
  })

  const partnerOptions = (partners.data ?? []).filter((p) => (isReceipt ? p.is_customer : p.is_vendor)).map((p) => ({ value: p.id, label: p.name, hint: p.code }))
  const title = payment ? payment.number : isReceipt ? t('Receive a payment') : t('Pay a vendor')
  const form = (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{isReceipt ? t('Customer') : t('Vendor')}</Label>
            <SearchSelect value={partnerId} onChange={(v) => { setPartnerId(v); setAlloc({}) }} disabled={!editable} placeholder={isReceipt ? t('Who paid') : t('Who to pay')} options={partnerOptions} /></div>
          <div className="grid gap-1.5"><Label htmlFor="p-date">{t('Date')}</Label><Input id="p-date" type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>{isReceipt ? t('Into') : t('From')}</Label>
            <Select value={bankId ?? ''} onValueChange={setBankId} disabled={!editable}><SelectTrigger><SelectValue placeholder={t('Bank or cash account')} /></SelectTrigger>
              <SelectContent>{(banks.data ?? []).filter((b) => b.is_active).map((b) => <SelectItem key={b.id} value={b.id}>{td(b.name)} · {b.currency_code}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Method')}</Label>
            <Select value={method} onValueChange={setMethod} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{humanize(m)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="p-amount">{t('Amount ({cur})', { cur: currency })}</Label><Input id="p-amount" type="number" step="any" className="tabular text-right" value={amount} disabled={!editable} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="p-ref">{t('Bank reference')}</Label><Input id="p-ref" value={reference} disabled={!editable} onChange={(e) => setReference(e.target.value)} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="p-notes">{t('Notes')}</Label><Input id="p-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} /></div>
          {editable && <div className="sm:col-span-3 empty:hidden"><CashLimitWarning partnerId={partnerId} amount={num(amount)} date={date} bankId={bankId} method={method} exclude={payment?.id} /></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-3">
          <CardTitle>{isReceipt ? t('Invoices paid') : t('Vendor bills paid')}</CardTitle>
          {editable && docs.length > 0 && <Button size="sm" variant="outline" disabled={!num(amount)} onClick={autoAllocate}><Wand2 /> {t('Oldest first')}</Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {editable ? (
            !partnerId ? <p className="px-4 pb-4 text-[13px] text-muted-foreground">{isReceipt ? t('Choose the customer to see their open invoices.') : t('Choose the vendor to see their open bills.')}</p>
              : !docs.length ? <p className="px-4 pb-4 text-[13px] text-muted-foreground">{isReceipt ? t('No open invoices in {cur}. The payment is kept as an advance on their account.', { cur: currency }) : t('No open bills in {cur}. The payment is kept as an advance on their account.', { cur: currency })}</p> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Document')}</TableHead><TableHead>{t('Due date')}</TableHead><TableHead className="text-right">{t('Total')}</TableHead><TableHead className="text-right">{t('Open|amount')}</TableHead><TableHead className="w-40 text-right">{t('Pay now')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {docs.map((d) => (
                    <TableRow key={d.id} className="hover:bg-transparent">
                      <TableCell><span className="font-medium">{d.number}</span>{d.ref && <span className="ml-2 text-muted-foreground">{d.ref}</span>}</TableCell>
                      <TableCell className={cn('text-[13px]', d.due_date < todayISO() && 'text-destructive')}>{formatDate(d.due_date)}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(d.total)}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(d.open)}</TableCell>
                      <TableCell><Input type="number" step="any" className={cn('h-8 text-right tabular', num(alloc[d.id]) > d.open + 0.001 && 'border-destructive')} value={alloc[d.id] ?? ''}
                        aria-label={t('Amount for {doc}', { doc: d.number })} onChange={(e) => setAlloc((a) => ({ ...a, [d.id]: e.target.value }))}
                        onDoubleClick={() => setAlloc((a) => ({ ...a, [d.id]: String(d.open) }))} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Document')}</TableHead><TableHead>{t('Date')}</TableHead><TableHead className="text-right">{t('Paid')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {(payment?.allocations ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.invoice ? <Link className="text-primary hover:underline" to={`/sales/invoices/${a.sales_invoice_id}`}>{a.invoice.number}</Link>
                      : <Link className="text-primary hover:underline" to={`/procurement/bills/${a.vendor_bill_id}`}>{a.bill?.number} · {a.bill?.vendor_invoice_number}</Link>}</TableCell>
                    <TableCell className="text-[13px]">{formatDate(a.invoice?.invoice_date ?? a.bill?.bill_date)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(a.amount)}</TableCell>
                  </TableRow>
                ))}
                {!payment?.allocations.length && <TableRow><TableCell colSpan={3} className="text-[13px] text-muted-foreground">{t("Not matched to any invoice. Kept as an advance on the partner's account.")}</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="flex flex-wrap justify-end gap-6 border-t px-4 py-3 text-[13px]">
          <span className="text-muted-foreground">{t('Matched|payment')} <span className="tabular font-medium text-foreground">{formatMoney(editable ? allocated : payment?.allocated_amount)}</span></span>
          <span className={cn('text-muted-foreground', (editable ? num(amount) - allocated : num(payment?.unallocated)) < -0.001 && 'text-destructive')}>
            {t('Not matched')} <span className="tabular font-medium">{formatMoney(editable ? num(amount) - allocated : payment?.unallocated)}</span></span>
        </div>
      </Card>
    </div>
  )

  return (
    <div className="w-full">
      <PageHeader back={{ href: '/finance/payments', label: t('Payments') }} title={title}
        meta={payment && <StatusBadge status={payment.status} />}
        description={payment ? t(isReceipt ? 'Received from {name} · {amount}' : 'Paid to {name} · {amount}', { name: payment.partner?.name ?? '', amount: formatMoney(payment.amount, payment.currency_code) }) : undefined}
        actions={<>{payment && payment.status !== 'draft' && <DocumentActions id={payment.id} kind="payment" />}<Can perm="invoicing.write">
          {payment && editable && <ConfirmDialog trigger={<Button variant="ghost" className="text-destructive"><Trash2 /> {t('Delete')}</Button>} title={t('Delete {doc}?', { doc: payment.number })} description={t('The draft is removed.')} confirmLabel={t('Delete')} destructive
            onConfirm={async () => { await del.mutateAsync(payment.id); navigate('/finance/payments') }} />}
          {editable && <Button variant="outline" loading={save.isPending} disabled={!partnerId || !bankId || !num(amount)} onClick={async () => { const id = await persist(); toast.success(t('Draft saved')); if (!payment) navigate(`/finance/payments/${id}`, { replace: true }) }}>{t('Save draft')}</Button>}
          {(editable || payment?.status === 'approved') && (
            <ConfirmDialog trigger={<Button disabled={editable && !valid}>{isReceipt ? t('Post receipt') : t('Post payment')}</Button>} title={isReceipt ? t('Post this receipt?') : t('Post this payment?')}
              description={isReceipt ? t("The money is recorded in the bank, the customer's invoices are settled and any exchange difference is recorded.")
                : t('Large payments may need approval first. Once posted, the money leaves the bank and the bills are settled.')}
              confirmLabel={t('Post')}
              onConfirm={async () => {
                const id = editable ? await persist() : payment!.id
                const status = await post.mutateAsync(id)
                toast.success(status === 'pending_approval' ? t('Sent for approval') : t('Posted|toast'))
                navigate(`/finance/payments/${id}`, { replace: true })
              }} />
          )}
          {payment?.status === 'posted' && <Button variant="outline" onClick={() => setReverseOpen(true)}><Undo2 /> {t('Reverse')}</Button>}
        </Can></>} />
      {payment?.status === 'pending_approval' && <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-[13px]">{tr('Waiting for approval. See {link}.', { link: <Link to="/approvals" className="text-primary hover:underline">{t('Approvals')}</Link> })}</div>}
      {payment ? (
        <Tabs defaultValue="payment">
          <TabsList><TabsTrigger value="payment">{t('Payment')}</TabsTrigger><TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger></TabsList>
          <TabsContent value="payment">{form}</TabsContent>
          <TabsContent value="accounting"><AccountingTab sourceType={payment.document_type} sourceId={payment.id} /></TabsContent>
        </Tabs>
      ) : form}
      {payment && <ReverseDialog open={reverseOpen} onOpenChange={setReverseOpen} onConfirm={(reason) => reverse.mutateAsync({ id: payment.id, reason }).then(() => { toast.success(t('Payment reversed')) })} />}
    </div>
  )
}

function ReverseDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (r: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Reverse this payment?')}</DialogTitle><DialogDescription>{t('A reversing entry is posted today and the invoices become open again.')}</DialogDescription></DialogHeader>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Transfer bounced')} aria-label={t('Reason')} />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={!reason.trim()} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onOpenChange(false) } catch { /* toast */ } finally { setBusy(false) } }}>{t('Reverse')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

