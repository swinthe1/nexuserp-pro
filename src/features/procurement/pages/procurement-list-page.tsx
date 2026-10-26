import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { t, td } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { PROC_TABLE, procKeys, useProcDocuments, type ProcKind } from '../api'
import { MatchBadge } from './purchase-document-page'

type Row = Record<string, unknown> & { id: string; number: string; status: string; currency_code?: string }
const nm = (v: unknown, k = 'name') => (v as Record<string, string> | null)?.[k] ?? ''
const sum = (v: unknown, k: string) => ((v as Record<string, number>[] | null) ?? []).reduce((s, l) => s + num(l[k]), 0)
const OPEN_PO = ['approved', 'sent', 'partially_received']

const dateCol = (key: string, title: string): ColumnDef<Row> => ({
  accessorKey: key, header: ({ column }) => <ColumnHeader column={column} title={title} />, meta: { label: title },
  cell: ({ getValue }) => formatDate(getValue() as string),
})
const vendorCol = (): ColumnDef<Row> => ({
  id: 'vendor', accessorFn: (r) => nm(r.vendor), filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Vendor')} />, meta: { label: t('Vendor') },
  cell: ({ getValue }) => <span className="block max-w-[240px] truncate">{(getValue() as string) || '—'}</span>,
})
const totalCol = (base: string): ColumnDef<Row> => ({
  accessorKey: 'total', header: ({ column }) => <ColumnHeader column={column} title={t('Total')} />, meta: { label: t('Total'), align: 'right', exportValue: (r) => num(r.total) },
  cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.total as number)} <span className="text-muted-foreground">{r.currency_code !== base ? r.currency_code : ''}</span></span>,
})

interface Cfg {
  title: string; emptyTitle: string; description: string; newLabel: string; perm: string; href: string; statuses: string[]; empty: string
  columns: (base: string) => ColumnDef<Row>[]
  extraFacets?: (rows: Row[]) => { columnId: string; title: string; options: { label: string; value: string }[] }[]
}

