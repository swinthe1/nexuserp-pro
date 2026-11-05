import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, td, tEnum } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '../api'

type Out = { adjustment_id: string; number: string; date: string; reason: string; status: string; description: string | null; warehouse_id: string; warehouse: string
  variant_id: string; sku: string; name: string; uom: string | null; group_id: string | null; category_id: string | null; quantity: number
  cost_net: number; cost_gross: number; sale_net: number; sale_gross: number; by: string | null }
type Waste = { key: string; label: string | null; code: string | null; uom: string | null; sold_qty: number; sold_net: number; sold_kg: number | null
  waste_qty: number; waste_kg: number | null; waste_cost: number; waste_sale: number; pct_value: number | null; pct_weight: number | null }

const OUT_REASONS: [string, string][] = [['waste', msg('Thrown away')], ['damage', msg('Damaged')], ['expiry', msg('Expired')], ['internal_use', msg('Used in the company')],
  ['loss', msg('Loss')], ['theft', msg('Theft')], ['count', msg('Stock count')], ['correction', msg('Correction')]]
const reasonLabel = (r: string) => t(OUT_REASONS.find(([k]) => k === r)?.[1] ?? r)

/**
 * Stock outputs (from the meeting with the staff): each one with its description and its value at
 * cost and at the selling price, with and without VAT; and what is thrown away against the sales of
 * the same group or item. Outputs never touch the sales margin.
 */
