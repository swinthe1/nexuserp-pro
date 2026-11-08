import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, LeadCell } from '@/components/data-table/data-table'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatDate, formatMoney, formatQty, humanize, num, todayISO } from '@/lib/utils'
import { useSalesDocuments, type SalesKind } from '../api'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { msg, t, td, tn } from '@/i18n'

type Row = Record<string, unknown> & { id: string; number: string; status: string; currency_code?: string }
const nm = (v: unknown, k = 'name') => (v as Record<string, string> | null)?.[k] ?? ''
const sum = (v: unknown, k: string) => ((v as Record<string, number>[] | null) ?? []).reduce((s, l) => s + num(l[k]), 0)

const dateCol = (key: string, title: string): ColumnDef<Row> => ({
  accessorKey: key, header: ({ column }) => <ColumnHeader column={column} title={title} />, meta: { label: title },
  cell: ({ getValue }) => formatDate(getValue() as string),
})
// column builders run while rendering, so t() picks up the current language
const customerCol = (): ColumnDef<Row> => ({
  id: 'customer', accessorFn: (r) => nm(r.partner), header: ({ column }) => <ColumnHeader column={column} title={t('Customer')} />, meta: { label: t('Customer') },
  cell: ({ getValue }) => <span className="block max-w-[260px] truncate">{(getValue() as string) || '—'}</span>,
})
const salespersonCol = (): ColumnDef<Row> => ({
  id: 'salesperson', accessorFn: (r) => nm(r.salesperson, 'full_name'), filterFn: inFilter, header: t('Salesperson'), meta: { label: t('Salesperson') },
  cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">—</span>,
})
const totalCol = (base: string): ColumnDef<Row> => ({
  accessorKey: 'total', header: ({ column }) => <ColumnHeader column={column} title={t('Total with VAT')} />, meta: { label: t('Total with VAT'), align: 'right', exportValue: (r) => num(r.total) },
  cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.total as number)} <span className="text-muted-foreground">{r.currency_code !== base ? r.currency_code : ''}</span></span>,
})

/** a sum row under the list: the posted documents among those shown, in the company's currency */
type Footer = (rows: Row[]) => { count: number; cells: Record<string, React.ReactNode> } | null
interface Cfg { footer?: Footer; title: string; emptyTitle: string; description: string; newLabel?: string; perm: string; statuses: string[]; href: string; empty: string; columns: (base: string) => ColumnDef<Row>[]; extraFacets?: () => { columnId: string; title: string; options: { label: string; value: string }[] }[] }

