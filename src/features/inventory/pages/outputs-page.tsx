import { CategoryPicks } from '@/features/inventory/components/category-picks'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Printer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { msg, t, td, tEnum } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { printTable } from '@/lib/print-table'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '../api'

type Out = { adjustment_id: string; number: string; date: string; reason: string; status: string; description: string | null; warehouse_id: string; warehouse: string
  variant_id: string; sku: string; name: string; uom: string | null; group_id: string | null; category_id: string | null; quantity: number
  cost_net: number; cost_gross: number; sale_net: number; sale_gross: number; by: string | null }

const OUT_REASONS: [string, string][] = [['waste', msg('Thrown away')], ['damage', msg('Damaged')], ['expiry', msg('Expired')], ['internal_use', msg('Used in the company')],
  ['loss', msg('Loss')], ['theft', msg('Theft')], ['count', msg('Stock count')], ['correction', msg('Correction')]]
const reasonLabel = (r: string) => t(OUT_REASONS.find(([k]) => k === r)?.[1] ?? r)

/**
 * Stock outputs (from the meeting with the staff): each one with its description and its value at
 * cost and at the selling price, with and without VAT; and what is thrown away against the sales of
 * the same group or item. Outputs never touch the sales margin.
 */
export function OutputsPage() {
  const [params] = useSearchParams()
  if (params.get('tab') === 'waste') return <Navigate to="/inventory/waste" replace />
  return <Outputs />
}

function Outputs() {
  const { companyId } = useCompany()
  const [from, setFrom] = React.useState(`${todayISO().slice(0, 8)}01`)
  const [to, setTo] = React.useState(todayISO())
  const [units, setUnits] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [reasons, setReasons] = React.useState<string[]>([])
  const whs = useWarehouses()
  const cats = useCategories()
  const catOptions = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const each = useQuery({
    queryKey: ['inv', companyId, 'outputs', from, to, units, reasons], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('stock_outputs', { p_company: companyId!, p: { from, to, units, reasons } as never })) as unknown as { rows: Out[] },
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
  // the outputs of the chosen days and filters, on paper: with the period, the filters and the totals
  const print = () => {
    const names = (ids: string[], all: { value: string; label: string }[]) => ids.map((id) => all.find((o) => o.value === id)?.label ?? '').filter(Boolean).join(', ')
    const filters = [
      `${formatDate(from)} – ${formatDate(to)}`,
      units.length ? `${t('Units|stores')}: ${names(units, (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name) })))}` : '',
      groups.length ? `${t('Categories')}: ${names(groups, catOptions)}` : '',
      reasons.length ? `${t('Reason')}: ${reasons.map(reasonLabel).join(', ')}` : '',
    ].filter(Boolean).join(' · ')
    printTable({
      title: t('Stock outputs|menu'), subtitle: filters,
      columns: [{ header: t('Date') }, { header: t('Number') }, { header: t('Reason') }, { header: t('Description') }, { header: t('Unit|store') }, { header: t('Item') },
        { header: t('Quantity'), format: 'qty' }, { header: t('Cost without VAT'), format: 'money' }, { header: t('Cost with VAT'), format: 'money' },
        { header: t('Selling price without VAT'), format: 'money' }, { header: t('Selling price with VAT'), format: 'money' }, { header: t('Recorded by') }],
      rows: outRows.map((r) => [formatDate(r.date), r.number, reasonLabel(r.reason), r.description ?? '', td(r.warehouse), `${r.name} · ${r.sku}`,
        `${formatQty(num(r.quantity))}${r.uom ? ` ${td(r.uom)}` : ''}`, num(r.cost_net), num(r.cost_gross), num(r.sale_net), num(r.sale_gross), r.by ?? '']),
      totals: [t('Total'), '', '', '', '', '', '', sum('cost_net'), sum('cost_gross'), sum('sale_net'), sum('sale_gross'), ''],
    })
  }


  return (
    <>
      <PageHeader title={t('Stock outputs|menu')}
        description={t('Goods thrown away, damaged, expired, used in the company, lost or stolen: each with its description and its value at cost and at the selling price. They lower the stock, never the sales margin.')}
        actions={<>
          <Button variant="outline" disabled={!outRows.length} onClick={print}><Printer /> {t('Print')}</Button>
          <Button variant="outline" asChild><Link to="/inventory/waste"><Trash2 /> {t('Fruit and vegetables thrown away')}</Link></Button></>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        <CategoryPicks value={groups} onChange={setGroups} />
        <MultiPick label={t('Reason')} value={reasons} onChange={setReasons} options={OUT_REASONS.map(([value, label]) => ({ value, label: t(label) }))} />
      </div>
        <DataTable tableKey="inventory.outputs" columns={outCols} data={outRows} isLoading={each.isLoading} error={each.error} getRowId={(r) => `${r.adjustment_id}-${r.variant_id}-${r.quantity}`}
          initialHidden={['cost_gross', 'sale_gross']} searchPlaceholder={t('Item, number, description…')} exportName={t('stock-outputs')}
          empty={{ title: t('No outputs in these days'), description: t('Change the dates or the filters.') }}
          footer={(table) => {
            const cells: Record<string, string> = { date: t('Total'), cost_net: formatMoney(sum('cost_net')), cost_gross: formatMoney(sum('cost_gross')), sale_net: formatMoney(sum('sale_net')), sale_gross: formatMoney(sum('sale_gross')) }
            return <TableFooter><TableRow className="font-semibold hover:bg-transparent"><LeadCell />
              {table.getVisibleLeafColumns().map((c) => <TableCell key={c.id} className={cn(c.id.includes('_') && 'text-right tabular')}>{cells[c.id] ?? ''}</TableCell>)}</TableRow></TableFooter>
          }} />
    </>
  )
}
