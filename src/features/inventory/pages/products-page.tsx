import type { ColumnDef } from '@tanstack/react-table'
import { Ban, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, selectColumn } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StockBar } from '@/components/stock-bar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatMoney, formatQty } from '@/lib/utils'
import { useBulkProducts, useCategories, useProductStock, type ProductStockRow } from '../api'
import { t, td, tEnum, tn } from '@/i18n'

function stockState(r: ProductStockRow) {
  if (!r.is_active) return 'inactive'
  if (r.product_type !== 'stockable') return 'not_stocked'
  if ((r.on_hand ?? 0) < 0) return 'negative'
  if (r.is_low_stock) return 'low'
  return 'ok'
}

const DAY = 86_400_000
/** How recently an item moved: sold lately, slow, or asleep (for finding items to switch off). */
function activity(r: ProductStockRow) {
  const age = (d: string | null | undefined) => (d ? (Date.now() - new Date(`${d}T00:00:00`).getTime()) / DAY : Infinity)
  const sold = age(r.last_sold), moved = Math.min(age(r.last_movement), sold, age(r.last_received))
  if (sold <= 30) return 'sold_30'
  if (sold <= 182) return 'sold_180'
  if (moved === Infinity) return 'never'
  if (moved <= 365) return 'slow'
  return 'asleep'
}

