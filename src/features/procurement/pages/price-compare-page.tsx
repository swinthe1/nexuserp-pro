import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { itemCodes } from '@/lib/item-codes'
import { supabase } from '@/lib/supabase'
import { cn, formatAmount, formatDate, formatMoney, formatQty, num } from '@/lib/utils'

type Row = { variant_id: string; item_no: number | null; sku: string; name: string; barcode: string | null; uom: string | null; vendors: number
  cheap_vendor: string | null; cheap_vendor_id: string | null; cheap_price: number; dear_vendor: string | null; dear_vendor_id: string | null; dear_price: number
  diff: number; diff_pct: number | null; avg_cost: number | null }
type VendorPrice = { vendor_id: string | null; vendor: string | null; last_price: number; last_date: string; last_bill: string; min_price: number; max_price: number
  avg_price: number; qty: number; times: number; list_price: number | null }

const PERIODS: { days: number; label: string }[] = [
  { days: 30, label: msg('Last 30 days') }, { days: 90, label: msg('Last 3 months') }, { days: 180, label: msg('Last 6 months') }, { days: 365, label: msg('Last year') },
]
const since = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10) }

/** The same item bought from different suppliers: who sold it cheapest and who dearest */
export function PriceComparePage() {
  const { companyId } = useCompany()
  const [days, setDays] = React.useState(180)
  const [open, setOpen] = React.useState<Row | null>(null)
  const q = useQuery({
    queryKey: ['vendor-price-compare', companyId, days], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('vendor_price_compare', { p_company: companyId!, p_from: since(days) })) as unknown as { rows: Row[] },
  })
  const rows = q.data?.rows ?? []
  const cols = React.useMemo<ColumnDef<Row>[]>(() => [
    { id: 'item', accessorFn: (r) => `${r.name} ${r.item_no ?? ''} ${r.barcode ?? ''} ${r.sku}`, enableHiding: false,
      header: ({ column }) => <ColumnHeader column={column} title={t('Item')} />, meta: { label: t('Item'), exportValue: (r) => r.name },
      cell: ({ row: { original: r } }) => <div className="min-w-0"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{itemCodes(r)}</div></div> },
    { accessorKey: 'item_no', header: t('No.|item'), meta: { label: t('No.|item'), align: 'right' }, cell: ({ getValue }) => (getValue() as number | null) ?? '—' },
    { accessorKey: 'barcode', header: t('Barcode'), meta: { label: t('Barcode') }, cell: ({ getValue }) => <span className="tabular text-[13px]">{(getValue() as string) || '—'}</span> },
    { accessorKey: 'vendors', header: t('Suppliers'), meta: { label: t('Suppliers'), align: 'right' } },
    { id: 'cheap', accessorFn: (r) => num(r.cheap_price), header: ({ column }) => <ColumnHeader column={column} title={t('Cheapest')} />, meta: { label: t('Cheapest'), align: 'right' },
      cell: ({ row: { original: r } }) => <div><div className="tabular font-medium text-success">{formatMoney(r.cheap_price, undefined, 4)}</div><div className="text-xs text-muted-foreground">{r.cheap_vendor}</div></div> },
    { id: 'dear', accessorFn: (r) => num(r.dear_price), header: ({ column }) => <ColumnHeader column={column} title={t('Dearest')} />, meta: { label: t('Dearest'), align: 'right' },
      cell: ({ row: { original: r } }) => <div><div className="tabular font-medium text-destructive">{formatMoney(r.dear_price, undefined, 4)}</div><div className="text-xs text-muted-foreground">{r.dear_vendor}</div></div> },
    { id: 'diff', accessorFn: (r) => num(r.diff), header: ({ column }) => <ColumnHeader column={column} title={t('Difference per unit')} />, meta: { label: t('Difference per unit'), align: 'right' },
      cell: ({ getValue }) => formatMoney(getValue() as number, undefined, 4) },
    { id: 'diff_pct', accessorFn: (r) => (r.diff_pct == null ? null : num(r.diff_pct)), header: ({ column }) => <ColumnHeader column={column} title={t('Difference %')} />,
      meta: { label: t('Difference %'), align: 'right' },
      cell: ({ getValue }) => { const v = getValue() as number | null; return v == null ? '—' : <span className={cn('tabular', v >= 10 && 'font-semibold text-warning')}>{formatAmount(v, 1)}%</span> } },
  ], [])
  return (
    <>
      <PageHeader title={t('Price comparison|menu')}
        description={t('The same item (the same card, the same barcode) bought from two suppliers or more: each one\'s last price in the period, the cheapest and the dearest. Prices without VAT, after the discounts.')}
        actions={<div className="grid gap-1"><Label className="text-xs">{t('Period')}</Label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.days} value={String(p.days)}>{t(p.label)}</SelectItem>)}</SelectContent></Select></div>} />
      <DataTable tableKey="procurement.price-compare" columns={cols} data={q.data ? rows : undefined} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.variant_id}
        searchPlaceholder={t('Name, number, barcode or code')} exportName="price-comparison" initialHidden={['item_no', 'barcode']} onRowClick={setOpen}
        empty={{ title: t('No item was bought from more than one supplier in this period'), description: t('Choose a longer period, or check that the same item is not registered twice under different names.') }} />
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{open.name}</DialogTitle><DialogDescription>{itemCodes(open)}</DialogDescription></DialogHeader>
            <ItemVendorPrices variantId={open.variant_id} days={days} />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** One item, each supplier: the last, lowest, highest and average price paid, and how much was bought */
