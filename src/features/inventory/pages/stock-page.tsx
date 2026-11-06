import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, LeadCell, selectColumn } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { Warehouse } from 'lucide-react'
import { StockByUnitDialog } from '../components/stock-by-unit'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { StockBar } from '@/components/stock-bar'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import type { Views } from '@/lib/database.types'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { invKeys, useInventoryOverview, useStockLevels, useWarehouses } from '../api'
import { t, td, tn } from '@/i18n'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'

type Level = Views<'v_stock_levels'>

export function StockPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const onlyWarehouse = params.get('warehouse')
  const { company, companyId } = useCompany()
  const levels = useStockLevels()
  const [byUnit, setByUnit] = React.useState<string[] | null>(null)
  const overview = useInventoryOverview()
  const warehouses = useWarehouses()
  const today = new Date().toISOString().slice(0, 10)
  // a place inside the unit (shelf, fridge) only matters where a unit has more than one: otherwise the column stays out of the way
  const placesMatter = React.useMemo(() => {
    const seen = new Map<string, Set<string>>()
    for (const l of levels.data ?? []) { const k = l.warehouse_id ?? ''; if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(l.location_code ?? '') }
    return [...seen.values()].some((x) => x.size > 1)
  }, [levels.data])
  useRealtimeInvalidate('stock_levels', companyId, [invKeys.stockLevels(companyId), invKeys.overview(companyId), invKeys.productStock(companyId)])

  const columns = React.useMemo<ColumnDef<Level>[]>(() => [
    selectColumn<Level>(),
    {
      id: 'product', accessorFn: (r) => `${r.sku} ${r.variant_name}`, enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Product'), exportValue: (r) => r.sku },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.sku}</div><div className="text-xs text-muted-foreground">{r.variant_name}</div></div>,
    },
    { accessorKey: 'category_name', id: 'category', filterFn: inFilter, header: t('Category'), meta: { label: t('Category') }, cell: ({ getValue }) => td(getValue() as string) || '—' },
    { accessorKey: 'warehouse_name', id: 'warehouse', filterFn: inFilter, header: ({ column }) => <ColumnHeader column={column} title={t('Warehouse')} />, meta: { label: t('Warehouse') }, cell: ({ getValue }) => td(getValue() as string) },
    ...(placesMatter ? [{ accessorKey: 'location_code', id: 'location_code', header: ({ column }) => <ColumnHeader column={column} title={t('Location')} />, meta: { label: t('Location') } } as ColumnDef<Level>] : []),
    {
      accessorKey: 'lot_number', header: t('Lot'), meta: { label: t('Lot') },
      cell: ({ row: { original: r } }) => r.lot_number
        ? <span className={cn(r.expiry_date && r.expiry_date < today && 'text-destructive')}>{r.lot_number}{r.expiry_date && <span className="ml-1 text-xs text-muted-foreground">{t('expires {date}', { date: formatDate(r.expiry_date) })}</span>}</span>
        : '—',
    },
    { accessorKey: 'on_hand', header: ({ column }) => <ColumnHeader column={column} title={t('On hand')} />, meta: { label: t('On hand'), align: 'right' }, cell: ({ row: { original: r } }) => <>{formatQty(r.on_hand)} <span className="text-muted-foreground">{td(r.uom_code)}</span></> },
    { accessorKey: 'reserved', header: ({ column }) => <ColumnHeader column={column} title={t('Reserved')} />, meta: { label: t('Reserved'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
    {
      accessorKey: 'available', header: ({ column }) => <ColumnHeader column={column} title={t('Available')} />, meta: { label: t('Available') },
      cell: ({ row: { original: r } }) => <StockBar onHand={r.on_hand} reserved={r.reserved} className="max-w-[200px]" />,
    },
    { accessorKey: 'avg_cost', header: t('Avg. cost'), meta: { label: t('Average cost, without VAT'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'stock_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'last_movement_at', header: ({ column }) => <ColumnHeader column={column} title={t('Last moved')} />, meta: { label: t('Last moved') }, cell: ({ getValue }) => <span className="text-[13px]">{formatDate(getValue() as string)}</span> },
  ], [today, placesMatter])

  return (
    <>
      <PageHeader title={t('Stock levels')} description={t('How much of each item you have in every place and lot. Available is what is on hand minus what is reserved for orders.')} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('Value at purchase price, without VAT')} value={formatMoney(overview.data?.stock_value, company?.base_currency)} loading={overview.isLoading}
          hint={overview.data?.sales_value != null ? t('At selling price with VAT {amount}', { amount: formatMoney(overview.data.sales_value) }) : t('At average cost')} />
        <StatCard label={t('Active items')} value={overview.data?.active_skus ?? 0} loading={overview.isLoading} href="/inventory/products" />
        <StatCard label={t('Low stock')} value={overview.data?.low_stock ?? 0} tone={overview.data?.low_stock ? 'warning' : 'default'} loading={overview.isLoading} href="/inventory/alerts" hint={t('At or below the reorder point')} />
        <StatCard label={t('Lines below zero')} value={overview.data?.negative_lines ?? 0} tone={overview.data?.negative_lines ? 'destructive' : 'default'} loading={overview.isLoading} hint={t('Only possible when selling without stock is allowed')} />
      </div>
      <DataTable
        key={onlyWarehouse ?? 'all'}
        tableKey="inventory.stock-levels"
        initialFilters={onlyWarehouse ? [{ id: 'warehouse', value: [onlyWarehouse] }] : undefined}
        columns={columns}
        data={levels.data}
        isLoading={levels.isLoading}
        error={levels.error}
        getRowId={(r) => r.id!}
        searchPlaceholder={t('Code, product, location or lot')}
        initialHidden={['category', 'avg_cost', 'reserved']}
        exportName="stock-levels"
        onRowClick={(r) => navigate(`/inventory/products/${r.product_id}`)}
        bulkActions={(rows) => <Button size="xs" variant="outline" onClick={() => setByUnit([...new Set(rows.map((r) => r.original.variant_id!).filter(Boolean))])}><Warehouse /> {t('Stock in every unit')}</Button>}
        facets={[
          { columnId: 'warehouse', unit: true, title: t('Warehouse'), options: (warehouses.data ?? []).map((w) => ({ label: td(w.name), value: w.name })) },
          { columnId: 'category', title: t('Category'), options: Array.from(new Set((levels.data ?? []).map((l) => l.category_name).filter(Boolean))).map((c) => ({ label: td(c!), value: c! })) },
        ]}
        empty={{ title: t('No stock on hand'), description: t('Receive goods or enter your opening stock to start.') }}
        footer={(table) => {
          const rows = table.getFilteredRowModel().rows.map((r) => r.original)
          return (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <LeadCell />
                <TableCell colSpan={table.getVisibleLeafColumns().length - 1} className="text-[13px]">{tn(rows.length, '{n} line', '{n} lines')}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(rows.reduce((s, r) => s + num(r.stock_value), 0))}</TableCell>
              </TableRow>
            </TableFooter>
          )
        }}
      />
      {byUnit && <StockByUnitDialog variantIds={byUnit} onClose={() => setByUnit(null)} />}
    </>
  )
}
