import type { ColumnDef, ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import type { Views } from '@/lib/database.types'
import { useDebounce } from '@/hooks/use-debounce'
import { cn, formatDate, formatMoney, formatQty, humanize } from '@/lib/utils'
import { useMovements } from '../api'
import { t, td } from '@/i18n'

type Movement = Views<'v_stock_movements'>

export const MOVEMENT_TYPES = [ // translated with tEnum: 'enum:<type>'
  'receipt', 'opening', 'adjustment_in', 'adjustment_out', 'scrap', 'transfer', 'landed_cost', 'revaluation',
  'delivery', 'sales_return', 'purchase_return', 'pos_sale', 'pos_return', 'production_consume', 'production_output',
]

const DOC_LINK: Record<string, string> = {
  goods_receipt: '/inventory/receipts/',
  stock_adjustment: '/inventory/adjustments/',
  stock_transfer: '/inventory/transfers/',
  landed_cost: '/inventory/landed-costs/',
  vendor_bill: '/procurement/bills/',
  delivery: '/sales/deliveries/',
  work_order: '/manufacturing/orders/',
}

export function MovementsTable({ productId, tableKey = 'inventory.movements' }: { productId?: string; tableKey?: string }) {
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'movement_date', desc: true }])
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const search = useDebounce(globalFilter, 300)
  const filterOf = (id: string) => (columnFilters.find((f) => f.id === id)?.value as string[] | undefined) ?? []

  const q = useMovements({
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    sort: sorting[0] ?? null,
    search,
    types: filterOf('movement_type'),
    directions: filterOf('direction'),
    productId,
  })

  const columns = React.useMemo<ColumnDef<Movement>[]>(() => [
    {
      accessorKey: 'movement_date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') },
      cell: ({ getValue }) => <span className="whitespace-nowrap text-[13px]">{formatDate(getValue() as string, true)}</span>,
    },
    {
      accessorKey: 'direction', header: t('Direction'), meta: { label: t('Direction') }, enableSorting: false,
      cell: ({ getValue }) => {
        const d = getValue() as string
        const Icon = d === 'in' ? ArrowDownLeft : d === 'out' ? ArrowUpRight : ArrowRightLeft
        return <Icon className={cn('size-4', d === 'in' ? 'text-success' : d === 'out' ? 'text-destructive' : 'text-muted-foreground')} aria-label={d === 'in' ? t('Stock in') : d === 'out' ? t('Stock out') : t('Internal')} />
      },
    },
    {
      accessorKey: 'movement_type', header: ({ column }) => <ColumnHeader column={column} title={t('Type')} />, meta: { label: t('Type'), exportValue: (r) => humanize(r.movement_type) },
      cell: ({ getValue }) => humanize(getValue() as string),
    },
    ...(productId ? [] : [{
      id: 'sku', accessorKey: 'sku', header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Code') },
      cell: ({ row: { original: r } }) => (
        <Link to={`/inventory/products/${r.product_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          <span className="font-medium">{r.sku}</span> <span className="text-muted-foreground">{r.variant_name}</span>
        </Link>
      ),
    } satisfies ColumnDef<Movement>]),
    {
      id: 'route', header: t('From → to'), meta: { label: t('From → to'), exportValue: (r) => `${td(r.from_location)} → ${td(r.to_location)}` },
      cell: ({ row: { original: r } }) => (
        <span className="whitespace-nowrap text-[13px]">
          <span className={cn(r.from_type !== 'internal' && !r.from_warehouse_id && 'text-muted-foreground')}>{td(r.from_location)}</span>
          <span className="px-1 text-muted-foreground">→</span>
          <span className={cn(!r.to_warehouse_id && 'text-muted-foreground')}>{td(r.to_location)}</span>
        </span>
      ),
    },
    { accessorKey: 'lot_number', header: t('Lot'), meta: { label: t('Lot') }, cell: ({ getValue }) => (getValue() as string) ?? '—' },
    {
      accessorKey: 'quantity', header: ({ column }) => <ColumnHeader column={column} title={t('Qty')} />, meta: { label: t('Quantity'), align: 'right' },
      cell: ({ row: { original: r } }) => Number(r.quantity) === 0 ? <span className="text-[13px] text-muted-foreground">{t('Value only')}</span> : (
        <span className={cn(r.direction === 'in' && 'text-success', r.direction === 'out' && 'text-destructive')}>
          {r.direction === 'out' ? '−' : r.direction === 'in' ? '+' : ''}{formatQty(r.quantity)} <span className="text-muted-foreground">{td(r.uom_code)}</span>
        </span>
      ),
    },
    { accessorKey: 'unit_cost', header: t('Unit cost (without VAT)'), meta: { label: t('Unit cost (without VAT)'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'total_cost', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    {
      accessorKey: 'reference', header: t('Document'), meta: { label: t('Document') },
      cell: ({ row: { original: r } }) => {
        const base = r.source_doc_type ? DOC_LINK[r.source_doc_type] : undefined
        return base && r.source_doc_id
          ? <Link to={base + r.source_doc_id} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.reference}</Link>
          : <span>{r.reference ?? '—'}</span>
      },
    },
    { accessorKey: 'created_by_name', header: t('By'), meta: { label: t('Recorded by') }, cell: ({ getValue }) => (getValue() as string) ?? t('System') },
  ], [productId])

  return (
    <DataTable
      tableKey={tableKey}
      columns={columns}
      data={q.data?.rows}
      isLoading={q.isLoading}
      error={q.error}
      getRowId={(r) => r.id!}
      searchPlaceholder={t('Code, product, document or lot')}
      exportName="stock-movements"
      initialHidden={['created_by_name', 'unit_cost']}
      dense
      facets={[
        { columnId: 'direction', title: t('Direction'), options: [{ label: t('Stock in'), value: 'in' }, { label: t('Stock out'), value: 'out' }, { label: t('Internal'), value: 'internal' }] },
        { columnId: 'movement_type', title: t('Type'), options: MOVEMENT_TYPES.map((m) => ({ label: humanize(m), value: m })) },
      ]}
      empty={{ title: t('No movements yet'), description: t('Receiving goods, adjusting stock or transferring it records a movement here.') }}
      server={{
        rowCount: q.data?.count ?? 0,
        pagination, onPaginationChange: setPagination,
        sorting, onSortingChange: (s) => { setSorting(s); setPagination((p) => ({ ...p, pageIndex: 0 })) },
        globalFilter, onGlobalFilterChange: (v) => { setGlobalFilter(v); setPagination((p) => ({ ...p, pageIndex: 0 })) },
        columnFilters, onColumnFiltersChange: (f) => { setColumnFilters(f); setPagination((p) => ({ ...p, pageIndex: 0 })) },
      }}
    />
  )
}