/** Built when rendering, so every text is in the current language */
const buildCfg = (): Record<ProcKind, Cfg> => ({
  requisitions: {
    title: t('Purchase requisitions'), emptyTitle: t('No requisitions yet'), newLabel: t('New requisition'), perm: 'requisitions.write', href: '/procurement/requisitions',
    statuses: ['draft', 'submitted', 'approved', 'rejected', 'ordered', 'cancelled'],
    description: t('Requests to buy something. Once approved, purchasing turns them into orders with the right vendors.'),
    empty: t('Ask purchasing for goods or services — they approve it and order from the right vendor.'),
    columns: () => [
      dateCol('created_at', t('Requested')),
      { accessorKey: 'justification', header: t('For'), meta: { label: t('Justification') }, cell: ({ getValue }) => <span className="block max-w-[280px] truncate">{(getValue() as string) || '—'}</span> },
      { id: 'requester', accessorFn: (r) => nm(r.requester, 'full_name'), filterFn: inFilter, header: t('Requested by'), meta: { label: t('Requested by') } },
      { id: 'warehouse', accessorFn: (r) => td(nm(r.warehouse)), header: t('For warehouse'), meta: { label: t('Warehouse') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      dateCol('required_date', t('Needed by')),
      { id: 'lines', accessorFn: (r) => (r.lines as { count: number }[] | null)?.[0]?.count ?? 0, header: t('Items'), meta: { label: t('Items'), align: 'right' } },
      { accessorKey: 'estimated_total', header: ({ column }) => <ColumnHeader column={column} title={t('Estimate')} />, meta: { label: t('Estimate'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
    ],
  },
  orders: {
    title: t('Purchase orders'), emptyTitle: t('No purchase orders yet'), newLabel: t('New purchase order'), perm: 'procurement.write', href: '/procurement/orders',
    statuses: ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled'],
    description: t('Orders placed with vendors. Approved orders count as incoming stock until they are received.'),
    empty: t('Order from a vendor directly, from an approved requisition, or from replenishment suggestions.'),
    extraFacets: (rows) => [
      { columnId: 'billing_status', title: t('Billing'), options: ['not_billed', 'partially_billed', 'billed'].map((v) => ({ value: v, label: humanize(v) })) },
      { columnId: 'vendor', title: t('Vendor'), options: [...new Set(rows.map((r) => nm(r.vendor)).filter(Boolean))].map((v) => ({ value: v, label: v })) },
    ],
    columns: (base) => [
      dateCol('order_date', t('Date')),
      vendorCol(),
      {
        accessorKey: 'expected_date', header: ({ column }) => <ColumnHeader column={column} title={t('Expected')} />, meta: { label: t('Expected') },
        cell: ({ row: { original: r } }) => {
          const late = OPEN_PO.includes(r.status) && !!r.expected_date && (r.expected_date as string) < todayISO()
          return r.expected_date ? <span className={cn(late && 'font-medium text-destructive')}>{formatDate(r.expected_date as string)}{late && ` · ${t('late')}`}</span> : '—'
        },
      },
      {
        id: 'received', accessorFn: (r) => { const q = sum(r.lines, 'quantity'); return q ? sum(r.lines, 'qty_received') / q : 0 }, header: t('Received'),
        meta: { label: t('Received %'), exportValue: (r) => Math.round((sum(r.lines, 'qty_received') / (sum(r.lines, 'quantity') || 1)) * 100) },
        cell: ({ row: { original: r } }) => {
          if (['draft', 'pending_approval', 'cancelled'].includes(r.status)) return <span className="text-muted-foreground">—</span>
          const q = sum(r.lines, 'quantity'); const d = sum(r.lines, 'qty_received')
          return (
            <div className="flex min-w-[110px] items-center gap-2">
              <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-secondary"><div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, (d / (q || 1)) * 100)}%` }} /></div>
              <span className="tabular text-xs text-muted-foreground">{Math.round((d / (q || 1)) * 100)}%</span>
            </div>
          )
        },
      },
      { accessorKey: 'billing_status', filterFn: inFilter, header: t('Billing'), meta: { label: t('Billing') }, cell: ({ row: { original: r } }) => ['draft', 'pending_approval', 'cancelled'].includes(r.status) ? <span className="text-muted-foreground">—</span> : <StatusBadge status={r.billing_status as string} /> },
      { id: 'buyer', accessorFn: (r) => nm(r.buyer, 'full_name'), header: t('Buyer'), meta: { label: t('Buyer') } },
      totalCol(base),
    ],
  },
  bills: {
    title: t('Vendor bills'), emptyTitle: t('No vendor bills yet'), newLabel: t('New bill'), perm: 'invoicing.write', href: '/procurement/bills',
    statuses: ['draft', 'posted', 'cancelled'],
    description: t('Invoices from vendors, checked against the purchase order and the goods received before they are posted.'),
    empty: t('Open a purchase order and choose “Enter bill”, or enter a bill without an order here.'),
    extraFacets: () => [
      { columnId: 'match_status', title: t('Match'), options: ['matched', 'exception', 'overridden', 'not_applicable', 'not_matched'].map((v) => ({ value: v, label: humanize(v) })) },
      { columnId: 'payment_status', title: t('Payment'), options: ['unpaid', 'partially_paid', 'paid', 'overdue'].map((v) => ({ value: v, label: humanize(v) })) },
    ],
    columns: (base) => [
      dateCol('bill_date', t('Date')),
      { accessorKey: 'document_type', header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => getValue() === 'vendor_credit' ? <Badge variant="outline">{t('Credit note')}</Badge> : t('Bill') },
      vendorCol(),
      { accessorKey: 'vendor_invoice_number', header: t("Vendor's no."), meta: { label: t('Vendor invoice no.') } },
      { id: 'order', accessorFn: (r) => nm(r.order, 'number'), header: t('Order'), meta: { label: t('Purchase order') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      { accessorKey: 'match_status', filterFn: inFilter, header: t('Match'), meta: { label: t('Match') }, cell: ({ row: { original: r } }) => r.document_type === 'vendor_credit' ? <span className="text-muted-foreground">—</span> : <MatchBadge status={r.match_status as string} /> },
      {
        id: 'payment_status', filterFn: inFilter, header: t('Payment'), meta: { label: t('Payment') },
        accessorFn: (r) => r.status === 'posted' && r.payment_status !== 'paid' && (r.due_date as string) < todayISO() && r.document_type !== 'vendor_credit' ? 'overdue' : r.payment_status,
        cell: ({ row: { original: r }, getValue }) => r.status !== 'posted' ? <span className="text-muted-foreground">—</span> : <StatusBadge status={getValue() as string} />,
      },
      dateCol('due_date', t('Due')),
      totalCol(base),
    ],
  },
})

export function ProcurementListPage({ kind }: { kind: ProcKind }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { company, companyId } = useCompany()
  // requisitions are not published for live updates; orders and bills are
  useRealtimeInvalidate(kind === 'requisitions' ? 'approval_requests' : PROC_TABLE[kind], companyId, [procKeys.all(companyId)])
  const base = company?.base_currency ?? 'ALL'
  const cfg = React.useMemo(() => buildCfg()[kind], [kind])
  const docs = useProcDocuments<Row>(kind)
  const vendorFilter = params.get('vendor')
  const rows = React.useMemo(() => (docs.data ?? []).filter((r) => !vendorFilter || (r as { vendor_id?: string }).vendor_id === vendorFilter || nm(r.vendor) === vendorFilter), [docs.data, vendorFilter])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => humanize(r.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ...cfg.columns(base),
  ], [cfg, base])
  const newButton = kind === 'bills'
    ? <Can perm={cfg.perm}>
        <Button variant="outline" asChild><Link to="/procurement/bills/new"><Plus /> {t('Expense bill (no goods)')}</Link></Button>
        <Button asChild><Link to="/procurement/invoice/new"><Plus /> {t('Purchase invoice with goods')}</Link></Button>
      </Can>
    : <Can perm={cfg.perm}><Button asChild><Link to={`${cfg.href}/new`}><Plus /> {cfg.newLabel}</Link></Button></Can>

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description} actions={newButton} />
      <DataTable
        tableKey={`procurement.${kind}`} columns={columns} data={docs.data ? rows : undefined} isLoading={docs.isLoading} error={docs.error}
        getRowId={(r) => r.id} searchPlaceholder={kind === 'bills' ? t('Number, vendor, vendor invoice no.…') : t('Number, vendor…')} exportName={kind}
        onRowClick={(r) => navigate(`${cfg.href}/${r.id}`)}
        facets={[{ columnId: 'status', title: t('Status'), options: cfg.statuses.map((s) => ({ label: humanize(s), value: s })) }, ...(cfg.extraFacets?.(docs.data ?? []) ?? [])]}
        empty={{ title: cfg.emptyTitle, description: cfg.empty, action: newButton }}
      />
    </>
  )
}