export function ProductsPage() {
  const navigate = useNavigate()
  const { company } = useCompany()
  const cur = company?.base_currency
  const products = useProductStock()
  const categories = useCategories()
  const bulk = useBulkProducts()

  const columns = React.useMemo<ColumnDef<ProductStockRow>[]>(() => [
    selectColumn<ProductStockRow>(),
    {
      id: 'product',
      accessorFn: (r) => `${r.variant_name} ${r.sku} ${r.barcode ?? ''}`,
      header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />,
      meta: { label: t('Product'), exportValue: (r) => r.variant_name },
      sortingFn: (a, b) => (a.original.variant_name ?? '').localeCompare(b.original.variant_name ?? ''),
      enableHiding: false,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <Link to={`/inventory/products/${r.product_id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.variant_name}
          </Link>
          <span className="text-xs text-muted-foreground">{r.sku}</span>
        </div>
      ),
    },
    { accessorKey: 'sku', header: t('SKU'), meta: { label: t('SKU') } },
    { accessorKey: 'barcode', header: t('Barcode'), meta: { label: t('Barcode') }, cell: ({ getValue }) => <span className="tabular text-[13px]">{(getValue() as string) ?? '—'}</span> },
    {
      accessorKey: 'category_name', id: 'category', filterFn: inFilter,
      header: ({ column }) => <ColumnHeader column={column} title={t('Category')} />, meta: { label: t('Category') },
      cell: ({ getValue }) => td(getValue() as string) || <span className="text-muted-foreground">—</span>,
    },
    {
      accessorKey: 'product_type', id: 'type', filterFn: inFilter,
      header: ({ column }) => <ColumnHeader column={column} title={t('Type')} />, meta: { label: t('Type'), exportValue: (r) => tEnum(`product_${r.product_type}`) },
      cell: ({ getValue }) => tEnum(`product_${getValue() as string}`),
    },
    {
      id: 'availability',
      accessorFn: (r) => r.available,
      header: ({ column }) => <ColumnHeader column={column} title={t('Available')} />,
      meta: { label: t('Available'), exportValue: (r) => r.available },
      cell: ({ row: { original: r } }) => r.product_type === 'stockable'
        ? <StockBar onHand={r.on_hand} reserved={r.reserved} min={r.reorder_min} max={r.reorder_max} className="max-w-[200px]" />
        : <span className="text-[13px] text-muted-foreground">{t('Not stocked')}</span>,
    },
    { accessorKey: 'on_hand', header: ({ column }) => <ColumnHeader column={column} title={t('On hand')} />, meta: { label: t('On hand'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
    { accessorKey: 'reserved', header: ({ column }) => <ColumnHeader column={column} title={t('Reserved')} />, meta: { label: t('Reserved'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
    { accessorKey: 'incoming', header: ({ column }) => <ColumnHeader column={column} title={t('Incoming')} />, meta: { label: t('Incoming'), align: 'right' }, cell: ({ getValue }) => formatQty(getValue() as number) },
    { accessorKey: 'sales_price', header: ({ column }) => <ColumnHeader column={column} title={t('Price')} />, meta: { label: t('Sales price'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'avg_cost', header: ({ column }) => <ColumnHeader column={column} title={t('Avg cost')} />, meta: { label: t('Average cost'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number, undefined, 2) },
    { accessorKey: 'stock_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value')} />, meta: { label: t('Stock value ({currency})', { currency: cur }), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    {
      accessorKey: 'last_sold', header: ({ column }) => <ColumnHeader column={column} title={t('Last sold')} />, meta: { label: t('Last sold'), align: 'right' },
      cell: ({ getValue }) => (getValue() ? formatDate(getValue() as string) : <span className="text-muted-foreground">—</span>),
    },
    {
      accessorKey: 'last_received', header: ({ column }) => <ColumnHeader column={column} title={t('Last received')} />, meta: { label: t('Last received'), align: 'right' },
      cell: ({ getValue }) => (getValue() ? formatDate(getValue() as string) : <span className="text-muted-foreground">—</span>),
    },
    { id: 'activity', accessorFn: activity, filterFn: inFilter, enableHiding: false, header: () => null, cell: () => null, meta: { label: t('Activity') } },
    {
      id: 'state', accessorFn: stockState, filterFn: inFilter,
      header: ({ column }) => <ColumnHeader column={column} title={t('Status')} />, meta: { label: t('Status') },
      cell: ({ getValue }) => {
        const s = getValue() as string
        return s === 'inactive' ? <Badge variant="secondary">{t('Inactive')}</Badge>
          : s === 'not_stocked' ? <span className="text-[13px] text-muted-foreground">—</span>
          : s === 'negative' ? <Badge variant="destructive">{t('Negative')}</Badge>
            : s === 'low' ? <Badge variant="warning">{t('Low stock')}</Badge>
              : <Badge variant="success">{t('In range')}</Badge>
      },
    },
  ], [cur])

  const productIds = (rows: { original: ProductStockRow }[]) => Array.from(new Set(rows.map((r) => r.original.product_id!).filter(Boolean)))

  return (
    <>
      <PageHeader
        title={t('Products')}
        description={t('Every sellable and stocked item, one row per variant (SKU). Average cost updates automatically on every receipt.')}
        actions={<Can perm="inventory.write"><Button asChild><Link to="/inventory/products/new"><Plus /> {t('New product')}</Link></Button></Can>}
      />
      <DataTable
        tableKey="inventory.products"
        columns={columns}
        data={products.data}
        isLoading={products.isLoading}
        error={products.error}
        getRowId={(r) => r.variant_id!}
        searchPlaceholder={t('Search name, SKU or barcode')}
        initialHidden={['sku', 'barcode', 'on_hand', 'reserved', 'incoming', 'last_received', 'activity']}
        initialSorting={[{ id: 'product', desc: false }]}
        onRowClick={(r) => navigate(`/inventory/products/${r.product_id}`)}
        exportName="products"
        facets={[
          { columnId: 'category', title: t('Category'), options: (categories.data ?? []).map((c) => ({ label: td(c.name), value: c.name })) },
          { columnId: 'type', title: t('Type'), options: ['stockable', 'consumable', 'service'].map((x) => ({ label: tEnum(`product_${x}`), value: x })) },
          { columnId: 'activity', title: t('Activity'), options: [
            { label: t('Sold in the last 30 days'), value: 'sold_30' }, { label: t('Sold in the last 6 months'), value: 'sold_180' },
            { label: t('No sale for 6 months'), value: 'slow' }, { label: t('No movement for a year'), value: 'asleep' }, { label: t('No movement at all'), value: 'never' },
          ] },
          { columnId: 'state', title: t('Status'), options: [
            { label: t('In range'), value: 'ok' }, { label: t('Low stock'), value: 'low' }, { label: t('Negative'), value: 'negative' }, { label: t('Not stocked'), value: 'not_stocked' }, { label: t('Inactive'), value: 'inactive' },
          ] },
        ]}
        empty={{
          title: t('No products yet'),
          description: t('Create your first product, or add opening stock to an existing catalog.'),
          action: <Can perm="inventory.write"><Button size="sm" asChild><Link to="/inventory/products/new"><Plus /> {t('New product')}</Link></Button></Can>,
        }}
        bulkActions={(rows, clear) => (
          <Can perm="inventory.write">
            <Button size="xs" variant="outline" onClick={() => bulk.mutate({ action: 'activate', productIds: productIds(rows) }, { onSuccess: clear })}><CheckCircle2 /> {t('Activate')}</Button>
            <Button size="xs" variant="outline" onClick={() => bulk.mutate({ action: 'deactivate', productIds: productIds(rows) }, { onSuccess: clear })}><Ban /> {t('Deactivate')}</Button>
            <Can perm="inventory.delete">
              <ConfirmDialog
                trigger={<Button size="xs" variant="outline" className="text-destructive"><Trash2 /> {t('Delete')}</Button>}
                title={tn(productIds(rows).length, 'Delete {n} product?', 'Delete {n} products?')}
                description={t('They disappear from lists and pickers. Stock history is kept, and an admin can restore them from the audit log.')}
                confirmLabel={t('Delete products')}
                destructive
                onConfirm={() => bulk.mutateAsync({ action: 'delete', productIds: productIds(rows) }).then(clear)}
              />
            </Can>
          </Can>
        )}
      />
    </>
  )
}
