import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { GridExportMenu } from '@/components/export-menu'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, td } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, formatMonth, formatQty, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'

type Cell = { gross_sales: number; discounts: number; returns: number; net_sales: number; cogs: number; gross_profit: number; gross_margin_pct: number | null
  opex: number; other_expense: number; other_income: number; interest: number; net_profit: number; net_margin_pct: number | null
  internal: number; managerial_profit: number; nondeductible: number; tax_base: number }
type Data = { columns: { key: string; label: string }[]; cells: Record<string, Cell>; currency: string; by: 'month' | 'unit' }
type K = keyof Cell

// the lines of the report, in the order they are read; sign: how the line is shown (minus for what is taken away)
const LINES: { k: K; label: () => string; sign?: '−' | '+' | '='; strong?: boolean; pct?: boolean }[] = [
  { k: 'gross_sales', label: () => t('Gross sales (without VAT)') },
  { k: 'discounts', label: () => t('Discounts'), sign: '−' },
  { k: 'returns', label: () => t('Returns'), sign: '−' },
  { k: 'net_sales', label: () => t('Net sales'), sign: '=', strong: true },
  { k: 'cogs', label: () => t('Cost of goods sold'), sign: '−' },
  { k: 'gross_profit', label: () => t('Gross profit'), sign: '=', strong: true },
  { k: 'gross_margin_pct', label: () => t('Gross margin %'), pct: true },
  { k: 'opex', label: () => t('Operating expenses'), sign: '−' },
  { k: 'other_expense', label: () => t('Other expenses'), sign: '−' },
  { k: 'other_income', label: () => t('Other income'), sign: '+' },
  { k: 'interest', label: () => t('Loan interest'), sign: '−' },
  { k: 'net_profit', label: () => t('Net profit'), sign: '=', strong: true },
  { k: 'net_margin_pct', label: () => t('Net margin %'), pct: true },
]
// the two views of the same books (from the meeting with the staff): management adds the internal costs,
// tax adds back what the profit tax does not recognise
type View = 'management' | 'tax'
const VIEW_LINES: Record<View, typeof LINES> = {
  management: [
    { k: 'internal', label: () => t('Internal costs (management only)'), sign: '−' },
    { k: 'managerial_profit', label: () => t('Profit after internal costs'), sign: '=', strong: true },
  ],
  tax: [
    { k: 'nondeductible', label: () => t('Expenses not recognised for the profit tax'), sign: '+' },
    { k: 'tax_base', label: () => t('Profit for the profit tax'), sign: '=', strong: true },
  ],
}

function total(cells: Cell[]): Cell {
  const s = (k: K) => cells.reduce((a, c) => a + Number(c[k] ?? 0), 0)
  const net = s('net_sales'), gp = s('gross_profit'), np = s('net_profit')
  return { gross_sales: s('gross_sales'), discounts: s('discounts'), returns: s('returns'), net_sales: net, cogs: s('cogs'), gross_profit: gp,
    gross_margin_pct: net ? Math.round((gp / net) * 1000) / 10 : null, opex: s('opex'), other_expense: s('other_expense'), other_income: s('other_income'),
    interest: s('interest'), net_profit: np, net_margin_pct: net ? Math.round((np / net) * 1000) / 10 : null,
    internal: s('internal'), managerial_profit: s('managerial_profit'), nondeductible: s('nondeductible'), tax_base: s('tax_base') }
}

