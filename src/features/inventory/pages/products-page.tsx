import { categoryColumns, categoryFacets, useCategoryParts } from '../components/category-picks'
import type { ColumnDef } from '@tanstack/react-table'
import { Ban, CheckCircle2, PackagePlus, Plus, Trash2, Upload, Warehouse } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ProductView } from './product-detail-page'
import { usePendingItemRequests } from './item-requests-page'
import { StockByUnitDialog } from '../components/stock-by-unit'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter, LeadCell, selectColumn } from '@/components/data-table/data-table'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import { StockBar } from '@/components/stock-bar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useBulkProducts, useProductStock, type ProductStockRow } from '../api'
import { t, tEnum, tn } from '@/i18n'

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
  const { company } = useCompany()
  const cur = company?.base_currency
  const products = useProductStock()
  const bulk = useBulkProducts()
  const [byUnit, setByUnit] = React.useState<string[] | null>(null)
  // a row opens the item in a window over the list (?item=…), so the list stays as it was: its
  // filters, its page, where it was scrolled; the browser's back closes it
  const [params, setParams] = useSearchParams()
  const openId = params.get('item')
  const openItem = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('item', id); else n.delete('item'); return n }, { replace: !id })

  const parts = useCategoryParts()
  const columns = React.useMemo<ColumnDef<ProductStockRow>[]>(() => [
    selectColumn<ProductStockRow>(),
    {
      id: 'product',
      accessorFn: (r) => `${r.variant_name} ${r.sku} ${r.barcode ?? ''} ${r.codes ?? ''}`,
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
    ...categoryColumns<ProductStockRow>((r) => r.category_id ?? r.category_name, parts),
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
        ? <StockBar onHand={r.on_hand} reserved={r.reserved} min={r.reorder_min} max={r.reorder_max} unit={r.uom_code} className="max-w-[200px]" />
        : <span className="text-[13px] text-muted-foreground">{t('Not stocked')}</span>,
    },
    { accessorKey: 'on_hand', header: ({ column }) => <ColumnHeader column={column} title={t('On hand')} />, meta: { label: t('On hand'), align: 'right' }, cell: ({ row: { original: r } }) => formatQty(r.on_hand, r.uom_code) },
    { accessorKey: 'reserved', header: ({ column }) => <ColumnHeader column={column} title={t('Reserved')} />, meta: { label: t('Reserved'), align: 'right' }, cell: ({ row: { original: r } }) => formatQty(r.reserved, r.uom_code) },
    { accessorKey: 'incoming', header: ({ column }) => <ColumnHeader column={column} title={t('Incoming')} />, meta: { label: t('Incoming'), align: 'right' }, cell: ({ row: { original: r } }) => formatQty(r.incoming, r.uom_code) },
    { accessorKey: 'sales_price', header: ({ column }) => <ColumnHeader column={column} title={t('Selling price (without VAT)')} />, meta: { label: t('Selling price (without VAT)'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
    { accessorKey: 'avg_cost', header: ({ column }) => <ColumnHeader column={column} title={t('Avg cost (without VAT)')} />, meta: { label: t('Average cost (without VAT)'), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number, undefined, 2) },
    { accessorKey: 'stock_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value at cost')} />, meta: { label: t('Value at cost ({currency})', { currency: cur }), align: 'right' }, cell: ({ getValue }) => formatMoney(getValue() as number) },
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
  ], [cur, parts])

  const productIds = (rows: { original: ProductStockRow }[]) => Array.from(new Set(rows.map((r) => r.original.product_id!).filter(Boolean)))

  return (
    <>
      <PageHeader
        title={t('Products')}
        description={t('Every sellable and stocked item, one row per variant (SKU). Average cost updates automatically on every receipt.')}
        actions={<><RequestsButton /><Can perm="inventory.write"><Button variant="outline" asChild><Link to="/settings/import?kind=products"><Upload /> {t('Import')}</Link></Button><Button asChild><Link to="/inventory/products/new"><Plus /> {t('New product')}</Link></Button></Can></>}
      />
      <DataTable
        tableKey="inventory.products"
        columns={columns}
        data={products.data}
        isLoading={products.isLoading}
        error={products.error}
        getRowId={(r) => r.variant_id!}
        searchPlaceholder={t('Name, code, barcode or supplier code')}
        initialHidden={['sku', 'barcode', 'on_hand', 'reserved', 'incoming', 'last_received', 'activity']}
        initialSorting={[{ id: 'product', desc: false }]}
        onRowClick={(r) => r.product_id && openItem(r.product_id)}
        exportName="products"
        footer={(table) => {
          // how many items the list shows, and how much of them there is, one sum per unit (copë and kg are not added together)
          const rows = table.getFilteredRowModel().rows.map((r) => r.original)
          const byUnit = (k: 'available' | 'on_hand' | 'reserved' | 'incoming') => {
            const m = new Map<string, number>()
            for (const r of rows) if (r.product_type !== 'service' && num(r[k])) m.set(r.uom_code ?? '', (m.get(r.uom_code ?? '') ?? 0) + num(r[k]))
            return [...m].sort((a, b) => b[1] - a[1]).map(([u, q]) => <span key={u} className="block whitespace-nowrap">{formatQty(Math.round(q * 1000) / 1000, u || undefined)}</span>)
          }
          return (
            <TableFooter>
              <TableRow className="hover:bg-transparent align-top font-semibold">
                <LeadCell />
                {table.getVisibleLeafColumns().map((c) => {
                  let v: React.ReactNode = ''
                  if (c.id === 'product') v = tn(rows.length, '{n} item in all', '{n} items in all')
                  else if (c.id === 'availability' || c.id === 'on_hand' || c.id === 'reserved' || c.id === 'incoming')
                    v = byUnit(c.id === 'availability' ? 'available' : c.id)
                  else if (c.id === 'stock_value') v = formatMoney(rows.reduce((s, r) => s + num(r.stock_value), 0))
                  return <TableCell key={c.id} className={cn(c.id !== 'product' && 'text-right tabular')}>{v}</TableCell>
                })}
              </TableRow>
            </TableFooter>
          )
        }}
        facets={[
          ...categoryFacets(products.data, (r) => r.category_id ?? r.category_name, parts),
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
        bulkActions={(rows, clear) => (<>
          <Button size="xs" variant="outline" onClick={() => setByUnit(rows.map((r) => r.original.variant_id!).filter(Boolean))}><Warehouse /> {t('Stock in every unit')}</Button>
          <Can perm="inventory.write">
            <Button size="xs" variant="outline" onClick={() => bulk.mutate({ action: 'activate', productIds: productIds(rows) }, { onSuccess: clear })}><CheckCircle2 /> {t('Activate')}</Button>
            {(() => {
              // suspending: the item stays in reports and history, but is neither bought nor sold; with stock left, ask first
              const withStock = rows.filter((r) => num(r.original.on_hand) > 0)
              const run = () => bulk.mutateAsync({ action: 'deactivate', productIds: productIds(rows) }).then(clear)
              return withStock.length ? (
                <ConfirmDialog trigger={<Button size="xs" variant="outline"><Ban /> {t('Suspend')}</Button>}
                  title={tn(withStock.length, '{n} item still has stock', '{n} items still have stock')}
                  description={t('{items}. Suspended, they are neither bought nor sold, but stay in stock, reports and history. Sell or move the stock first, or suspend anyway.',
                    { items: withStock.slice(0, 5).map((r) => `${r.original.variant_name} (${formatQty(num(r.original.on_hand))})`).join(', ') + (withStock.length > 5 ? '…' : '') })}
                  confirmLabel={t('Suspend anyway')} onConfirm={run} />
              ) : <Button size="xs" variant="outline" onClick={() => void run()}><Ban /> {t('Suspend')}</Button>
            })()}
            <Can perm="inventory.delete">
              <ConfirmDialog
                trigger={<Button size="xs" variant="outline" className="text-destructive"><Trash2 /> {t('Delete')}</Button>}
                title={tn(productIds(rows).length, 'Delete {n} product?', 'Delete {n} products?')}
                description={t('Only items that never moved in stock can be deleted. An item with stock history is suspended instead: it stays in reports and history.')}
                confirmLabel={t('Delete products')}
                destructive
                onConfirm={() => bulk.mutateAsync({ action: 'delete', productIds: productIds(rows) }).then(clear)}
              />
            </Can>
          </Can>
        </>)}
      />
      {byUnit && <StockByUnitDialog variantIds={byUnit} onClose={() => setByUnit(null)} />}
      <Dialog open={!!openId} onOpenChange={(o) => { if (!o) openItem(null) }}>
        <DialogContent className="block h-[92dvh] max-h-[92dvh] w-[calc(100%-2rem)] max-w-[1200px] overflow-y-auto p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{t('Product')}</DialogTitle>
          <div className="px-6 pb-6 pt-5 [&>div:first-child]:pr-10">{openId && <ProductView id={openId} inDialog onDeleted={() => openItem(null)} />}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** for whoever approves items: new items asked for from supplier invoices */
function RequestsButton() {
  const n = usePendingItemRequests().data ?? 0
  if (!n) return null
  return <Button variant="outline" asChild className="border-warning/50 text-warning"><Link to="/inventory/item-requests"><PackagePlus /> {t('{n} new items to approve', { n })}</Link></Button>
}
