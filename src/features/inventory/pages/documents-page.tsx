import type { ColumnDef } from '@tanstack/react-table'
import { Globe2, Plus, ScanText } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoney, humanize } from '@/lib/utils'
import { useDocGroups } from '@/features/procurement/doc-groups'
import { useDocuments, type DocKind } from '../api'
import { ADJUSTMENT_REASONS } from './adjustment-page'
import { adjustmentLines, transferLines } from '@/lib/documents/preview-lines'
import { msg, t, td, tEnum } from '@/i18n'

type Row = Record<string, unknown> & { id: string; number: string; status: string }
const name = (v: unknown) => td((v as { name?: string } | null)?.name) || '—'
const count = (v: unknown) => (v as { count: number }[] | null)?.[0]?.count ?? 0

interface KindConfig {
  title: string
  description: string
  newLabel: string
  perm: string
  statuses: string[]
  columns: (cur: string) => ColumnDef<Row>[]
  empty: string
  emptyTitle: string
}

const dateCol = (key: string): ColumnDef<Row> => ({
  accessorKey: key, header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') },
  cell: ({ getValue }) => formatDate(getValue() as string),
})

const CONFIG: Record<DocKind, KindConfig> = {
  receipts: {
    title: msg('Goods receipts|menu'), newLabel: msg('Receive goods'), emptyTitle: msg('No goods received yet'), perm: 'wms.write', statuses: ['draft', 'done', 'cancelled'],
    description: msg('Goods coming in from vendors, imports and customer returns. Completing a receipt adds the stock and updates the average cost.'),
    empty: msg('Receive goods for a purchase order, or directly from a vendor.'),
    columns: (cur) => [
      dateCol('receipt_date'),
      { id: 'vendor', accessorFn: (r) => name(r.vendor), header: ({ column }) => <ColumnHeader column={column} title={t('Vendor')} />, meta: { label: t('Vendor') } },
      { id: 'warehouse', accessorFn: (r) => name(r.warehouse), filterFn: inFilter, header: t('Warehouse'), meta: { label: t('Warehouse') } },
      { id: 'po', accessorFn: (r) => (r.purchase_order as { number?: string } | null)?.number ?? '', header: t('PO'), meta: { label: t('Purchase order') }, cell: ({ getValue }) => (getValue() as string) || '—' },
      {
        id: 'import', accessorFn: (r) => (r.is_import ? r.clearance_status : 'not_required'), filterFn: inFilter, header: t('Customs'), meta: { label: t('Customs clearance') },
        cell: ({ row: { original: r } }) => r.is_import ? <span className="inline-flex items-center gap-1.5"><Globe2 className="size-3.5 text-muted-foreground" /><StatusBadge status={r.clearance_status as string} /></span> : <span className="text-muted-foreground">{t('Domestic')}</span>,
      },
      { id: 'lines', accessorFn: (r) => count(r.lines), header: t('Lines'), meta: { label: t('Lines'), align: 'right' } },
      { accessorKey: 'total_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost ({currency})', { currency: cur }), align: 'right' }, cell: ({ row: { original: r } }) => r.status === 'done' ? formatMoney(r.total_value as number) : '—' },
    ],
  },
  adjustments: {
    title: msg('Stock adjustments'), newLabel: msg('New adjustment'), emptyTitle: msg('No stock adjustments yet'), perm: 'inventory.write', statuses: ['draft', 'pending_approval', 'approved', 'posted', 'cancelled'],
    description: msg('Opening stock, count corrections, damage and losses. Large write-offs may need approval.'),
    empty: msg('Use an adjustment to enter opening stock or correct a count.'),
    columns: (cur) => [
      dateCol('adjustment_date'),
      { accessorKey: 'reason', filterFn: inFilter, header: t('Reason'), meta: { label: t('Reason'), exportValue: (r) => t(ADJUSTMENT_REASONS[r.reason as keyof typeof ADJUSTMENT_REASONS] ?? String(r.reason)) }, cell: ({ getValue }) => { const k = ADJUSTMENT_REASONS[getValue() as keyof typeof ADJUSTMENT_REASONS]; return k ? t(k) : humanize(getValue() as string) } },
      { id: 'warehouse', accessorFn: (r) => name(r.warehouse), filterFn: inFilter, header: t('Warehouse'), meta: { label: t('Warehouse') } },
      { id: 'lines', accessorFn: (r) => count(r.lines), header: t('Lines'), meta: { label: t('Lines'), align: 'right' } },
      { accessorKey: 'total_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost ({currency})', { currency: cur }), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    ],
  },
  transfers: {
    title: msg('Transfers'), newLabel: msg('New transfer'), emptyTitle: msg('No transfers yet'), perm: 'wms.write', statuses: ['draft', 'in_transit', 'done', 'cancelled'],
    description: msg('Moving stock between stores: requested, shipped, on the road, then counted and received by the other store. The stock value does not change.'),
    empty: msg('Move stock from the main warehouse to a store, or between shelves.'),
    columns: () => [
      dateCol('transfer_date'),
      { id: 'from', accessorFn: (r) => name(r.from), filterFn: inFilter, header: t('From'), meta: { label: t('From') } },
      { id: 'to', accessorFn: (r) => name(r.to), filterFn: inFilter, header: t('To'), meta: { label: t('To') } },
      { id: 'lines', accessorFn: (r) => count(r.lines), header: t('Lines'), meta: { label: t('Lines'), align: 'right' } },
      {
        id: 'flag', filterFn: inFilter, header: t('Attention'), meta: { label: t('Attention') },
        accessorFn: (r) => r.status === 'draft' && r.is_request ? 'request'
          : r.status === 'in_transit' && r.shipped_at && Date.now() - new Date(r.shipped_at as string).getTime() > 86_400_000 ? 'late'
            : r.status === 'done' && r.has_difference ? 'difference' : '',
        cell: ({ getValue }) => {
          const f = getValue() as string
          return f === 'request' ? <Badge variant="secondary">{t('Request')}</Badge>
            : f === 'late' ? <Badge variant="warning">{t('On the road over a day')}</Badge>
              : f === 'difference' ? <Badge variant="destructive">{t('Received with differences')}</Badge> : null
        },
      },
    ],
  },
  'landed-costs': {
    title: msg('Landed costs|menu'), newLabel: msg('New landed cost'), emptyTitle: msg('No landed costs yet'), perm: 'procurement.write', statuses: ['draft', 'posted', 'cancelled'],
    description: msg('Transport, customs duty and insurance added to the cost of received goods, usually after an import clears customs.'),
    empty: msg('After an import clears customs, add the forwarder and customs charges here.'),
    columns: (cur) => [
      dateCol('landed_cost_date'),
      { accessorKey: 'allocation_method', header: t('Split by'), meta: { label: t('Split by') }, cell: ({ getValue }) => tEnum(`alloc_${getValue() as string}`) },
      { id: 'receipts', accessorFn: (r) => ((r.receipts as { receipt: { number: string } }[] | null) ?? []).map((x) => x.receipt.number).join(', '), header: t('Goods receipts'), meta: { label: t('Goods receipts') } },
      { accessorKey: 'total_amount', header: ({ column }) => <ColumnHeader column={column} title={t('Amount (without VAT)')} />, meta: { label: t('Amount without VAT ({currency})', { currency: cur }), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    ],
  },
}

const HREF: Record<DocKind, string> = {
  receipts: '/inventory/receipts', adjustments: '/inventory/adjustments', transfers: '/inventory/transfers', 'landed-costs': '/inventory/landed-costs',
}

export function DocumentsPage({ kind }: { kind: DocKind }) {
  const navigate = useNavigate()
  const { company, hasFeature } = useCompany()
  const docs = useDocuments<Row>(kind)
  const cfg = CONFIG[kind]
  const cur = company?.base_currency ?? ''
  // receipts: the groups of their items (from the meeting with the staff)
  const groups = useDocGroups<Row>(kind === 'receipts' ? 'goods_receipts' : null, docs.data)

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') },
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => humanize(r.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    ...cfg.columns(cur),
    ...groups.columns,
  ], [cfg, cur, groups.columns])

  const newButton = <Can perm={cfg.perm}>
    {kind === 'receipts' && hasFeature('ai_reads') && <Button variant="outline" asChild><Link to="/inventory/read-invoice"><ScanText /> {t('Invoice from a photo')}</Link></Button>}
    <Button asChild><Link to={`${HREF[kind]}/new`}><Plus /> {t(cfg.newLabel)}</Link></Button></Can>
  return (
    <>
      <PageHeader title={t(cfg.title)} description={t(cfg.description)} actions={newButton} />
      <DataTable
        tableKey={`inventory.${kind}`}
        columns={columns}
        data={docs.data}
        isLoading={docs.isLoading}
        error={docs.error}
        getRowId={(r) => r.id}
        searchPlaceholder={t('Number, vendor, warehouse…')}
        exportName={kind}
        onRowClick={(r) => navigate(`${HREF[kind]}/${r.id}`)}
        preview={(r) => kind === 'receipts' ? { print: { kind: 'goods_receipt', id: r.id as string }, id: r.id as string, duplicate: 'goods_receipts' }
          : kind === 'transfers' ? { lines: transferLines(r.id as string), id: r.id as string, duplicate: 'stock_transfers' }
          : kind === 'adjustments' ? { lines: adjustmentLines(r.id as string), id: r.id as string, duplicate: 'stock_adjustments' } : null}
        facets={[
          { columnId: 'status', title: t('Status'), options: cfg.statuses.map((s) => ({ label: tEnum(s), value: s })) },
          ...(kind === 'receipts' ? [{ columnId: 'import', title: t('Customs'), options: [{ label: t('Waiting for customs'), value: 'pending' }, { label: t('Cleared'), value: 'cleared' }, { label: t('Domestic'), value: 'not_required' }] }] : []),
          ...(kind === 'transfers' ? [{ columnId: 'flag', title: t('Attention'), options: [{ label: t('Request'), value: 'request' }, { label: t('On the road over a day'), value: 'late' }, { label: t('Received with differences'), value: 'difference' }] }] : []),
          ...(kind === 'adjustments' ? [{ columnId: 'reason', title: t('Reason'), options: Object.entries(ADJUSTMENT_REASONS).map(([value, label]) => ({ label: t(label), value })) }] : []),
          ...groups.facets,
        ]}
        initialHidden={groups.hidden}
        empty={{ title: t(cfg.emptyTitle), description: t(cfg.empty), action: newButton }}
      />
    </>
  )
}
