import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '../api'

type By = 'group' | 'item' | 'unit' | 'day'
type Base = 'sold' | 'in'
type Row = { key: string; label: string | null; code: string | null; unit_of_qty: string | null; comparable: boolean
  sold_qty: number; sold_net: number; in_qty: number; in_cost: number; waste_qty: number; waste_cost: number; waste_sale: number
  pct_qty_sold: number | null; pct_value_sold: number | null; pct_qty_in: number | null; pct_value_in: number | null }
type Totals = { sold_net: number; in_cost: number; waste_cost: number; waste_sale: number; sold_kg: number; in_kg: number; waste_kg: number
  pct_qty_sold: number | null; pct_value_sold: number | null; pct_qty_in: number | null; pct_value_in: number | null }
type Report = { rows: Row[]; totals: Totals; fresh_groups: string[] }

const REASONS: [string, string][] = [['waste', msg('Thrown away')], ['damage', msg('Damaged')], ['expiry', msg('Expired')]]
const BY: [By, string][] = [['group', msg('By group')], ['item', msg('By item')], ['unit', msg('By store')], ['day', msg('By day')]]
const NAME: Record<By, string> = { group: msg('Group'), item: msg('Item'), unit: msg('Unit|store'), day: msg('Day') }
const pctText = (v: number | null | undefined) => (v == null ? '—' : `${formatQty(Math.round(num(v) * 10) / 10)}%`)
/** above 3 % the waste is worth looking at, above 5 % it is too much */
const pctTone = (v: number | null | undefined) => (v == null ? '' : num(v) >= 5 ? 'text-destructive' : num(v) >= 3 ? 'text-warning' : '')

/**
 * Thrown away (#27): fruit and vegetables that went off on the shelf, weighed and recorded on the Zebra.
 * How much, in quantity and in value, and what share it is of what was sold (or of what came in), for the
 * days, stores, groups and items chosen.
 */
