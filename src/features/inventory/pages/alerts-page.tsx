import { formatQtyOf } from '@/lib/units'
import type { ColumnDef } from '@tanstack/react-table'
import { BellOff, PackageCheck, ShoppingCart } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StockBar } from '@/components/stock-bar'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import type { Views } from '@/lib/database.types'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { formatDate, formatQty } from '@/lib/utils'
import { invKeys, useAcknowledgeAlert, useLowStock } from '../api'
import { t, td, tEnum, tr } from '@/i18n'

type Low = Views<'v_low_stock'>

function AckButton({ id }: { id: string }) {
  const ack = useAcknowledgeAlert()
  return (
    <Button size="xs" variant="ghost" loading={ack.isPending} onClick={(e) => { e.stopPropagation(); ack.mutate(id) }}>
      <BellOff /> {t('Mark as seen')}
    </Button>
  )
}

export function AlertsPage() {
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const low = useLowStock()
  useRealtimeInvalidate('stock_alerts', companyId, [invKeys.lowStock(companyId)])

  const columns = React.useMemo<ColumnDef<Low>[]>(() => [
    {
      id: 'product', accessorFn: (r) => `${r.sku} ${r.variant_name}`, enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Product')} />, meta: { label: t('Code'), exportValue: (r) => r.sku },
      cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.sku}</div><div className="text-xs text-muted-foreground">{r.variant_name}</div></div>,
    },
    { accessorKey: 'warehouse_name', id: 'warehouse', filterFn: inFilter, header: t('Warehouse'), meta: { label: t('Warehouse') }, cell: ({ getValue }) => td(getValue() as string) },
    {
      id: 'level', header: t('Available vs. reorder point'), meta: { label: t('Available'), exportValue: (r) => r.available },
      cell: ({ row: { original: r } }) => <StockBar onHand={r.available} reserved={0} min={r.min_qty} max={r.max_qty} variantId={r.variant_id} className="max-w-[240px]" />,
    },
    { accessorKey: 'min_qty', header: t('Reorder at'), meta: { label: t('Reorder at'), align: 'right' }, cell: ({ row: { original: r } }) => formatQtyOf(r.min_qty, r.variant_id) },
    {
      accessorKey: 'incoming', header: t('Incoming'), meta: { label: t('Incoming'), align: 'right' },
      cell: ({ row: { original: r } }) => <>{formatQty(r.incoming)}{r.next_expected_date && <div className="text-xs text-muted-foreground">{t('by {date}', { date: formatDate(r.next_expected_date) })}</div>}</>,
    },
    {
      accessorKey: 'suggested_qty', header: ({ column }) => <ColumnHeader column={column} title={t('Suggested order')} />, meta: { label: t('Suggested order'), align: 'right' },
      cell: ({ getValue }) => <span className="font-semibold">{formatQty(getValue() as number)}</span>,
    },
    { accessorKey: 'preferred_vendor_name', header: t('Vendor'), meta: { label: t('Preferred vendor') }, cell: ({ getValue }) => (getValue() as string) ?? <span className="text-muted-foreground">{t('Not set')}</span> },
    {
      accessorKey: 'alert_status', id: 'status', filterFn: inFilter, header: t('Alert'), meta: { label: t('Alert') },
      cell: ({ row: { original: r } }) => <div><StatusBadge status={r.alert_status} />{r.triggered_at && <div className="text-2xs text-muted-foreground">{t('since {date}', { date: formatDate(r.triggered_at) })}</div>}</div>,
    },
    {
      id: 'actions', enableHiding: false, meta: { noExport: true },
      cell: ({ row: { original: r } }) => r.alert_status === 'open' && (
        <Can perm="inventory.write" fallback={<Can perm="oms.write"><AckButton id={r.alert_id!} /></Can>}><AckButton id={r.alert_id!} /></Can>
      ),
    },
  ], [])

  return (
    <>
      <PageHeader
        title={t('Low stock|menu')}
        description={t('Items at or below their reorder point. The suggested order fills each warehouse up to its maximum, minus what is already ordered.')}
        actions={<>
          <Can perm="wms.write"><Button variant="outline" asChild><Link to="/inventory/receipts/new"><PackageCheck /> {t('Receive goods')}</Link></Button></Can>
          {/* what runs out is ordered: the replenishment page proposes the quantities and makes the orders */}
          <Can perm="procurement.read"><Button asChild><Link to="/procurement/replenishment"><ShoppingCart /> {t('Order what runs out')}</Link></Button></Can>
        </>}
      />
      <DataTable
        tableKey="inventory.low-stock"
        columns={columns}
        data={low.data}
        isLoading={low.isLoading}
        error={low.error}
        getRowId={(r) => r.rule_id!}
        searchPlaceholder={t('Code or product')}
        exportName="low-stock"
        onRowClick={(r) => navigate(`/inventory/products/${r.product_id}`)}
        facets={[
          { columnId: 'warehouse', unit: true, title: t('Warehouse'), options: Array.from(new Set((low.data ?? []).map((r) => r.warehouse_name!))).map((w) => ({ label: td(w), value: w })) },
          { columnId: 'status', title: t('Alert'), options: [{ label: t('Open|status'), value: 'open' }, { label: tEnum('acknowledged'), value: 'acknowledged' }] },
        ]}
        empty={{ title: t('Nothing is running low'), description: t('Every item with a reorder point is above it. Set a reorder point on a product to be warned here.') }}
      />
      <p className="mt-3 text-xs text-muted-foreground">{tr('To order the suggested quantities, open {link}.', { link: <Link to="/procurement/replenishment" className="text-primary hover:underline">{t('Replenishment')}</Link> })}</p>
    </>
  )
}
