import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDownLeft, ArrowUpRight, Download, Hourglass, MoveRight } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { t, tn } from '@/i18n'
import { cn, formatDate, formatQty, humanize } from '@/lib/utils'
import { downloadCsv } from '@/lib/export'
import { DOC_HREF, useLotsList, useLotTrace } from '../api'
import { LotGenealogy } from '@/features/manufacturing/components/lot-genealogy'

const daysLeft = (d: string | null) => (d ? Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5) : null)
function expiryState(d: string | null): { label: string; tone: 'secondary' | 'warning' | 'destructive' | 'success' } {
  const n = daysLeft(d)
  if (n == null) return { label: t('No expiry'), tone: 'secondary' }
  if (n < 0) return { label: tn(-n, 'Expired {n} day ago', 'Expired {n} days ago'), tone: 'destructive' }
  const left = tn(n, '{n} day left', '{n} days left')
  if (n <= 7) return { label: left, tone: 'destructive' }
  if (n <= 30) return { label: left, tone: 'warning' }
  return { label: left, tone: 'success' }
}

export function LotsPage() {
  const navigate = useNavigate()
  const lots = useLotsList()
  const rows = React.useMemo(() => (lots.data ?? []).map((l) => {
    const onHand = l.levels.reduce((s, x) => s + Number(x.on_hand), 0)
    const n = daysLeft(l.expiry_date)
    return { ...l, on_hand: onHand, days: n, band: n == null ? 'none' : n < 0 ? 'expired' : n <= 30 ? 'soon' : 'ok', stock: onHand > 0 ? 'in_stock' : 'used_up' }
  }), [lots.data])
  type Row = (typeof rows)[number]
  const cols = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'lot_number', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Lot')} />, meta: { label: t('Lot') }, cell: ({ getValue }) => <span className="font-mono font-medium">{getValue() as string}</span> },
    { id: 'item', accessorFn: (r) => `${r.variant?.sku} ${r.variant?.name}`, header: ({ column }) => <ColumnHeader column={column} title={t('Item')} />, meta: { label: t('Item') },
      cell: ({ row: { original: r } }) => <span><span className="text-muted-foreground">{r.variant?.sku}</span> {r.variant?.name}</span> },
    { id: 'vendor', accessorFn: (r) => r.vendor?.name ?? '', header: t('Vendor'), meta: { label: t('Vendor') } },
    { accessorKey: 'expiry_date', header: ({ column }) => <ColumnHeader column={column} title={t('Expires')} />, meta: { label: t('Expires') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'band', filterFn: inFilter, header: t('Shelf life'), meta: { label: t('Shelf life') }, cell: ({ row: { original: r } }) => { const s = expiryState(r.expiry_date); return <Badge variant={s.tone}>{s.label}</Badge> } },
    { accessorKey: 'stock', filterFn: inFilter, header: t('Stock'), meta: { label: t('Stock') }, cell: () => null, enableHiding: true },
    { accessorKey: 'on_hand', header: ({ column }) => <ColumnHeader column={column} title={t('On hand')} />, meta: { label: t('On hand'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(getValue() as number)}</span> },
  ], [])
  const expired = rows.filter((r) => r.band === 'expired' && r.on_hand > 0)
  const soon = rows.filter((r) => r.band === 'soon' && r.on_hand > 0)
  return (
    <>
      <PageHeader title={t('Lots & expiry|menu')} description={t('Every lot and serial number, how long it keeps, and where it went. Open a lot to see its full path and the customers who received it.')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Expired, still in stock')} value={expired.length} tone={expired.length ? 'destructive' : 'default'} loading={lots.isLoading} hint={t('{n} units to take off the shelves', { n: formatQty(expired.reduce((s, r) => s + r.on_hand, 0)) })} />
        <StatCard label={t('Expiring within 30 days')} value={soon.length} tone={soon.length ? 'warning' : 'default'} loading={lots.isLoading} hint={t('Sell these first — picking and the till already take them first')} />
        <StatCard label={t('Lots in stock')} value={rows.filter((r) => r.on_hand > 0).length} loading={lots.isLoading} hint={tn(rows.length, '{n} lot recorded', '{n} lots recorded')} />
      </div>
      <DataTable tableKey="wms.lots" columns={cols} data={rows} isLoading={lots.isLoading} error={lots.error} getRowId={(r) => r.id} exportName={t('lots')}
        searchPlaceholder={t('Lot number, code, product…')} onRowClick={(r) => navigate(`/wms/lots/${r.id}`)}
        initialFilters={[{ id: 'stock', value: ['in_stock'] }]}
        facets={[
          { columnId: 'band', title: t('Shelf life'), options: [{ value: 'expired', label: t('Expired') }, { value: 'soon', label: t('Within 30 days') }, { value: 'ok', label: t('More than 30 days') }, { value: 'none', label: t('No expiry') }] },
          { columnId: 'stock', title: t('Stock'), options: [{ value: 'in_stock', label: t('In stock') }, { value: 'used_up', label: t('Used up') }] },
        ]}
        empty={{ title: t('No lots recorded'), description: t('Lots are created when items tracked by lot are received.') }} />
    </>
  )
}

const IN_TYPES = new Set(['receipt', 'opening', 'adjustment_in', 'production_output', 'sales_return', 'pos_return'])
const OUT_TYPES = new Set(['delivery', 'pos_sale', 'adjustment_out', 'scrap', 'production_consume', 'purchase_return'])

export function LotTracePage() {
  const { id } = useParams()
  const tr = useLotTrace(id)
  if (tr.isError) return <ErrorState error={tr.error} onRetry={() => void tr.refetch()} />
  if (tr.isLoading) return <Skeleton className="h-96" />
  if (!tr.data?.lot) return <EmptyState title={t('Lot not found')} action={<Button asChild variant="outline"><Link to="/wms/lots">{t('Back to lots')}</Link></Button>} />
  const { lot, stock, movements, customers } = tr.data
  const s = expiryState(lot.expiry_date)
  const onHand = stock.reduce((sum, x) => sum + Number(x.on_hand), 0)
  return (
    <>
      <PageHeader back={{ href: '/wms/lots', label: t('Lots and expiry') }} title={<span className="font-mono">{lot.lot_number}</span>}
        meta={<Badge variant={s.tone}>{s.label}</Badge>}
        description={<>{lot.sku} · {lot.variant_name}{lot.vendor_name ? ` · ${t('from {vendor}', { vendor: lot.vendor_name })}` : ''}{lot.manufacture_date ? ` · ${t('made {date}', { date: formatDate(lot.manufacture_date) })}` : ''}{lot.expiry_date ? ` · ${t('expires {date}', { date: formatDate(lot.expiry_date) })}` : ''}</>}
        actions={<Button variant="outline" disabled={!customers.length} onClick={() => downloadCsv(`${t('recall')}-${lot.lot_number}`, [[t('Customer'), t('Quantity'), t('Last delivery')], ...customers.map((c) => [c.name, c.quantity, c.last_date.slice(0, 10)])])}>
          <Download /> {t('Recall list')}</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('Came in')} value={formatQty(tr.data.received)} hint={t('Received, produced or found')} />
        <StatCard label={t('Went to customers')} value={formatQty(tr.data.shipped)} hint={tn(customers.length, '{n} customer or till', '{n} customers or tills')} />
        <StatCard label={t('On hand now')} value={formatQty(onHand)} hint={stock.map((x) => `${x.location} ${formatQty(x.on_hand)}`).join(' · ') || t('None left')} />
      </div>
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="py-3"><CardTitle>{t('Movements')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ol className="relative">
              {movements.map((m) => {
                const dir = IN_TYPES.has(m.movement_type) ? 'in' : OUT_TYPES.has(m.movement_type) ? 'out' : 'move'
                const href = m.source_doc_type && m.source_doc_id && DOC_HREF[m.source_doc_type] ? DOC_HREF[m.source_doc_type] + m.source_doc_id : null
                return (
                  <li key={m.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 border-b px-4 py-2.5 text-[13px] last:border-0">
                    <span className={cn('mt-0.5 flex size-6 items-center justify-center rounded-full', dir === 'in' ? 'bg-success/15 text-success' : dir === 'out' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      {dir === 'in' ? <ArrowDownLeft className="size-3.5" /> : dir === 'out' ? <ArrowUpRight className="size-3.5" /> : <MoveRight className="size-3.5" />}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{humanize(m.movement_type)}</span>{m.partner_name ? <span> · {m.partner_name}</span> : null}
                      <span className="block text-muted-foreground">{m.from_code} → {m.to_code} · {href ? <Link className="text-primary hover:underline" to={href}>{m.reference}</Link> : m.reference}</span>
                    </span>
                    <span className="text-right"><span className="block font-medium tabular">{dir === 'out' ? '−' : dir === 'in' ? '+' : ''}{formatQty(m.quantity)}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(m.movement_date, true)}</span></span>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader className="py-3"><CardTitle>{t('Who received it')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-[13px]">
            {!customers.length && <p className="text-muted-foreground">{t('Nothing from this lot has left the company.')}</p>}
            {customers.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-3">
                {c.partner_id ? <Link to={`/partners/${c.partner_id}`} className="font-medium hover:underline">{c.name}</Link> : <span className="font-medium">{c.name}</span>}
                <span className="text-right tabular">{formatQty(c.quantity)}<span className="block text-xs text-muted-foreground">{formatDate(c.last_date)}</span></span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <LotGenealogy lotId={lot.id} />
      <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Hourglass className="size-4" /> {t('Picking, putting away and the till use the lots that expire first. Expired lots are never reserved for orders.')}</p>
    </>
  )
}

