import { useMutation, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { FilePlus2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num } from '@/lib/utils'
import { FISCAL_STATUS, FiscalBadge, type FiscalStatus } from '../fiscal-status'

type Row = {
  id: string; number: string; receipt_date: string; days: number; fiscal_status: FiscalStatus; vendor_id: string; vendor: string; tax_number: string | null
  warehouse_id: string; warehouse: string; delivery_note: string | null; purchase_order_id: string | null; po: string | null
  value: number; pending_value: number; billed_pct: number | null; bills: { id: string; number: string; ref: string | null; in_vat_book: boolean }[]
}
type Data = { rows: Row[]; grni_balance: number; grni_code: string | null; grni_name: string | null; currency: string }

/**
 * Goods waiting for the invoice (from the meeting with the staff, #4): the goods are in the stock from the
 * day they came and are sold with VAT at the till; the purchase enters the VAT book when the supplier's
 * tax invoice comes, on the invoice's date. Meanwhile they are owed in 4081 and listed here.
 */
export function PendingInvoicesPage() {
  const { companyId, company } = useCompany()
  const navigate = useNavigate()
  const [all, setAll] = React.useState(false)
  const q = useQuery({
    queryKey: ['pending-invoices', companyId, all], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('receipts_pending_invoice', { p_company: companyId!, p: { all } as never })) as unknown as Data,
  })
  const bill = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('create_bill_from_receipt', { p_receipt: id })) as string,
    onSuccess: (id) => { toast.success(t('Draft bill created')); navigate(`/procurement/bills/${id}`) },
    onError: (e) => toast.error(describeError(e)),
  })
  const rows = q.data?.rows ?? []
  const pending = rows.filter((r) => r.fiscal_status === 'pending_invoice')
  const pendingValue = pending.reduce((s, r) => s + num(r.pending_value), 0)
  const cur = q.data?.currency ?? company?.base_currency ?? ''

  const cols = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Goods receipt')} />, meta: { label: t('Goods receipt') },
      cell: ({ row: { original: r } }) => <Link className="font-medium text-primary hover:underline" to={`/inventory/receipts/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { accessorKey: 'receipt_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'days', header: ({ column }) => <ColumnHeader column={column} title={t('Days waiting')} />, meta: { label: t('Days waiting'), align: 'right' },
      cell: ({ row: { original: r } }) => r.fiscal_status !== 'pending_invoice' ? <span className="text-muted-foreground">—</span>
        : <Badge variant={r.days > 30 ? 'destructive' : r.days > 15 ? 'warning' : 'secondary'} className="tabular">{r.days}</Badge> },
    { id: 'vendor', accessorFn: (r) => r.vendor, filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Vendor')} />, meta: { label: t('Vendor') },
      cell: ({ row: { original: r } }) => <span>{td(r.vendor)}{r.tax_number && <span className="ml-1.5 text-[12px] text-muted-foreground">{r.tax_number}</span>}</span> },
    { id: 'unit', accessorFn: (r) => td(r.warehouse), filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') } },
    { accessorKey: 'delivery_note', header: t('Delivery note'), meta: { label: t('Delivery note') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'po', header: t('PO'), meta: { label: t('Purchase order') }, cell: ({ getValue }) => (getValue() as string) || '—' },
    { accessorKey: 'value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost ({currency})', { currency: cur }), align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'pending_value', header: ({ column }) => <ColumnHeader column={column} title={t('Not invoiced')} />, meta: { label: t('Not invoiced ({currency})', { currency: cur }), align: 'right' },
      cell: ({ row: { original: r } }) => <span className="tabular font-medium">{formatMoney(num(r.pending_value))}{r.billed_pct != null && r.billed_pct > 0 && r.billed_pct < 100 && <span className="ml-1 text-[11.5px] font-normal text-muted-foreground">({r.billed_pct}% {t('invoiced')})</span>}</span> },
    { id: 'status', accessorFn: (r) => r.fiscal_status, filterFn: inFilter, header: t('Invoice'), meta: { label: t('Invoice'), exportValue: (r) => t(FISCAL_STATUS[r.fiscal_status]) },
      cell: ({ row: { original: r } }) => <span className="inline-flex flex-wrap items-center gap-1.5"><FiscalBadge status={r.fiscal_status} />
        {r.bills.map((b) => <Link key={b.id} to={`/procurement/bills/${b.id}`} onClick={(e) => e.stopPropagation()} className="text-[12px] text-primary hover:underline">{b.ref || b.number}</Link>)}</span> },
    { id: 'act', enableHiding: false, header: '', meta: { label: '' }, cell: ({ row: { original: r } }) => r.fiscal_status !== 'pending_invoice' ? null : (
      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        {r.purchase_order_id
          ? <Button size="xs" variant="outline" className="whitespace-nowrap" asChild><Link to={`/procurement/orders/${r.purchase_order_id}`}>{t('Bill the order')}</Link></Button>
          : <Can perm="invoicing.write"><Button size="xs" variant="outline" className="whitespace-nowrap" loading={bill.isPending && bill.variables === r.id} onClick={() => bill.mutate(r.id)}><FilePlus2 /> {t('Enter the invoice')}</Button></Can>}
      </div>
    ) },
  ], [cur, bill.isPending, bill.variables]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={t('Goods waiting for the invoice|menu')}
        description={t('Goods received and in stock, sold at the till with their VAT, whose supplier\'s tax invoice has not been entered yet. The purchase enters the VAT book with the invoice, on the invoice\'s date; until then it is owed in the books as goods received, not invoiced.')} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Receipts waiting')} value={String(pending.length)} />
        <StatCard label={t('Their value at cost')} value={formatMoney(pendingValue)} />
        <StatCard label={t('Longest wait')} value={pending.length ? t('{n} days', { n: Math.max(...pending.map((r) => r.days)) }) : '—'} />
        <StatCard label={q.data?.grni_name ? `${q.data.grni_code ?? ''} ${td(q.data.grni_name)}`.trim() : t('Goods received, not invoiced')} value={formatMoney(num(q.data?.grni_balance))}
          hint={q.data && Math.abs(num(q.data.grni_balance) - pendingValue) > 0.05 ? t('The account also holds price differences and older entries; the list shows each receipt.') : t('In the books, as in the list')} />
      </div>
      <DataTable tableKey="procurement.pending-invoices" columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.id}
        searchPlaceholder={t('Receipt, vendor, delivery note…')} exportName={t('goods-waiting-for-invoice')} onRowClick={(r) => navigate(`/inventory/receipts/${r.id}`)}
        toolbar={<label className="flex items-center gap-2 text-[13px]"><Switch checked={all} onCheckedChange={setAll} /> {t('Also the invoiced ones (last 90 days)')}</label>}
        facets={[
          { columnId: 'vendor', title: t('Vendor'), options: [...new Set(rows.map((r) => r.vendor))].map((v) => ({ value: v, label: td(v) })) },
          { columnId: 'unit', unit: true, title: t('Unit|store'), options: [...new Set(rows.map((r) => td(r.warehouse)))].map((v) => ({ value: v, label: v })) },
          ...(all ? [{ columnId: 'status', title: t('Invoice'), options: (Object.keys(FISCAL_STATUS) as FiscalStatus[]).filter((k) => k !== 'internal_movement').map((k) => ({ value: k, label: t(FISCAL_STATUS[k]) })) }] : []),
        ]}
        empty={{ title: t('Every receipt has its invoice'), description: t('Goods received without the supplier\'s tax invoice show here until the invoice is entered.') }} />
    </>
  )
}
