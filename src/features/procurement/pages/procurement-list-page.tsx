import type { ColumnDef } from '@tanstack/react-table'
import { Car, ChevronDown, FileText, PackagePlus, Plus, ReceiptText, ScanText } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { useDocGroups } from '../doc-groups'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { msg, t, td } from '@/i18n'
import { cn, formatDate, formatMoney, humanize, num, todayISO } from '@/lib/utils'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { PROC_TABLE, procKeys, useProcDocuments, type ProcKind } from '../api'
import { billLines } from '@/lib/documents/preview-lines'
import { MatchBadge } from './purchase-document-page'

type Row = Record<string, unknown> & { id: string; number: string; status: string; currency_code?: string }
const nm = (v: unknown, k = 'name') => (v as Record<string, string> | null)?.[k] ?? ''
const sum = (v: unknown, k: string) => ((v as Record<string, number>[] | null) ?? []).reduce((s, l) => s + num(l[k]), 0)
const OPEN_PO = ['approved', 'sent', 'partially_received']

/** the three books inside the purchase book: what the invoice bought (computed on the server) */
type Book = 'goods' | 'expense' | 'investment'
const BOOKS: { key: Book; label: string; title: string }[] = [
  { key: 'goods', label: msg('Goods|book'), title: msg('Goods purchase book') },
  { key: 'expense', label: msg('Expenses|book'), title: msg('Expense book') },
  { key: 'investment', label: msg('Investments|book'), title: msg('Investment book') },
]
const bookOf = (r: Row) => ((r.book as Book | undefined) ?? 'expense')
const bookLabel = (b: Book) => t(BOOKS.find((x) => x.key === b)!.label)

const dateCol = (key: string, title: string): ColumnDef<Row> => ({
  accessorKey: key, header: ({ column }) => <ColumnHeader column={column} title={title} />, meta: { label: title },
  cell: ({ getValue }) => formatDate(getValue() as string),
})
const vendorCol = (): ColumnDef<Row> => ({
  id: 'vendor', accessorFn: (r) => nm(r.vendor), filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Vendor')} />, meta: { label: t('Vendor') },
  cell: ({ getValue }) => <span className="block max-w-[240px] truncate">{(getValue() as string) || '—'}</span>,
})
const totalCol = (_base: string): ColumnDef<Row> => ({
  accessorKey: 'total', header: ({ column }) => <ColumnHeader column={column} title={t('Total (with VAT)')} />, meta: { label: t('Total (with VAT)'), align: 'right', exportValue: (r) => num(r.total) },
  cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.total as number, r.currency_code)}</span>,
})