export function OutputsPage() {
  const { companyId, company } = useCompany()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'waste' ? 'waste' : 'each'
  const [from, setFrom] = React.useState(`${todayISO().slice(0, 8)}01`)
  const [to, setTo] = React.useState(todayISO())
  const [units, setUnits] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [reasons, setReasons] = React.useState<string[]>(() => (tab === 'waste' ? ['waste', 'damage', 'expiry'] : []))
  const [by, setBy] = React.useState<'group' | 'item'>('group')
  const whs = useWarehouses()
  const cats = useCategories()
  const catOptions = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const cur = company?.base_currency ?? ''
  const each = useQuery({
    queryKey: ['inv', companyId, 'outputs', from, to, units, reasons], enabled: !!companyId && tab === 'each',
    queryFn: async () => unwrap(await supabase.rpc('stock_outputs', { p_company: companyId!, p: { from, to, units, reasons } as never })) as unknown as { rows: Out[] },
  })
  const waste = useQuery({
    queryKey: ['inv', companyId, 'waste-vs-sales', from, to, units, groups, reasons, by], enabled: !!companyId && tab === 'waste',
    queryFn: async () => unwrap(await supabase.rpc('waste_vs_sales', { p_company: companyId!, p: { from, to, units, groups, reasons, by } as never })) as unknown as { rows: Waste[] },
  })
  const outRows = React.useMemo(() => (each.data?.rows ?? []).filter((r) => !groups.length || groups.includes(r.group_id ?? '') || groups.includes(r.category_id ?? '')), [each.data, groups])

  const money = (k: keyof Out, label: string): ColumnDef<Out> => ({ accessorKey: k, header: ({ column }) => <ColumnHeader column={column} title={label} />, meta: { label, align: 'right' },
    cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> })
  const outCols = React.useMemo<ColumnDef<Out>[]>(() => [
    { accessorKey: 'date', header: ({ column }) => <ColumnHeader column={column} title={t('Date')} />, meta: { label: t('Date') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'number', header: t('Number'), meta: { label: t('Number') },
      cell: ({ row: { original: r } }) => <Link to={`/inventory/adjustments/${r.adjustment_id}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
    { id: 'reason', accessorFn: (r) => reasonLabel(r.reason), header: t('Reason'), meta: { label: t('Reason') },
      cell: ({ row: { original: r } }) => <span className="whitespace-nowrap">{reasonLabel(r.reason)}{r.status !== 'posted' && <Badge variant="secondary" className="ml-1.5">{tEnum(r.status)}</Badge>}</span> },
    { accessorKey: 'description', header: t('Description'), meta: { label: t('Description') }, cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) ?? '—'}</span> },
    { id: 'unit', accessorFn: (r) => td(r.warehouse), header: t('Unit|store'), meta: { label: t('Unit|store') } },
    { id: 'item', accessorFn: (r) => `${r.name} ${r.sku}`, header: ({ column }) => <ColumnHeader column={column} title={t('Item')} />, meta: { label: t('Item') },
      cell: ({ row: { original: r } }) => <span>{r.name}<span className="ml-1.5 text-[12px] text-muted-foreground">{r.sku}</span></span> },
    { accessorKey: 'quantity', header: ({ column }) => <ColumnHeader column={column} title={t('Quantity')} />, meta: { label: t('Quantity'), align: 'right' },
      cell: ({ row: { original: r } }) => <span className="tabular">{formatQty(num(r.quantity))}{r.uom && <span className="ml-1 text-[11px] text-muted-foreground">{td(r.uom)}</span>}</span> },
    money('cost_net', t('Cost without VAT')), money('cost_gross', t('Cost with VAT')), money('sale_net', t('Selling price without VAT')), money('sale_gross', t('Selling price with VAT')),
    { accessorKey: 'by', header: t('Recorded by'), meta: { label: t('Recorded by') } },
  ], [])
  const sum = (k: 'cost_net' | 'cost_gross' | 'sale_net' | 'sale_gross') => outRows.reduce((s, r) => s + num(r[k]), 0)

  const wRows = waste.data?.rows ?? []
  const wTot = wRows.reduce((a, r) => ({ sold: a.sold + num(r.sold_net), waste: a.waste + num(r.waste_sale), cost: a.cost + num(r.waste_cost), kg: a.kg + num(r.waste_kg), soldKg: a.soldKg + num(r.sold_kg) }),
    { sold: 0, waste: 0, cost: 0, kg: 0, soldKg: 0 })
  const pct = (a: number, b: number) => (b ? `${formatQty(Math.round((a / b) * 1000) / 10)}%` : '—')
  const wCols = React.useMemo<ColumnDef<Waste>[]>(() => [
    { id: 'label', accessorFn: (r) => r.label ?? t('No group'), header: ({ column }) => <ColumnHeader column={column} title={by === 'item' ? t('Item') : t('Group')} />, meta: { label: by === 'item' ? t('Item') : t('Group') },
      cell: ({ row: { original: r } }) => <span>{td(r.label ?? t('No group'))}{r.code && <span className="ml-1.5 text-[12px] text-muted-foreground">{r.code}</span>}</span> },
    { accessorKey: 'sold_net', header: ({ column }) => <ColumnHeader column={column} title={t('Sales without VAT')} />, meta: { label: t('Sales without VAT'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'sold_kg', header: t('Sold, kg'), meta: { label: t('Sold, kg'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue() == null ? '—' : formatQty(num(getValue()))}</span> },
    { accessorKey: 'waste_kg', header: t('Thrown away, kg'), meta: { label: t('Thrown away, kg'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue() == null ? '—' : formatQty(num(getValue()))}</span> },
    { accessorKey: 'waste_qty', header: t('Thrown away, quantity'), meta: { label: t('Thrown away, quantity'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(num(getValue()))}</span> },
    { accessorKey: 'waste_sale', header: ({ column }) => <ColumnHeader column={column} title={t('Thrown away, at the selling price')} />, meta: { label: t('Thrown away, at the selling price'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'waste_cost', header: t('Thrown away, at cost'), meta: { label: t('Thrown away, at cost'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'pct_value', header: ({ column }) => <ColumnHeader column={column} title={t('% of sales, value')} />, meta: { label: t('% of sales, value'), align: 'right' },
      cell: ({ getValue }) => { const v = getValue() as number | null; return <span className={cn('font-semibold tabular', num(v) >= 3 && 'text-destructive')}>{v == null ? '—' : `${formatQty(num(v))}%`}</span> } },
    { accessorKey: 'pct_weight', header: t('% of sales, weight'), meta: { label: t('% of sales, weight'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue() == null ? '—' : `${formatQty(num(getValue()))}%`}</span> },
  ], [by])

  const setTab = (v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'waste') n.set('tab', 'waste'); else n.delete('tab'); return n }, { replace: true })
  return (
    <>
      <PageHeader title={t('Stock outputs|menu')}
        description={t('Goods thrown away, damaged, expired, used in the company, lost or stolen: each with its description and its value at cost and at the selling price. They lower the stock, never the sales margin.')} />
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setReasons(v === 'waste' ? ['waste', 'damage', 'expiry'] : []) }} className="mb-3">
        <TabsList><TabsTrigger value="each">{t('Each output')}</TabsTrigger><TabsTrigger value="waste">{t('Thrown away against sales')}</TabsTrigger></TabsList>
      </Tabs>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        <MultiPick label={t('Groups')} value={groups} onChange={setGroups} options={catOptions} />
        <MultiPick label={t('Reason')} value={reasons} onChange={setReasons} options={OUT_REASONS.map(([value, label]) => ({ value, label: t(label) }))} />
        {tab === 'waste' && (
          <Tabs value={by} onValueChange={(v) => setBy(v as 'group' | 'item')}>
            <TabsList><TabsTrigger value="group">{t('By group')}</TabsTrigger><TabsTrigger value="item">{t('By item')}</TabsTrigger></TabsList>
          </Tabs>
        )}
      </div>
      {tab === 'each' ? (
        <DataTable tableKey="inventory.outputs" columns={outCols} data={outRows} isLoading={each.isLoading} error={each.error} getRowId={(r) => `${r.adjustment_id}-${r.variant_id}-${r.quantity}`}
          initialHidden={['cost_gross', 'sale_gross']} searchPlaceholder={t('Item, number, description…')} exportName={t('stock-outputs')}
          empty={{ title: t('No outputs in these days'), description: t('Change the dates or the filters.') }}
          footer={(table) => {
            const cells: Record<string, string> = { date: t('Total'), cost_net: formatMoney(sum('cost_net')), cost_gross: formatMoney(sum('cost_gross')), sale_net: formatMoney(sum('sale_net')), sale_gross: formatMoney(sum('sale_gross')) }
            return <TableFooter><TableRow className="font-semibold hover:bg-transparent"><LeadCell />
              {table.getVisibleLeafColumns().map((c) => <TableCell key={c.id} className={cn(c.id.includes('_') && 'text-right tabular')}>{cells[c.id] ?? ''}</TableCell>)}</TableRow></TableFooter>
          }} />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('Sales without VAT')} value={formatMoney(wTot.sold, cur)} />
            <StatCard label={t('Thrown away, at the selling price')} value={formatMoney(wTot.waste, cur)} hint={t('{amount} at cost', { amount: formatMoney(wTot.cost, cur) })} />
            <StatCard label={t('% of sales, value')} value={pct(wTot.waste, wTot.sold)} tone={wTot.sold && wTot.waste / wTot.sold >= 0.03 ? 'destructive' : 'default'} />
            <StatCard label={t('Thrown away, kg')} value={formatQty(Math.round(wTot.kg * 1000) / 1000)} hint={t('{pct} of the kilograms sold', { pct: pct(wTot.kg, wTot.soldKg) })} />
          </div>
          <DataTable key={by} tableKey={`inventory.waste.${by}`} columns={wCols} data={wRows} isLoading={waste.isLoading} error={waste.error} getRowId={(r) => r.key}
            searchPlaceholder={t('Search')} exportName={t('thrown-away')} initialHidden={by === 'group' ? ['waste_qty'] : []}
            empty={{ title: t('Nothing thrown away in these days'), description: t('What is thrown away is scanned and weighed on the Zebra, under Warehouse floor → Thrown away.') }} />
        </>
      )}
    </>
  )
}