export function WasteReportPage() {
  const { companyId, company } = useCompany()
  const [from, setFrom] = React.useState(`${todayISO().slice(0, 8)}01`)
  const [to, setTo] = React.useState(todayISO())
  const [units, setUnits] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [reasons, setReasons] = React.useState<string[]>(['waste', 'damage', 'expiry'])
  const [by, setBy] = React.useState<By>('item')
  const [base, setBase] = React.useState<Base>('sold')
  const whs = useWarehouses()
  const cats = useCategories()
  const catOptions = React.useMemo(() => {
    const all = cats.data ?? []
    return all.filter((c) => !c.parent_id).flatMap((r) => [{ value: r.id, label: td(r.name) }, ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), indent: true }))])
  }, [cats.data])
  const cur = company?.base_currency ?? ''
  const q = useQuery({
    queryKey: ['inv', companyId, 'waste-report', from, to, units, groups, reasons, by], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('waste_report', { p_company: companyId!, p: { from, to, units, groups, reasons, by, fresh_only: true } as never })) as unknown as Report,
  })
  const rows = q.data?.rows ?? []
  const tot = q.data?.totals
  const fresh = (q.data?.fresh_groups ?? []).map((id) => td((cats.data ?? []).find((c) => c.id === id)?.name ?? '')).filter(Boolean)

  const qtyLabel = base === 'sold' ? t('Sold, quantity') : t('Came in, quantity')
  const valLabel = base === 'sold' ? t('Sold, without VAT') : t('Came in, at cost')
  const qtyCell = (v: number, r: Row) => <span className="tabular">{r.comparable ? formatQty(num(v), r.unit_of_qty) : '—'}</span>
  const cols = React.useMemo<ColumnDef<Row>[]>(() => [
    { id: 'label', accessorFn: (r) => r.label ?? t('No group'), header: ({ column }) => <ColumnHeader column={column} title={t(NAME[by])} />,
      meta: { label: t(NAME[by]) },
      cell: ({ row: { original: r } }) => <span className="font-medium">{by === 'day' ? formatDate(r.key) : td(r.label ?? t('No group'))}{r.code && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">{r.code}</span>}</span> },
    { id: 'base_qty', accessorFn: (r) => (base === 'sold' ? r.sold_qty : r.in_qty), header: ({ column }) => <ColumnHeader column={column} title={qtyLabel} />, meta: { label: qtyLabel, align: 'right' },
      cell: ({ row: { original: r } }) => qtyCell(base === 'sold' ? r.sold_qty : r.in_qty, r) },
    { accessorKey: 'waste_qty', header: ({ column }) => <ColumnHeader column={column} title={t('Thrown away, quantity')} />, meta: { label: t('Thrown away, quantity'), align: 'right' },
      cell: ({ row: { original: r } }) => qtyCell(r.waste_qty, r) },
    { id: 'pct_qty', accessorFn: (r) => (base === 'sold' ? r.pct_qty_sold : r.pct_qty_in), header: ({ column }) => <ColumnHeader column={column} title={t('% in quantity')} />, meta: { label: t('% in quantity'), align: 'right' },
      cell: ({ row: { original: r } }) => { const v = base === 'sold' ? r.pct_qty_sold : r.pct_qty_in; return <span className={cn('font-semibold tabular', pctTone(v))}>{r.comparable ? pctText(v) : '—'}</span> } },
    { id: 'base_value', accessorFn: (r) => (base === 'sold' ? r.sold_net : r.in_cost), header: ({ column }) => <ColumnHeader column={column} title={valLabel} />, meta: { label: valLabel, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'waste_sale', header: ({ column }) => <ColumnHeader column={column} title={t('Thrown away, at the selling price')} />, meta: { label: t('Thrown away, at the selling price'), align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { accessorKey: 'waste_cost', header: ({ column }) => <ColumnHeader column={column} title={t('Thrown away, at cost')} />, meta: { label: t('Thrown away, at cost'), align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{formatMoney(num(getValue()))}</span> },
    { id: 'pct_value', accessorFn: (r) => (base === 'sold' ? r.pct_value_sold : r.pct_value_in), header: ({ column }) => <ColumnHeader column={column} title={t('% in value')} />, meta: { label: t('% in value'), align: 'right' },
      cell: ({ getValue }) => { const v = getValue() as number | null; return <span className={cn('font-semibold tabular', pctTone(v))}>{pctText(v)}</span> } },
  ], [by, base]) // eslint-disable-line react-hooks/exhaustive-deps

  const pq = base === 'sold' ? tot?.pct_qty_sold : tot?.pct_qty_in
  const pv = base === 'sold' ? tot?.pct_value_sold : tot?.pct_value_in
  return (
    <>
      <PageHeader title={t('Fruit and vegetables thrown away')}
        description={t('What went off on the shelf and was thrown away, weighed on the Zebra: how much in quantity and in value, and what share it is of what was sold or of what came in.')}
        actions={<Button variant="outline" asChild><Link to="/wms/waste"><Trash2 /> {t('Record on the Zebra')}</Link></Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        <MultiPick label={t('Groups')} value={groups} onChange={setGroups} options={catOptions} />
        <MultiPick label={t('Reason')} value={reasons} onChange={setReasons} options={REASONS.map(([value, label]) => ({ value, label: t(label) }))} />
        <div className="grid gap-1"><Label className="text-xs">{t('Share of')}</Label>
          <Tabs value={base} onValueChange={(v) => setBase(v as Base)}><TabsList><TabsTrigger value="sold">{t('What was sold')}</TabsTrigger><TabsTrigger value="in">{t('What came in')}</TabsTrigger></TabsList></Tabs></div>
        <div className="grid gap-1"><Label className="text-xs">{t('Show')}</Label>
          <Tabs value={by} onValueChange={(v) => setBy(v as By)}><TabsList>{BY.map(([k, l]) => <TabsTrigger key={k} value={k}>{t(l)}</TabsTrigger>)}</TabsList></Tabs></div>
      </div>
      {!groups.length && (
        <p className="mb-3 text-[13px] text-muted-foreground">{fresh.length
          ? t('Groups that go off quickly: {groups}. Choose other groups above to look at them instead.', { groups: fresh.join(', ') })
          : t('No group is marked "goes off quickly" yet: mark fruit and vegetables under Stock → Setup → Categories, or choose the groups above.')}</p>
      )}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Thrown away, kg')} value={formatQty(Math.round(num(tot?.waste_kg) * 1000) / 1000, 'kg')}
          hint={base === 'sold' ? t('of {kg} kg sold', { kg: formatQty(Math.round(num(tot?.sold_kg))) }) : t('of {kg} kg that came in', { kg: formatQty(Math.round(num(tot?.in_kg))) })} />
        <StatCard label={t('% in quantity')} value={pctText(pq)} tone={num(pq) >= 5 ? 'destructive' : 'default'} />
        <StatCard label={t('Thrown away, at the selling price')} value={formatMoney(num(tot?.waste_sale), cur)} hint={t('{amount} at cost', { amount: formatMoney(num(tot?.waste_cost), cur) })} />
        <StatCard label={t('% in value')} value={pctText(pv)} tone={num(pv) >= 5 ? 'destructive' : 'default'}
          hint={base === 'sold' ? t('of {amount} sold without VAT', { amount: formatMoney(num(tot?.sold_net), cur) }) : t('of {amount} that came in, at cost', { amount: formatMoney(num(tot?.in_cost), cur) })} />
      </div>
      <DataTable key={`${by}-${base}`} tableKey={`inventory.waste-report.${by}`} columns={cols} data={rows} isLoading={q.isLoading} error={q.error} getRowId={(r) => r.key}
        searchPlaceholder={t('Search')} exportName={t('thrown-away')}
        empty={{ title: t('Nothing in these days'), description: t('What is thrown away is weighed and recorded on the Zebra, under Warehouse floor → Thrown away.') }}
        footer={(table) => {
          if (!tot || rows.length < 2) return null
          const cells: Record<string, React.ReactNode> = {
            label: t('Total'), base_qty: formatQty(Math.round(num(base === 'sold' ? tot.sold_kg : tot.in_kg)), 'kg'), waste_qty: formatQty(Math.round(num(tot.waste_kg) * 1000) / 1000, 'kg'),
            pct_qty: <span className={pctTone(pq)}>{pctText(pq)}</span>, base_value: formatMoney(num(base === 'sold' ? tot.sold_net : tot.in_cost)),
            waste_sale: formatMoney(num(tot.waste_sale)), waste_cost: formatMoney(num(tot.waste_cost)), pct_value: <span className={pctTone(pv)}>{pctText(pv)}</span> }
          return <TableFooter><TableRow className="font-semibold hover:bg-transparent"><LeadCell />
            {table.getVisibleLeafColumns().map((c) => <TableCell key={c.id} className={cn(c.id !== 'label' && 'text-right tabular')}>{cells[c.id] ?? ''}</TableCell>)}</TableRow></TableFooter>
        }} />
      <p className="mt-2 text-xs text-muted-foreground">{t('The quantity is counted in kilograms; an item sold by the piece is counted in kilograms when its weight is on its card, else only in the item view. The value of what is thrown away is compared with the sales at the selling price, and with what came in at cost.')}</p>
    </>
  )
}