interface Cfg {
  title: string; emptyTitle: string; description: string; newLabel: string; perm: string; href: string; statuses: string[]; empty: string
  columns: (base: string) => ColumnDef<Row>[]
  extraFacets?: (rows: Row[]) => { columnId: string; title: string; unit?: boolean; options: { label: string; value: string }[] }[]
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
      { accessorKey: 'estimated_total', header: ({ column }) => <ColumnHeader column={column} title={t('Estimate (without VAT)')} />, meta: { label: t('Estimate (without VAT)'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
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
      { columnId: 'warehouse', unit: true, title: t('Unit|store'), options: [...new Set(rows.map((r) => td(nm(r.warehouse))).filter(Boolean))].map((v) => ({ value: v, label: v })) },
    ],
    columns: (base) => [
      { id: 'warehouse', accessorFn: (r) => td(nm(r.warehouse)), filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      dateCol('order_date', t('Date')),
      vendorCol(),
      {
        accessorKey: 'expected_date', header: ({ column }) => <ColumnHeader column={column} title={t('Expected')} />, meta: { label: t('Expected') },
        cell: ({ row: { original: r } }) => {
          const due = (r.promised_date ?? r.expected_date) as string | null
          const late = OPEN_PO.includes(r.status) && !!due && due < todayISO()
          return due ? <span className={cn(late && 'font-medium text-destructive')}>{formatDate(due)}{late ? ` · ${t('late')}` : r.confirmed_at && OPEN_PO.includes(r.status) ? ` · ${t('confirmed')}` : ''}</span> : '—'
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
    extraFacets: (rows) => [
      { columnId: 'warehouse', unit: true, title: t('Unit|store'), options: [...new Set(rows.map((r) => td(nm(r.warehouse))).filter(Boolean))].map((v) => ({ value: v, label: v })) },
      { columnId: 'match_status', title: t('Match'), options: ['matched', 'exception', 'overridden', 'not_applicable', 'not_matched'].map((v) => ({ value: v, label: humanize(v) })) },
      { columnId: 'payment_status', title: t('Payment'), options: ['unpaid', 'partially_paid', 'paid', 'overdue'].map((v) => ({ value: v, label: humanize(v) })) },
      { columnId: 'vat_book', title: t('VAT book'), options: [{ value: 'in', label: t('In the purchase book') }, { value: 'out', label: t('Purchase invoice (no VAT)') }] },
    ],
    columns: (base) => [
      { id: 'warehouse', accessorFn: (r) => td(nm(r.warehouse)), filterFn: inFilter, header: t('Unit|store'), meta: { label: t('Unit|store') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      dateCol('bill_date', t('Date')),
      { id: 'book', accessorFn: (r) => bookOf(r), filterFn: inFilter, header: t('Book'), meta: { label: t('Book'), exportValue: (r) => bookLabel(bookOf(r)) },
        cell: ({ getValue }) => { const b = getValue() as Book; return <span className={cn('inline-flex items-center gap-1.5 text-[12.5px]')}><span className={cn('size-2 rounded-full', b === 'goods' ? 'bg-primary' : b === 'investment' ? 'bg-violet-500' : 'bg-amber-500')} />{bookLabel(b)}</span> } },
      { id: 'document_type', accessorFn: (r) => r.is_debit_note ? 'vendor_debit' : r.document_type, header: t('Type'), meta: { label: t('Type'), exportValue: (r) => r.document_type === 'vendor_credit' ? t('Credit note') : r.is_debit_note ? t('Debit note') : t('Bill') },
        cell: ({ getValue }) => getValue() === 'vendor_credit' ? <Badge variant="outline">{t('Credit note')}</Badge> : getValue() === 'vendor_debit' ? <Badge variant="outline" className="border-amber-500/50">{t('Debit note')}</Badge> : t('Bill') },
      vendorCol(),
      { accessorKey: 'vendor_invoice_number', header: t("Vendor's no."), meta: { label: t('Vendor invoice no.') } },
      // a till receipt or a paper without the buyer's VAT: outside the VAT purchase book (from the meeting with the staff)
      { id: 'vat_book', accessorFn: (r) => r.in_vat_book === false ? 'out' : 'in', filterFn: inFilter, header: t('VAT book'), meta: { label: t('VAT book'), exportValue: (r) => r.in_vat_book === false ? t('Purchase invoice (no VAT)') : t('In the purchase book') },
        cell: ({ getValue }) => getValue() === 'out' ? <Badge variant="secondary">{t('Purchase invoice (no VAT)')}</Badge> : <span className="text-muted-foreground">✓</span> },
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
  const [params, setParams] = useSearchParams()
  const { company, companyId } = useCompany()
  // requisitions are not published for live updates; orders and bills are
  useRealtimeInvalidate(kind === 'requisitions' ? 'approval_requests' : PROC_TABLE[kind], companyId, [procKeys.all(companyId)])
  const base = company?.base_currency ?? 'ALL'
  const cfg = React.useMemo(() => buildCfg()[kind], [kind])
  const docs = useProcDocuments<Row>(kind)
  const vendorFilter = params.get('vendor')
  const book = kind === 'bills' ? (BOOKS.find((b) => b.key === params.get('book'))?.key ?? null) : null
  const byVendor = React.useMemo(() => (docs.data ?? []).filter((r) => !vendorFilter || (r as { vendor_id?: string }).vendor_id === vendorFilter || nm(r.vendor) === vendorFilter), [docs.data, vendorFilter])
  const rows = React.useMemo(() => byVendor.filter((r) => !book || bookOf(r) === book), [byVendor, book])

  // the groups of the items on each invoice or order (from the meeting with the staff)
  const groups = useDocGroups<Row>(kind === 'bills' ? 'vendor_bills' : kind === 'orders' ? 'purchase_orders' : null, docs.data)
  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => humanize(r.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ...cfg.columns(base),
    ...groups.columns,
  ], [cfg, base, groups.columns])
  const newButton = kind === 'bills'
    // one button: what the invoice is for decides where it goes
    ? <Can perm={cfg.perm}>
        <Can perm="inventory.read"><Button variant="outline" asChild><Link to="/inventory/read-invoice"><ScanText /> {t('Invoice from a photo|menu')}</Link></Button></Can>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button><Plus /> {t('New invoice|purchase')} <ChevronDown className="opacity-70" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuItem className="items-start gap-3 py-2" onSelect={() => navigate('/procurement/invoice/new')}>
              <PackagePlus className="mt-0.5 size-5 text-primary" />
              <span><span className="block font-medium">{t('Goods into the warehouse')}</span>
                <span className="block text-[12px] text-muted-foreground">{t('The goods come into stock at their cost; you set the selling prices. From Excel too.')}</span></span>
            </DropdownMenuItem>
            <DropdownMenuItem className="items-start gap-3 py-2" onSelect={() => navigate('/finance/expenses')}>
              <ReceiptText className="mt-0.5 size-5 text-primary" />
              <span><span className="block font-medium">{t('An expense, without goods')}</span>
                <span className="block text-[12px] text-muted-foreground">{t('Electricity, rent, fuel, repairs: booked to its account. From a photo too.')}</span></span>
            </DropdownMenuItem>
            <DropdownMenuItem className="items-start gap-3 py-2" onSelect={() => navigate('/finance/asset-invoices')}>
              <Car className="mt-0.5 size-5 text-primary" />
              <span><span className="block font-medium">{t('An investment (fixed asset)')}</span>
                <span className="block text-[12px] text-muted-foreground">{t('A vehicle, a machine, computers: the fixed asset is made and depreciated. From a photo too.')}</span></span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="items-start gap-3 py-2" onSelect={() => navigate('/procurement/bills/new')}>
              <FileText className="mt-0.5 size-5 text-muted-foreground" />
              <span><span className="block">{t('A bill with lines and accounts')}</span>
                <span className="block text-[12px] text-muted-foreground">{t('For the accountant: several services or accounts on one bill, or a bill for a purchase order.')}</span></span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Can>
    : <Can perm={cfg.perm}><Button asChild><Link to={`${cfg.href}/new`}><Plus /> {cfg.newLabel}</Link></Button></Can>

  return (
    <>
      <PageHeader title={book ? t(BOOKS.find((b) => b.key === book)!.title) : cfg.title} description={cfg.description} actions={newButton} />
      {kind === 'bills' && <BookTabs rows={byVendor} base={base} value={book} loading={docs.isLoading}
        onChange={(b) => setParams((p) => { const n = new URLSearchParams(p); if (b) n.set('book', b); else n.delete('book'); return n }, { replace: true })} />}
      <DataTable
        tableKey={`procurement.${kind}`} columns={columns} data={docs.data ? rows : undefined} isLoading={docs.isLoading} error={docs.error}
        getRowId={(r) => r.id} searchPlaceholder={kind === 'bills' ? t('Number, vendor, vendor invoice no.…') : t('Number, vendor…')} exportName={book ? t(BOOKS.find((b) => b.key === book)!.title) : kind}
        onRowClick={(r) => navigate(`${cfg.href}/${r.id}`)}
        preview={kind === 'orders' ? (r) => ({ print: { kind: 'purchase_order', id: r.id }, id: r.id, duplicate: 'purchase_orders' }) : kind === 'bills' ? (r) => ({ lines: billLines(r.id), id: r.id, duplicate: 'vendor_bills' }) : undefined}
        facets={[{ columnId: 'status', title: t('Status'), options: cfg.statuses.map((s) => ({ label: humanize(s), value: s })) }, ...(cfg.extraFacets?.(docs.data ?? []) ?? []), ...groups.facets]}
        initialHidden={groups.hidden}
        empty={{ title: cfg.emptyTitle, description: cfg.empty, action: newButton }}
      />
    </>
  )
}

/** All · Goods · Expenses · Investments: each with how many invoices and their total (posted, in the base currency) */
function BookTabs({ rows, base, value, loading, onChange }: { rows: Row[]; base: string; value: Book | null; loading: boolean; onChange: (b: Book | null) => void }) {
  const stat = (b: Book | null) => {
    const list = rows.filter((r) => !b || bookOf(r) === b)
    const sign = (r: Row) => (r.document_type === 'vendor_credit' ? -1 : 1)
    return { n: list.length, total: list.filter((r) => r.status === 'posted').reduce((s, r) => s + sign(r) * num(r.total_base ?? r.total), 0) }
  }
  const tabs: { key: Book | null; label: string; dot?: string }[] = [
    { key: null, label: t('All|book') },
    ...BOOKS.map((b) => ({ key: b.key, label: t(b.label), dot: b.key === 'goods' ? 'bg-primary' : b.key === 'investment' ? 'bg-violet-500' : 'bg-amber-500' })),
  ]
  return (
    <div role="tablist" aria-label={t('Book')} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tabs.map((x) => {
        const s = stat(x.key); const on = value === x.key
        return (
          <button key={x.key ?? 'all'} type="button" role="tab" aria-selected={on} onClick={() => onChange(x.key)}
            className={cn('grid gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'bg-card hover:bg-secondary/60')}>
            <span className="flex items-center gap-1.5 text-[13px] font-medium">{x.dot && <span className={cn('size-2 rounded-full', x.dot)} />}{x.label}
              <span className="ml-auto rounded-full bg-secondary px-1.5 text-[11.5px] tabular text-muted-foreground">{loading ? '…' : s.n}</span></span>
            <span className="tabular text-[12.5px] text-muted-foreground">{loading ? '' : `${formatMoney(s.total, base)}`}</span>
          </button>
        )
      })}
    </div>
  )
}
