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
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { invKeys, useInventoryOverview, useStockLevels, useWarehouses } from '../api'
import { t, td, tn } from '@/i18n'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { useActiveUnit } from '@/app/active-unit'

type Level = Views<'v_stock_levels'>
type Pivot = { id: string; product_id: string | null; sku: string | null; name: string | null; category: string | null; uom: string | null; qty: Record<string, number>; total: number; value: number }

export function StockPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const onlyWarehouse = params.get('warehouse')
  const { company, companyId, can } = useCompany()
  // without "see what the goods cost" the values at cost are not shown
  const costs = can('inventory.costs')
  const levels = useStockLevels()
  const [byUnit, setByUnit] = React.useState<string[] | null>(null)
  const overview = useInventoryOverview()
  const warehouses = useWarehouses()
  const { multi, unit } = useActiveUnit()
  // several units: one row per item with a column for each unit (unless one unit is chosen, or the person asks for the lines)
  const [view, setView] = React.useState<'units' | 'lines' | null>(null)
  const pivot = multi && !onlyWarehouse && (view ?? (unit ? 'lines' : 'units')) === 'units'
  const unitCols = React.useMemo(() => (warehouses.data ?? []).filter((w) => w.is_active && w.warehouse_type !== 'transit'), [warehouses.data])
  const byItem = React.useMemo(() => {
    if (!pivot) return []
    const m = new Map<string, Pivot>()
    for (const l of levels.data ?? []) {
      const k = l.variant_id ?? l.id!
      let r = m.get(k)
      if (!r) { r = { id: k, product_id: l.product_id, sku: l.sku, name: l.variant_name, category: l.category_name, uom: l.uom_code, qty: {}, total: 0, value: 0 }; m.set(k, r) }
      if (l.warehouse_id) r.qty[l.warehouse_id] = (r.qty[l.warehouse_id] ?? 0) + num(l.on_hand)
      r.total += num(l.on_hand); r.value += num(l.stock_value)
    }
    return [...m.values()].sort((a, b) => String(a.sku).localeCompare(String(b.sku)))
  }, [pivot, levels.data])
  const pivotColumns = React.useMemo<ColumnDef<Pivot>[]>(() => [
    {
      id: 'product', accessorFn: (r) => `${r.sku} ${r.name}`, enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Product'), exportValue: (r) => r.sku },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.sku}</div><div className="text-xs text-muted-foreground">{r.name}</div></div>,
    },
    { id: 'category', accessorFn: (r) => r.category ?? '', filterFn: inFilter, header: t('Category'), meta: { label: t('Category') }, cell: ({ getValue }) => td(getValue() as string) || '—' },
    ...unitCols.map((w): ColumnDef<Pivot> => ({
      id: `u_${w.id}`, accessorFn: (r) => r.qty[w.id] ?? 0,
      header: ({ column }) => <ColumnHeader column={column} title={td(w.name)} />, meta: { label: td(w.name), align: 'right', exportValue: (r) => r.qty[w.id] ?? 0 },
      cell: ({ row: { original: r } }) => {
        const q = r.qty[w.id]
        return q == null ? <span className="text-muted-foreground">—</span> : <span className={cn('tabular', q < 0 && 'text-destructive')}>{formatQty(q, r.uom)}</span>
      },
    })),
    { id: 'total', accessorFn: (r) => r.total, header: ({ column }) => <ColumnHeader column={column} title={t('All units')} />, meta: { label: t('All units'), align: 'right' },
      cell: ({ row: { original: r } }) => <span className="font-medium tabular">{formatQty(r.total, r.uom)}</span> },
    { id: 'value', accessorFn: (r) => r.value, header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
  ], [unitCols])
  const today = todayISO()
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
    { accessorKey: 'on_hand', header: ({ column }) => <ColumnHeader column={column} title={t('On hand')} />, meta: { label: t('On hand'), align: 'right' }, cell: ({ row: { original: r } }) => <>{formatQty(r.on_hand, r.uom_code)}</> },
    { accessorKey: 'reserved', header: ({ column }) => <ColumnHeader column={column} title={t('Reserved')} />, meta: { label: t('Reserved'), align: 'right' }, cell: ({ row: { original: r } }) => formatQty(r.reserved, r.uom_code) },
    {
      accessorKey: 'available', header: ({ column }) => <ColumnHeader column={column} title={t('Available')} />, meta: { label: t('Available') },
      cell: ({ row: { original: r } }) => <StockBar onHand={r.on_hand} reserved={r.reserved} unit={r.uom_code} className="max-w-[200px]" />,
    },
    { accessorKey: 'avg_cost', header: t('Avg. cost'), meta: { label: t('Average cost, without VAT'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'stock_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'last_movement_at', header: ({ column }) => <ColumnHeader column={column} title={t('Last moved')} />, meta: { label: t('Last moved') }, cell: ({ getValue }) => <span className="text-[13px]">{formatDate(getValue() as string)}</span> },
  ], [today, placesMatter])

  return (
    <>
      <PageHeader title={t('Stock levels')} description={t('How much of each item you have in every place and lot. Available is what is on hand minus what is reserved for orders.')} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {costs && <StatCard label={t('Value at purchase price, without VAT')} value={formatMoney(overview.data?.stock_value, company?.base_currency)} loading={overview.isLoading}
          hint={overview.data?.sales_value != null ? t('At selling price with VAT {amount}', { amount: formatMoney(overview.data.sales_value) }) : t('At average cost')} />}
        <StatCard label={t('Active items')} value={overview.data?.active_skus ?? 0} loading={overview.isLoading} href="/inventory/products" />
        <StatCard label={t('Low stock')} value={overview.data?.low_stock ?? 0} tone={overview.data?.low_stock ? 'warning' : 'default'} loading={overview.isLoading} href="/inventory/alerts" hint={t('At or below the reorder point')} />
        <StatCard label={t('Lines below zero')} value={overview.data?.negative_lines ?? 0} tone={overview.data?.negative_lines ? 'destructive' : 'default'} loading={overview.isLoading} hint={t('Only possible when selling without stock is allowed')} />
      </div>
      {multi && !onlyWarehouse && (
        <div role="radiogroup" aria-label={t('How to show the stock')} className="mb-3 inline-flex h-9 rounded-md border bg-muted/40 p-0.5 text-[13px]">
          {(['units', 'lines'] as const).map((x) => (
            <button key={x} type="button" role="radio" aria-checked={(pivot ? 'units' : 'lines') === x} onClick={() => setView(x)}
              className={cn('rounded-[5px] px-3', (pivot ? 'units' : 'lines') === x ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {x === 'units' ? t('An item per row, a column per unit') : t('A row per unit and place')}
            </button>
          ))}
        </div>
      )}
      {pivot ? (
        <DataTable
          tableKey="inventory.stock-by-unit"
          columns={costs ? pivotColumns : pivotColumns.filter((c) => c.id !== 'value')}
          data={levels.data ? byItem : undefined}
          isLoading={levels.isLoading}
          error={levels.error}
          getRowId={(r) => r.id}
          searchPlaceholder={t('Code or product')}
          initialHidden={['category']}
          exportName="stock-by-unit"
          onRowClick={(r) => r.product_id && navigate(`/inventory/products/${r.product_id}`)}
          facets={[{ columnId: 'category', title: t('Category'), options: Array.from(new Set(byItem.map((l) => l.category).filter(Boolean))).map((c) => ({ label: td(c!), value: c! })) }]}
          empty={{ title: t('No stock on hand'), description: t('Receive goods or enter your opening stock to start.') }}
          footer={(table) => {
            const rows = table.getFilteredRowModel().rows.map((r) => r.original)
            return (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <LeadCell />
                  <TableCell colSpan={table.getVisibleLeafColumns().length - 1} className="text-[13px]">{tn(rows.length, '{n} item', '{n} items')}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(rows.reduce((s, r) => s + r.value, 0))}</TableCell>
                </TableRow>
              </TableFooter>
            )
          }}
        />
      ) : (
      <DataTable
        key={onlyWarehouse ?? 'all'}
        tableKey="inventory.stock-levels"
        initialFilters={onlyWarehouse ? [{ id: 'warehouse', value: [onlyWarehouse] }] : undefined}
        columns={costs ? columns : columns.filter((c) => !['avg_cost', 'stock_value'].includes((c as { accessorKey?: string }).accessorKey ?? ''))}
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
      )}
      {byUnit && <StockByUnitDialog variantIds={byUnit} onClose={() => setByUnit(null)} />}
    </>
  )
}