const CFG: Record<SalesKind, Cfg> = {
  quotes: {
    title: msg('Quotes'), emptyTitle: msg('No quotes yet'), newLabel: msg('New quote'), perm: 'sales.write', href: '/sales/quotes',
    statuses: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'],
    description: msg('Offers sent to customers. An accepted quote becomes a sales order in one click.'),
    empty: msg('Prepare an offer for a customer — prices come from their price list automatically.'),
    columns: (base) => [
      dateCol('quote_date', t('Date')),
      customerCol(),
      {
        accessorKey: 'valid_until', header: ({ column }) => <ColumnHeader column={column} title={t('Valid until')} />, meta: { label: t('Valid until') },
        cell: ({ row: { original: r } }) => {
          const late = r.status === 'sent' && (r.valid_until as string) < todayISO()
          return <span className={cn(late && 'text-destructive')}>{formatDate(r.valid_until as string)}{late && ` · ${t('expired')}`}</span>
        },
      },
      salespersonCol(), totalCol(base),
    ],
  },
  orders: {
    title: msg('Sales orders'), emptyTitle: msg('No sales orders yet'), newLabel: msg('New order'), perm: 'sales.write', href: '/sales/orders',
    statuses: ['draft', 'pending_approval', 'confirmed', 'partially_delivered', 'delivered', 'closed', 'cancelled'],
    description: msg('Confirmed orders reserve stock. See what is still to deliver and to invoice.'),
    empty: msg('Create an order directly, or turn an accepted quote into an order.'),
    extraFacets: () => [{ columnId: 'invoice_status', title: t('Invoicing'), options: ['not_invoiced', 'partially_invoiced', 'invoiced'].map((v) => ({ value: v, label: humanize(v) })) }],
    columns: (base) => [
      dateCol('order_date', t('Date')),
      customerCol(),
      {
        id: 'fulfilment', accessorFn: (r) => { const q = sum(r.lines, 'quantity'); return q ? sum(r.lines, 'qty_delivered') / q : 0 }, header: t('Delivered'), meta: { label: t('Delivered %'), exportValue: (r) => Math.round((sum(r.lines, 'qty_delivered') / (sum(r.lines, 'quantity') || 1)) * 100) },
        cell: ({ row: { original: r } }) => {
          if (r.status === 'draft' || r.status === 'cancelled') return <span className="text-muted-foreground">—</span>
          const q = sum(r.lines, 'quantity'); const d = sum(r.lines, 'qty_delivered'); const res = sum(r.lines, 'qty_reserved')
          return (
            <div className="flex min-w-[120px] items-center gap-2" title={t('{delivered} delivered · {reserved} reserved of {ordered}', { delivered: formatQty(d), reserved: formatQty(res), ordered: formatQty(q) })}>
              <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                <div className="absolute inset-y-0 left-0 bg-primary/35" style={{ width: `${Math.min(100, ((d + res) / (q || 1)) * 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, (d / (q || 1)) * 100)}%` }} />
              </div>
              <span className="tabular text-xs text-muted-foreground">{Math.round((d / (q || 1)) * 100)}%</span>
            </div>
          )
        },
      },
      { accessorKey: 'invoice_status', filterFn: inFilter, header: t('Invoicing'), meta: { label: t('Invoicing'), exportValue: (r) => humanize(r.invoice_status as string) }, cell: ({ row: { original: r } }) => r.status === 'draft' ? <span className="text-muted-foreground">—</span> : <StatusBadge status={r.invoice_status as string} /> },
      salespersonCol(), totalCol(base),
    ],
  },
  deliveries: {
    title: msg('Deliveries'), emptyTitle: msg('No deliveries yet'), perm: 'wms.write', href: '/sales/deliveries',
    statuses: ['draft', 'ready', 'done', 'cancelled'],
    description: msg('Goods leaving the warehouse for customers. Completing a delivery takes the goods out of stock.'),
    empty: msg('Deliveries are created from confirmed sales orders.'),
    columns: (base) => [
      dateCol('scheduled_date', t('Planned for')),
      customerCol(),
      { id: 'order', accessorFn: (r) => nm(r.order, 'number'), header: t('Order|sales'), meta: { label: t('Sales order') } },
      { id: 'warehouse', accessorFn: (r) => td(nm(r.warehouse)), filterFn: inFilter, header: t('Warehouse'), meta: { label: t('Warehouse') } },
      { id: 'qty', accessorFn: (r) => sum(r.lines, 'quantity'), header: t('Units'), meta: { label: t('Units'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
      { accessorKey: 'total_cost', header: t('Cost (without VAT)'), meta: { label: t('Cost ({currency}, without VAT)', { currency: base }), align: 'right' }, cell: ({ row: { original: r } }) => r.status === 'done' ? formatMoney(r.total_cost as number) : '—' },
    ],
  },
  invoices: {
    title: msg('Invoices'), emptyTitle: msg('No invoices yet'), newLabel: msg('New invoice'), perm: 'invoicing.write', href: '/sales/invoices',
    statuses: ['draft', 'posted', 'cancelled'],
    description: msg('Customer invoices and credit notes. Posting gives the invoice its final number and sends it for fiscalization.'),
    empty: msg('Invoice a delivered order, or invoice a customer directly.'),
    extraFacets: () => [
      { columnId: 'payment_status', title: t('Payment'), options: ['unpaid', 'partially_paid', 'paid', 'overdue'].map((v) => ({ value: v, label: humanize(v) })) },
      { columnId: 'document_type', title: t('Type'), options: [{ value: 'sales_invoice', label: t('Invoice') }, { value: 'credit_note', label: t('Credit note') }, { value: 'debit_note', label: t('Debit note') }] },
      { columnId: 'fiscal', title: t('Fiscalization'), options: ['fiscalized', 'pending', 'failed', 'not_required'].map((v) => ({ value: v, label: v === 'failed' ? t('Refused') : humanize(v) })) },
    ],
    footer: (rows) => {
      const posted = rows.filter((r) => r.status === 'posted')
      if (posted.length < 2) return null
      const sg = (r: Row) => (r.document_type === 'credit_note' ? -1 : 1)
      const rate = (r: Row) => num(r.exchange_rate) || 1
      const gross = posted.reduce((a, r) => a + sg(r) * num(r.total_base), 0)
      const vat = posted.reduce((a, r) => a + sg(r) * num(r.tax_total) * rate(r), 0)
      const due = posted.reduce((a, r) => a + sg(r) * num(r.amount_due) * rate(r), 0)
      return { count: posted.length, cells: { net: formatMoney(gross - vat), vat: formatMoney(vat), total: formatMoney(gross), amount_due: formatMoney(due) } }
    },
    columns: (base) => [
      dateCol('invoice_date', t('Date')),
      { id: 'document_type', accessorFn: (r) => r.is_debit_note ? 'debit_note' : r.document_type, filterFn: inFilter, header: t('Type'), meta: { label: t('Type'), exportValue: (r) => r.document_type === 'credit_note' ? t('Credit note') : r.is_debit_note ? t('Debit note') : t('Invoice') },
        cell: ({ getValue }) => getValue() === 'credit_note' ? <Badge variant="outline">{t('Credit note')}</Badge> : getValue() === 'debit_note' ? <Badge variant="outline" className="border-amber-500/50">{t('Debit note')}</Badge> : t('Invoice') },
      customerCol(),
      { id: 'order', accessorFn: (r) => nm(r.order, 'number'), header: t('Order|sales'), meta: { label: t('Sales order') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      {
        id: 'payment_status', filterFn: inFilter, header: t('Payment'), meta: { label: t('Payment'), exportValue: (r) => humanize(r.payment_status as string) },
        accessorFn: (r) => r.status === 'posted' && r.payment_status !== 'paid' && (r.due_date as string) < todayISO() && r.document_type !== 'credit_note' ? 'overdue' : r.payment_status,
        cell: ({ row: { original: r }, getValue }) => r.status !== 'posted' ? <span className="text-muted-foreground">—</span> : <StatusBadge status={getValue() as string} />,
      },
      dateCol('due_date', t('Due')),
      {
        id: 'fiscal', accessorFn: (r) => r.fiscal_status ?? 'not_required', filterFn: inFilter, header: t('Fiscalization'),
        meta: { label: t('Fiscalization'), exportValue: (r) => humanize((r.fiscal_status as string) ?? 'not_required') },
        cell: ({ row: { original: r }, getValue }) => r.status !== 'posted' || getValue() === 'not_required' ? <span className="text-muted-foreground">—</span>
          : getValue() === 'failed' ? <StatusBadge status="failed" label={t('Refused')} /> : <StatusBadge status={getValue() as string} />,
      },
      { id: 'net', accessorFn: (r) => num(r.total) - num(r.tax_total), header: ({ column }) => <ColumnHeader column={column} title={t('Without VAT')} />,
        meta: { label: t('Without VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
      { id: 'vat', accessorFn: (r) => num(r.tax_total), header: t('VAT'), meta: { label: t('VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular text-muted-foreground">{formatMoney(getValue() as number)}</span> },
      totalCol(base),
      { accessorKey: 'amount_due', header: t('Still to pay (with VAT)'), meta: { label: t('Still to pay (with VAT)'), align: 'right' }, cell: ({ row: { original: r } }) => r.status === 'posted' ? formatMoney(r.amount_due as number) : '—' },
    ],
  },
}

export function SalesListPage({ kind }: { kind: SalesKind }) {
  const navigate = useNavigate()
  const { company } = useCompany()
  const base = company?.base_currency ?? 'ALL'
  const { companyId } = useCompany()
  const cfg = CFG[kind]
  const docs = useSalesDocuments<Row>(kind)
  // live: orders and deliveries change during the day (warehouse, other sales reps)
  useRealtimeInvalidate(kind === 'orders' ? 'sales_orders' : kind === 'deliveries' ? 'deliveries' : kind === 'invoices' ? 'sales_invoices' : 'sales_quotes', companyId, [['sales', companyId]])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') },
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => humanize(r.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ...cfg.columns(base),
  ], [cfg, base])

  const newButton = cfg.newLabel ? <Can perm={cfg.perm}><Button asChild><Link to={`${cfg.href}/new`}><Plus /> {t(cfg.newLabel)}</Link></Button></Can> : undefined
  return (
    <>
      <PageHeader title={t(cfg.title)} description={t(cfg.description)} actions={newButton} />
      <DataTable
        tableKey={`sales.${kind}`}
        columns={columns}
        data={docs.data}
        isLoading={docs.isLoading}
        error={docs.error}
        getRowId={(r) => r.id}
        searchPlaceholder={t('Number, customer…')}
        exportName={kind}
        onRowClick={(r) => navigate(`${cfg.href}/${r.id}`)}
        preview={(r) => ({ print: { kind: ({ quotes: 'sales_quote', orders: 'sales_order', deliveries: 'delivery', invoices: 'sales_invoice' } as const)[kind], id: r.id }, id: r.id,
          duplicate: kind === 'deliveries' ? undefined : ({ quotes: 'sales_quotes', orders: 'sales_orders', invoices: 'sales_invoices' } as const)[kind] })}
        facets={[{ columnId: 'status', title: t('Status'), options: cfg.statuses.map((s) => ({ label: humanize(s), value: s })) }, ...(cfg.extraFacets?.() ?? [])]}
        empty={{ title: t(cfg.emptyTitle), description: t(cfg.empty), action: newButton }}
        initialHidden={kind === 'invoices' ? ['vat', 'order'] : undefined}
        footer={cfg.footer ? (table) => {
          const f = cfg.footer!(table.getFilteredRowModel().rows.map((r) => r.original))
          if (!f) return null
          return <TableFooter><TableRow className="font-semibold hover:bg-transparent"><LeadCell />
            {table.getVisibleLeafColumns().map((c, i) => <TableCell key={c.id} className={cn(c.id in f.cells && 'text-right tabular')}>
              {i === 0 ? tn(f.count, 'Total of {n} posted', 'Total of {n} posted') : f.cells[c.id] ?? ''}</TableCell>)}</TableRow></TableFooter>
        } : undefined}
      />
    </>
  )
}