export function ItemVendorPrices({ variantId, days = 365, uom }: { variantId: string; days?: number; uom?: string | null }) {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['item-vendor-prices', companyId, variantId, days], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('item_vendor_prices', { p_company: companyId!, p_variant: variantId, p_from: since(days) })) as unknown as { vendors: VendorPrice[] },
  })
  if (q.isLoading) return <Skeleton className="h-32" />
  const vs = q.data?.vendors ?? []
  if (!vs.length) return <p className="text-[13px] text-muted-foreground">{t('Not bought in this period.')}</p>
  const low = Math.min(...vs.map((v) => num(v.last_price))), high = Math.max(...vs.map((v) => num(v.last_price)))
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t('Supplier')}</TableHead><TableHead className="text-right">{t('Last price')}</TableHead><TableHead className="text-right">{t('Lowest')}</TableHead>
          <TableHead className="text-right">{t('Highest')}</TableHead><TableHead className="text-right">{t('Average')}</TableHead><TableHead className="text-right">{t('Bought')}</TableHead>
          <TableHead className="text-right">{t('On their price list')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {vs.map((v) => (
            <TableRow key={v.vendor_id ?? 'none'}>
              <TableCell>{v.vendor_id ? <Link to={`/partners/${v.vendor_id}`} className="font-medium hover:underline">{v.vendor}</Link> : '—'}
                <div className="text-xs text-muted-foreground">{t('Last on {date}', { date: formatDate(v.last_date) })} · {v.last_bill}</div></TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-1 tabular font-medium">
                  {vs.length > 1 && num(v.last_price) === low && <Badge variant="success" className="gap-0.5 px-1.5"><ArrowDown className="size-3" />{t('Cheapest')}</Badge>}
                  {vs.length > 1 && num(v.last_price) === high && low !== high && <Badge variant="destructive" className="gap-0.5 px-1.5"><ArrowUp className="size-3" />{t('Dearest')}</Badge>}
                  {formatMoney(v.last_price, undefined, 4)}
                </span></TableCell>
              <TableCell className="text-right tabular">{formatMoney(v.min_price, undefined, 4)}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(v.max_price, undefined, 4)}</TableCell>
              <TableCell className="text-right tabular">{formatMoney(v.avg_price, undefined, 4)}</TableCell>
              <TableCell className="text-right tabular">{formatQty(v.qty, uom ?? undefined)}<div className="text-xs text-muted-foreground">{tn(v.times, '{n} time', '{n} times')}</div></TableCell>
              <TableCell className="text-right tabular">{v.list_price != null ? formatMoney(v.list_price, undefined, 4) : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** The card on the item's page */
export function ItemVendorPricesCard({ variantId, uom }: { variantId: string; uom?: string | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>{t('Prices by supplier')}</CardTitle>
        <CardDescription>{t('What each supplier charged for this item in the last year, without VAT, after the discounts.')}</CardDescription></CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6"><ItemVendorPrices variantId={variantId} uom={uom} /></CardContent>
    </Card>
  )
}
