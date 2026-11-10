import { CategoryPicks } from '@/features/inventory/components/category-picks'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatMonth, formatDate, formatQty, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useActiveVendors } from '@/features/procurement/api'

type M = { qty: number; net: number; vat: number; gross: number; cost: number; margin: number; margin_pct: number | null; discount: number }
type Row = { key: string | null; label: string | null; code: string | null; a: M | null; b: M | null }
type By = 'unit' | 'group' | 'category' | 'supplier' | 'item' | 'customer' | 'month' | 'day'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const shiftYear = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return iso(d) }
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null)

/** Sales and purchases from every side: by unit, group, supplier, item, customer or day, against another period. */
export function AnalysisPage() {
  const { companyId, company } = useCompany()
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') === 'purchases' ? 'purchases' : 'sales') as 'sales' | 'purchases'
  const set = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const first = `${todayISO().slice(0, 8)}01`
  const from = params.get('from') ?? first
  const to = params.get('to') ?? todayISO()
  const cmp = params.get('cmp') ?? 'year'          // none | year | prev | custom
  const by = (params.get('by') ?? 'group') as By
  const [units, setUnits] = React.useState<string[]>([])
  const [sups, setSups] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5)
  const cmpFrom = cmp === 'year' ? shiftYear(from, -1) : cmp === 'prev' ? iso(new Date(Date.parse(from) - (days + 1) * 864e5)) : cmp === 'custom' ? params.get('cfrom') ?? shiftYear(from, -1) : null
  const cmpTo = cmp === 'year' ? shiftYear(to, -1) : cmp === 'prev' ? iso(new Date(Date.parse(from) - 864e5)) : cmp === 'custom' ? params.get('cto') ?? shiftYear(to, -1) : null
  const comparing = !!cmpFrom

  const whs = useWarehouses()
  const vendors = useActiveVendors()
  const q = useQuery({
    queryKey: ['analysis', companyId, kind, from, to, cmpFrom, cmpTo, by, units, sups, groups], enabled: !!companyId && !!from && !!to,
    queryFn: async () => unwrap(await supabase.rpc('trade_analysis', { p_company: companyId!, p: { kind, from, to, cmp_from: cmpFrom, cmp_to: cmpTo, group_by: by, units, suppliers: sups, groups, items: [] } as never })) as unknown as { rows: Row[]; currency: string },
  })
  const cur = q.data?.currency
  const sales = kind === 'sales'

  const labelOf = React.useCallback((r: Row) => {
    if (by === 'month') return r.key ? formatMonth(r.key) : '—'
    if (by === 'day') return r.key ? formatDate(r.key) : '—'
    return r.label ? td(r.label) : by === 'supplier' ? t('No supplier') : by === 'customer' ? t('Retail customers') : by === 'unit' ? t('No unit') : t('No group')
  }, [by])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const money = (id: string, title: string, get: (r: Row) => number | null | undefined, opts?: { strong?: boolean }): ColumnDef<Row> => ({
      id, accessorFn: (r) => get(r) ?? 0, meta: { label: title, align: 'right' },
      header: ({ column }) => <ColumnHeader column={column} title={title} />,
      cell: ({ row }) => { const v = get(row.original); return v == null ? <span className="text-muted-foreground">—</span> : <span className={cn(opts?.strong && 'font-medium')}>{formatMoney(v)}</span> },
    })
    const delta = (id: string, title: string, a: (r: Row) => number | undefined, b: (r: Row) => number | undefined): ColumnDef<Row> => ({
      id, accessorFn: (r) => pct(a(r) ?? 0, b(r) ?? 0) ?? 0, meta: { label: title, align: 'right' },
      header: ({ column }) => <ColumnHeader column={column} title={title} />,
      cell: ({ row }) => { const d = pct(a(row.original) ?? 0, b(row.original) ?? 0); return d == null ? <span className="text-muted-foreground">—</span> : <span className={cn(d > 0 ? 'text-success' : d < 0 ? 'text-destructive' : '')}>{d > 0 ? '+' : ''}{formatQty(d)}%</span> },
    })
    const cols: ColumnDef<Row>[] = [
      { id: 'label', accessorFn: (r) => labelOf(r), meta: { label: t('Name') }, header: ({ column }) => <ColumnHeader column={column} title={byLabel(by)} />,
        cell: ({ row }) => <span className="font-medium">{labelOf(row.original)}{row.original.code && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{row.original.code}</span>}</span> },
      { id: 'qty', accessorFn: (r) => r.a?.qty ?? 0, meta: { label: t('Quantity'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Quantity')} />, cell: ({ row }) => formatQty(row.original.a?.qty ?? 0) },
    ]
    if (comparing) cols.push({ id: 'qty_b', accessorFn: (r) => r.b?.qty ?? 0, meta: { label: t('Quantity, compared'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Quantity, compared')} />, cell: ({ row }) => <span className="text-muted-foreground">{formatQty(row.original.b?.qty ?? 0)}</span> })
    cols.push(money('net', t('Value without VAT'), (r) => r.a?.net, { strong: true }))
    if (comparing) { cols.push(money('net_b', t('Without VAT, compared'), (r) => r.b?.net)); cols.push(delta('net_d', t('Change|difference'), (r) => r.a?.net, (r) => r.b?.net)) }
    cols.push(money('vat', t('VAT'), (r) => r.a?.vat))
    cols.push(money('gross', t('Value with VAT'), (r) => r.a?.gross))
    if (comparing) cols.push(money('gross_b', t('With VAT, compared'), (r) => r.b?.gross))
    if (sales) {
      cols.push(money('cost', t('Cost'), (r) => r.a?.cost))
      cols.push(money('margin', t('Margin'), (r) => r.a?.margin, { strong: true }))
      cols.push({ id: 'margin_pct', accessorFn: (r) => r.a?.margin_pct ?? 0, meta: { label: t('Margin %'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Margin %')} />, cell: ({ row }) => row.original.a?.margin_pct == null ? '—' : `${formatQty(row.original.a.margin_pct)}%` })
      if (comparing) {
        cols.push(money('margin_b', t('Margin, compared'), (r) => r.b?.margin))
        cols.push({ id: 'margin_pct_b', accessorFn: (r) => r.b?.margin_pct ?? 0, meta: { label: t('Margin %, compared'), align: 'right' }, header: ({ column }) => <ColumnHeader column={column} title={t('Margin %, compared')} />, cell: ({ row }) => <span className="text-muted-foreground">{row.original.b?.margin_pct == null ? '—' : `${formatQty(row.original.b.margin_pct)}%`}</span> })
      }
      cols.push(money('discount', t('Discounts'), (r) => r.a?.discount))
    }
    return cols
  }, [by, comparing, sales, labelOf])


  return (
    <>
      <PageHeader back={{ href: '/reports', label: t('Reports') }} title={t('Sales and purchase analysis')}
        description={t('By unit, group, sub-group, supplier, item, customer or day, against another period. Values in {currency}; returns and credit notes count as minus.', { currency: cur ?? company?.base_currency ?? '' })} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Tabs value={kind} onValueChange={(v) => { set('kind', v); if (v === 'purchases' && by === 'customer') set('by', 'group') }}>
          <TabsList><TabsTrigger value="sales">{t('Sales')}</TabsTrigger><TabsTrigger value="purchases">{t('Purchases')}</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => set('from', e.target.value || first)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => set('to', e.target.value || todayISO())} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('Compare with')}</Label>
          <Select value={cmp} onValueChange={(v) => set('cmp', v)}>
            <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="year">{t('The same days a year before')}</SelectItem>
              <SelectItem value="prev">{t('The period just before')}</SelectItem>
              <SelectItem value="custom">{t('Other dates')}</SelectItem>
              <SelectItem value="none">{t('No comparison')}</SelectItem>
            </SelectContent>
          </Select></div>
        {cmp === 'custom' && <>
          <div className="grid gap-1"><Label className="text-xs">{t('Compared from')}</Label><Input type="date" className="h-9 w-40" value={cmpFrom ?? ''} onChange={(e) => set('cfrom', e.target.value)} /></div>
          <div className="grid gap-1"><Label className="text-xs">{t('Compared to')}</Label><Input type="date" className="h-9 w-40" value={cmpTo ?? ''} onChange={(e) => set('cto', e.target.value)} /></div>
        </>}
        <div className="grid gap-1"><Label className="text-xs">{t('By')}</Label>
          <Select value={by} onValueChange={(v) => set('by', v)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['group', 'category', 'unit', 'supplier', 'item', ...(sales ? ['customer'] : []), 'month', 'day'] as By[]).map((b) => <SelectItem key={b} value={b}>{byLabel(b)}</SelectItem>)}
            </SelectContent>
          </Select></div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        <MultiPick label={t('Suppliers')} value={sups} onChange={setSups} options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.tax_number ?? undefined }))} />
        <CategoryPicks value={groups} onChange={setGroups} />
        {comparing && cmpFrom && cmpTo && <span className="text-[12.5px] text-muted-foreground">{t('{a} against {b}', { a: `${formatDate(from)} – ${formatDate(to)}`, b: `${formatDate(cmpFrom)} – ${formatDate(cmpTo)}` })}</span>}
      </div>
      <DataTable
        key={`${kind}-${by}-${comparing}`}
        tableKey={`reports.analysis.${kind}`}
        columns={columns}
        initialHidden={['vat', 'gross_b', 'margin_b', 'margin_pct_b']}
        data={q.data?.rows}
        isLoading={q.isLoading}
        error={q.error}
        getRowId={(r) => r.key ?? 'none'}
        initialSorting={[{ id: 'net', desc: true }]}
        searchPlaceholder={t('Search')}
        exportName={kind === 'sales' ? t('sales-analysis') : t('purchase-analysis')}
        empty={{ title: t('Nothing in this period'), description: t('Change the dates or the filters.') }}
        footer={(table) => {
          const rows = table.getFilteredRowModel().rows.map((r) => r.original)
          const tot = (f: (m: M) => number, w: 'a' | 'b' = 'a') => rows.reduce((s, r) => s + (r[w] ? f(r[w]!) : 0), 0)
          const netA = tot((m) => m.net), netB = tot((m) => m.net, 'b'), marA = tot((m) => m.margin), marB = tot((m) => m.margin, 'b')
          const cells: Record<string, React.ReactNode> = {
            label: t('Total'), qty: formatQty(tot((m) => m.qty)), qty_b: formatQty(tot((m) => m.qty, 'b')), net: formatMoney(netA), net_b: formatMoney(netB),
            net_d: pct(netA, netB) == null ? '—' : `${pct(netA, netB)! > 0 ? '+' : ''}${formatQty(pct(netA, netB)!)}%`, vat: formatMoney(tot((m) => m.vat)),
            gross: formatMoney(tot((m) => m.gross)), gross_b: formatMoney(tot((m) => m.gross, 'b')), cost: formatMoney(tot((m) => m.cost)), margin: formatMoney(marA),
            margin_pct: netA ? `${formatQty(Math.round((marA / netA) * 1000) / 10)}%` : '—', margin_b: formatMoney(marB),
            margin_pct_b: netB ? `${formatQty(Math.round((marB / netB) * 1000) / 10)}%` : '—', discount: formatMoney(tot((m) => m.discount)),
          }
          return (
            <TableFooter>
              <TableRow className="hover:bg-transparent font-semibold">
                <LeadCell />
                {table.getVisibleLeafColumns().map((c) => <TableCell key={c.id} className={cn(c.id !== 'label' && c.id !== '_select' && 'text-right tabular')}>{cells[c.id] ?? ''}</TableCell>)}
              </TableRow>
            </TableFooter>
          )
        }}
      />
    </>
  )
}

function byLabel(b: By) {
  return ({ unit: t('Unit'), group: t('Group'), category: t('Sub-group'), supplier: t('Supplier'), item: t('Item'), customer: t('Customer'), month: t('Month'), day: t('Day') } as Record<By, string>)[b]
}
