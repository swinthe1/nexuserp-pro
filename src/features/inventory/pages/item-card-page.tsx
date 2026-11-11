import { useQuery } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatementActions } from '@/components/statement-actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td } from '@/i18n'
import { searchOffline, useScanCatalog } from '@/lib/offline/catalog'
import { fetchItemCard, itemCardStatement, MOVEMENT } from '@/lib/documents/statements'
import { formatDate, formatMoney, formatQty, todayISO } from '@/lib/utils'
import { SOURCE_HREF } from '@/features/finance/api'
import { useWarehouses } from '../api'
import { MovementsTable } from '../components/movements-table'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const HREF: Record<string, string> = { ...SOURCE_HREF, pos_order: '/pos/sessions/', vendor_return: '/inventory/receipts/' }

/** Inventory › Item card: every movement of one item, with the quantity and value after each. */
export function ItemCardPage() {
  const { companyId } = useCompany()
  const catalog = useScanCatalog()
  const [params, setParams] = useSearchParams()
  const id = params.get('v')
  const options = React.useMemo(() => (companyId && catalog.ready ? searchOffline(companyId, '', 1_000_000) : [])
    .map((i) => ({ value: i.variant_id, label: i.name, hint: i.sku, keywords: i.barcodes.map(([b]) => b) })), [companyId, catalog.ready, catalog.count]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader actions={<PageTableExport />} title={t('Item card')} description={t('Every item that came in, went out or moved, with the document behind it. Choose an item to see its card with the quantity and the value after each movement.')} />
      <div className="mb-4 max-w-md">
        <SearchSelect value={id} onChange={(v) => { const n = new URLSearchParams(params); if (v) n.set('v', v); else n.delete('v'); setParams(n, { replace: true }) }}
          placeholder={t('Choose an item (name, code or barcode)')} options={options} />
      </div>
      {id ? <ItemCardView key={id} variantId={id} /> : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <h2 className="text-sm font-semibold">{t('All movements')}</h2>
          <MovementsTable />
        </div>
      )}
    </>
  )
}

export function ItemCardView({ variantId }: { variantId: string }) {
  const warehouses = useWarehouses()
  const [wh, setWh] = React.useState<string>('all')
  const [from, setFrom] = React.useState(yearStart())
  const [to, setTo] = React.useState(todayISO())
  const q = useQuery({ queryKey: ['item-card', variantId, wh, from, to], staleTime: 0, queryFn: () => fetchItemCard(variantId, wh === 'all' ? null : wh, from, to) })
  const c = q.data
  // the suppliers this item came from (or went back to) in the period: choosing one leaves only their lines
  const [vendor, setVendor] = React.useState<string>('all')
  const vendors = React.useMemo(() => [...new Set((c?.rows ?? []).filter((r) => r.partner && (r.type === 'receipt' || r.type === 'purchase_return')).map((r) => r.partner as string))].sort((a, b) => a.localeCompare(b)), [c])
  React.useEffect(() => { if (vendor !== 'all' && c && !vendors.includes(vendor)) setVendor('all') }, [vendors, vendor, c])
  const shown = React.useMemo(() => (c?.rows ?? []).filter((r) => vendor === 'all' || ((r.type === 'receipt' || r.type === 'purchase_return') && r.partner === vendor)), [c, vendor])
  const filtered = vendor !== 'all'
  const sumIn = shown.reduce((a, r) => a + Number(r.qty_in || 0), 0), sumOut = shown.reduce((a, r) => a + Number(r.qty_out || 0), 0)
  const valueIn = shown.reduce((a, r) => a + Number(r.value_in || 0), 0), valueOut = shown.reduce((a, r) => a + Number(r.value_out || 0), 0)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label>{t('Warehouse')}</Label>
          <Select value={wh} onValueChange={setWh}><SelectTrigger className="w-56" aria-label={t('Warehouse')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All warehouses')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label>{t('Supplier')}</Label>
          <SearchSelect value={vendor === 'all' ? null : vendor} onChange={(v) => setVendor(v ?? 'all')} disabled={!vendors.length} clearable
            className="w-60" aria-label={t('Supplier')} placeholder={t('All suppliers')} searchPlaceholder={t('Search supplier by name…')}
            options={vendors.map((v) => ({ value: v, label: v }))} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ic-from">{t('From')}</Label><Input id="ic-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ic-to">{t('To')}</Label><Input id="ic-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
        <div className="ml-auto"><StatementActions disabled={!c} build={async () => itemCardStatement(c ?? await fetchItemCard(variantId, wh === 'all' ? null : wh, from, to))} /></div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !c ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('Date')}</TableHead><TableHead>{t('Movement')}</TableHead><TableHead>{t('Document')}</TableHead><TableHead>{t('Partner / warehouse')}</TableHead>
              <TableHead className="text-right">{t('In')}</TableHead><TableHead className="text-right">{t('Out')}</TableHead><TableHead className="text-right">{t('Unit cost (without VAT)')}</TableHead>
              <TableHead className="text-right">{t('Quantity')}</TableHead><TableHead className="text-right">{t('Value at cost')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {!filtered && <TableRow className="bg-muted/40 font-medium"><TableCell>{formatDate(c.from)}</TableCell><TableCell colSpan={6}>{t('Opening balance')}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(c.opening_qty, c.uom)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(c.opening_value)}</TableCell></TableRow>}
              {shown.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t('Nothing in this period.')}</TableCell></TableRow>}
              {shown.map((r) => {
                const href = r.source_type && r.source_id && HREF[r.source_type] ? HREF[r.source_type] + r.source_id : null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell>{t(MOVEMENT[r.type] ?? r.type)}</TableCell>
                    <TableCell className="whitespace-nowrap">{href && r.source_type !== 'pos_order' ? <Link className="text-primary hover:underline" to={href}>{r.reference}</Link> : r.reference}</TableCell>
                    <TableCell className="text-muted-foreground">{r.partner ?? (r.warehouse ? td(r.warehouse) : '')}{r.lot ? ` · ${r.lot}` : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.qty_in ? formatQty(r.qty_in, c.uom) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.qty_out ? formatQty(r.qty_out, c.uom) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(r.unit_cost, undefined, 4)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatQty(r.qty, c.uom)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.value)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>{filtered ? (
              // one supplier: what came in from them and what went back, in quantity and at cost
              <TableRow>
                <TableCell colSpan={4}>{t('Total from {name}', { name: vendor })}</TableCell>
                <TableCell className="text-right tabular-nums">{sumIn ? formatQty(sumIn, c.uom) : ''}</TableCell>
                <TableCell className="text-right tabular-nums">{sumOut ? formatQty(sumOut, c.uom) : ''}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{formatQty(sumIn - sumOut, c.uom)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(valueIn - valueOut, c.currency)}</TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={7}>{t('Closing balance')} · {formatDate(c.to)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(c.closing_qty, c.uom)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(c.closing_value, c.currency)}</TableCell>
              </TableRow>
            )}</TableFooter>
          </Table>
        </div>
      )}
    </div>
  )
}