/** Profit by month or by unit: sales less discounts and returns, the cost of the goods, the expenses and the interest. */
export function ProfitPage() {
  const { companyId, company } = useCompany()
  const [params, setParams] = useSearchParams()
  const set = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const year = todayISO().slice(0, 4)
  const from = params.get('from') ?? `${year}-01-01`
  const to = params.get('to') ?? todayISO()
  const by = (params.get('by') === 'unit' ? 'unit' : 'month') as 'month' | 'unit'
  const shared = params.get('shared') === 'split' ? 'split' : 'apart'
  const view = (params.get('view') === 'tax' ? 'tax' : 'management') as View
  const lines = [...LINES, ...VIEW_LINES[view]]
  const [units, setUnits] = React.useState<string[]>([])
  const whs = useWarehouses()
  const q = useQuery({
    queryKey: ['profit', companyId, from, to, by, shared, units], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('profit_report', { p_company: companyId!, p: { from, to, by, shared, units } as never })) as unknown as Data,
  })
  const d = q.data
  const colLabel = (c: { key: string; label: string }) => (d?.by === 'month' ? formatMonth(c.key) : c.key === 'shared' ? t('Shared') : c.key === 'none' ? t('No unit') : td(c.label))
  const cols = d?.columns ?? []
  const tot = d ? total(cols.map((c) => d.cells[c.key]!).filter(Boolean)) : null
  const show = (c: Cell | null | undefined, l: (typeof LINES)[number]) => {
    const v = c?.[l.k]
    if (v == null) return '—'
    return l.pct ? `${formatQty(Number(v))}%` : formatMoney(Number(v))
  }
  const presets = [
    { label: t('This year'), f: `${year}-01-01`, t: todayISO() },
    { label: t('Last year'), f: `${Number(year) - 1}-01-01`, t: `${Number(year) - 1}-12-31` },
    { label: t('This month'), f: `${todayISO().slice(0, 8)}01`, t: todayISO() },
  ]

  return (
    <>
      <PageHeader back={{ href: '/reports', label: t('Reports') }} title={t('Profit report')}
        description={t('Sales and their cost come from the documents; expenses, other income and loan interest from the books. Without VAT, in {currency}.', { currency: d?.currency ?? company?.base_currency ?? '' })}
        actions={d && <GridExportMenu name={t('profit-report')} title={t('Profit report')} subtitle={`${from} – ${to}`}
          grid={() => [[t('Line'), ...cols.map(colLabel), ...(cols.length > 1 ? [t('Total')] : [])],
            ...lines.map((l) => [`${l.sign ? `${l.sign} ` : ''}${l.label()}`, ...cols.map((c) => { const v = d.cells[c.key]?.[l.k]; return v == null ? null : Number(v) }), ...(cols.length > 1 ? [tot?.[l.k] == null ? null : Number(tot[l.k])] : [])])]} />} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label><Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => set('from', e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label><Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => set('to', e.target.value)} /></div>
        <div className="flex gap-1">{presets.map((p) => (
          <button key={p.label} type="button" onClick={() => { set('from', p.f); set('to', p.t) }}
            className={cn('h-9 rounded-md border px-2.5 text-[13px] hover:bg-secondary', from === p.f && to === p.t && 'border-primary bg-primary/10 text-primary')}>{p.label}</button>
        ))}</div>
        <Tabs value={view} onValueChange={(v) => set('view', v === 'management' ? null : v)}>
          <TabsList><TabsTrigger value="management">{t('Management view')}</TabsTrigger><TabsTrigger value="tax">{t('Tax view')}</TabsTrigger></TabsList>
        </Tabs>
        <Tabs value={by} onValueChange={(v) => set('by', v)}>
          <TabsList><TabsTrigger value="month">{t('By month')}</TabsTrigger><TabsTrigger value="unit">{t('By unit')}</TabsTrigger></TabsList>
        </Tabs>
        <MultiPick label={t('Units|stores')} value={units} onChange={setUnits} options={(whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))} />
        {by === 'unit' && (
          <Tabs value={shared} onValueChange={(v) => set('shared', v)}>
            <TabsList><TabsTrigger value="apart">{t('Shared expenses apart')}</TabsTrigger><TabsTrigger value="split">{t('Split by sales')}</TabsTrigger></TabsList>
          </Tabs>
        )}
      </div>
      {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : d && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[220px]">{t('Line')}</TableHead>
              {cols.map((c) => <TableHead key={c.key} className="text-right">{colLabel(c)}</TableHead>)}
              {cols.length > 1 && <TableHead className="text-right">{t('Total')}</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.k} className={cn('hover:bg-transparent', l.strong && 'bg-muted/40 font-semibold', l.pct && 'text-muted-foreground')}>
                  <TableCell className={cn(l.pct && 'pl-8 text-[12.5px]')}>{l.sign && <span className="mr-1.5 inline-block w-3 text-muted-foreground">{l.sign}</span>}{l.label()}</TableCell>
                  {cols.map((c) => { const v = d.cells[c.key]?.[l.k]; return (
                    <TableCell key={c.key} className={cn('text-right tabular', ['net_profit', 'managerial_profit', 'tax_base'].includes(l.k) && v != null && Number(v) < 0 && 'text-destructive')}>{show(d.cells[c.key], l)}</TableCell>
                  ) })}
                  {cols.length > 1 && <TableCell className={cn('text-right tabular font-semibold', ['net_profit', 'managerial_profit', 'tax_base'].includes(l.k) && tot && Number(tot[l.k]) < 0 && 'text-destructive')}>{show(tot, l)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="mt-2 text-[12.5px] text-muted-foreground">{view === 'management'
        ? <>{t('Management view: every real cost in the books, then the internal costs that no one is paid (the rent of a shop the company owns, a share of the office).')} <Link className="text-primary hover:underline" to="/finance/internal-costs">{t('Internal costs|menu')}</Link></>
        : <>{t('Tax view: the same books, plus the expenses the profit tax does not recognise (by their account or as the document says). Before the year\'s losses and adjustments.')} <Link className="text-primary hover:underline" to="/tax/income-tax">{t('Corporate income tax')}</Link></>}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{by === 'unit'
        ? t('An expense belongs to a unit when it is booked to a cost centre with the unit\'s code; the rest is shared. Loan interest: the expense accounts whose name says interest.')
        : t('With units chosen, only the expenses booked to their cost centres are counted. Loan interest: the expense accounts whose name says interest.')}</p>
    </>
  )
}
