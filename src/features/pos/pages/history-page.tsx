import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Play, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveUnit } from '@/app/active-unit'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, LeadCell } from '@/components/data-table/data-table'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableCell, TableFooter, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, td } from '@/i18n'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, formatQty, num } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useMembers } from '@/features/sales/api'
import { SavedFilters } from '@/features/reports/components/saved-filters'
import { periodDates } from '@/features/reports/pages/detail-page'
import { useRegisters } from '../api'
import { reviewStatusLabel, reviewStatusTone } from './review-page'

/**
 * "Historiku i arkave": every shift, each till and each cashier over a period; the cash that went in and
 * out of the drawers, the items taken off sales, the differences month by month, the busy hours and the
 * Z-reports. A manager sees everyone; a cashier her own.
 */
type Row = Record<string, unknown>
type ColType = 'text' | 'date' | 'time' | 'money' | 'qty' | 'count' | 'hours' | 'status' | 'kind' | 'diff' | 'bar'
type Col = { id: string; label: string; type: ColType; hidden?: boolean; strong?: boolean; sum?: boolean }
type Filters = { report: string; period: string; from: string; to: string; registers: string[]; people: string[]; units: string[] }

const REPORTS = [
  { value: 'shifts', label: msg('Shifts') }, { value: 'cashiers', label: msg('By cashier') }, { value: 'tills', label: msg('By till') },
  { value: 'movements', label: msg('Cash in and out') }, { value: 'voids', label: msg('Items taken off') }, { value: 'differences', label: msg('Differences by month') },
  { value: 'hours', label: msg('By hour of the day') }, { value: 'handovers', label: msg('Waiters\' handovers') }, { value: 'z_archive', label: msg('Z-reports') },
]
const PERIODS = [
  { value: 'today', label: msg('Today') }, { value: 'yesterday', label: msg('Yesterday') }, { value: 'this_week', label: msg('This week') },
  { value: 'last_week', label: msg('Last week') }, { value: 'this_month', label: msg('This month') }, { value: 'last_month', label: msg('Last month') },
  { value: 'this_quarter', label: msg('This quarter') }, { value: 'this_year', label: msg('This year') }, { value: 'custom', label: msg('Other dates') },
]
const KIND: Record<string, string> = {
  supplier: msg('Paid to a supplier'), expense: msg('Expense paid'), voucher: msg('Gift voucher sold'), waiter: msg('Waiter\'s handover differs'), other: msg('Other'),
  void_line: msg('Line taken off'), void_qty: msg('Quantity lowered'), void_sale: msg('Sale cleared'),
  cash_in: msg('Cash in'), cash_out: msg('Cash out'),
}

function columnsOf(report: string): Col[] {
  const money = (id: string, label: string, extra: Partial<Col> = {}): Col => ({ id, label, type: 'money', sum: true, ...extra })
  const count = (id: string, label: string, extra: Partial<Col> = {}): Col => ({ id, label, type: 'count', sum: true, ...extra })
  switch (report) {
    case 'shifts': return [
      { id: 'number', label: msg('Shift'), type: 'text', strong: true }, { id: 'register', label: msg('Till'), type: 'text' }, { id: 'unit', label: msg('Unit|store'), type: 'text', hidden: true },
      { id: 'opened_at', label: msg('Opened'), type: 'time' }, { id: 'closed_at', label: msg('Closed|time'), type: 'time' }, { id: 'hours', label: msg('Hours'), type: 'hours', sum: true },
      { id: 'opened_by', label: msg('Cashier'), type: 'text' }, { id: 'closed_by', label: msg('Closed by'), type: 'text', hidden: true }, { id: 'reviewed_by', label: msg('Reconciled by'), type: 'text', hidden: true },
      count('receipts', msg('Receipts')), money('sales', msg('Sales (with VAT)'), { strong: true }), count('refunds_n', msg('Refunds'), { hidden: true }), money('refunds', msg('Refunded'), { hidden: true }),
      money('net_sales', msg('Net of refunds'), { hidden: true }), { id: 'average', label: msg('Average receipt'), type: 'money', hidden: true }, money('discounts', msg('Discounts'), { hidden: true }),
      money('cash', msg('Cash'), { hidden: true }), money('card', msg('Card'), { hidden: true }), money('other_pay', msg('Other payments'), { hidden: true }),
      money('cash_in', msg('Cash in'), { hidden: true }), money('cash_out', msg('Cash out'), { hidden: true }),
      count('voids_n', msg('Items taken off')), money('voids', msg('Value taken off'), { hidden: true }), count('voids_unconfirmed', msg('Without a manager'), { hidden: true }),
      count('offline', msg('Sold without internet'), { hidden: true }),
      money('opening', msg('Opening cash'), { hidden: true, sum: false }), money('expected', msg('Expected in drawer'), { sum: false }), money('counted', msg('Counted'), { sum: false }),
      { id: 'difference', label: msg('Difference'), type: 'diff', sum: true, strong: true }, { id: 'review_status', label: msg('State'), type: 'status' },
    ]
    case 'cashiers': case 'tills': return [
      { id: 'name', label: report === 'cashiers' ? msg('Cashier') : msg('Till'), type: 'text', strong: true },
      ...(report === 'tills' ? [{ id: 'unit', label: msg('Unit|store'), type: 'text' } as Col] : []),
      count('shifts', msg('Shifts')), { id: 'hours', label: msg('Hours'), type: 'hours', sum: true },
      count('receipts', msg('Receipts')), money('sales', msg('Sales (with VAT)'), { strong: true }), { id: 'average', label: msg('Average receipt'), type: 'money' },
      { id: 'per_hour', label: msg('Receipts an hour'), type: 'qty' },
      count('refunds_n', msg('Refunds')), money('refunds', msg('Refunded')), money('net_sales', msg('Net of refunds'), { hidden: true }), money('discounts', msg('Discounts')),
      count('voids_n', msg('Items taken off')), money('voids', msg('Value taken off'), { hidden: true }), count('voids_unconfirmed', msg('Without a manager')),
      money('cash_in', msg('Cash in'), { hidden: true }), money('cash_out', msg('Cash out'), { hidden: true }),
      count('off', msg('Shifts off')), { id: 'short', label: msg('Short|cash'), type: 'diff', sum: true }, { id: 'over', label: msg('Over|cash'), type: 'diff', sum: true },
      { id: 'difference', label: msg('Difference'), type: 'diff', sum: true, strong: true },
    ]
    case 'movements': return [
      { id: 'at', label: msg('When'), type: 'time' }, { id: 'register', label: msg('Till'), type: 'text' }, { id: 'shift', label: msg('Shift'), type: 'text' },
      { id: 'person', label: msg('By'), type: 'text' }, { id: 'kind', label: msg('Kind|cash move'), type: 'kind' }, { id: 'partner', label: msg('Partner'), type: 'text' },
      { id: 'document_no', label: msg('Document'), type: 'text' }, { id: 'reason', label: msg('Reason'), type: 'text' },
      { id: 'amount', label: msg('Amount'), type: 'diff', sum: true, strong: true }, { id: 'approved_by', label: msg('Confirmed by'), type: 'text' },
    ]
    case 'voids': return [
      { id: 'at', label: msg('When'), type: 'time' }, { id: 'register', label: msg('Till'), type: 'text' }, { id: 'shift', label: msg('Shift'), type: 'text' },
      { id: 'person', label: msg('Cashier'), type: 'text' }, { id: 'kind', label: msg('Kind|cash move'), type: 'kind' }, { id: 'description', label: msg('Item'), type: 'text', strong: true },
      { id: 'quantity', label: msg('Quantity'), type: 'qty', sum: true }, money('amount', msg('Value')), { id: 'approved_by', label: msg('Confirmed by'), type: 'text' },
    ]
    case 'differences': return [
      { id: 'month', label: msg('Month'), type: 'text' }, { id: 'name', label: msg('Counted by'), type: 'text', strong: true }, count('shifts', msg('Shifts')), count('off', msg('Shifts off')),
      { id: 'short', label: msg('Short|cash'), type: 'diff', sum: true }, { id: 'over', label: msg('Over|cash'), type: 'diff', sum: true },
      { id: 'difference', label: msg('Difference'), type: 'diff', sum: true, strong: true }, { id: 'largest_short', label: msg('Largest short'), type: 'diff' },
    ]
    case 'handovers': return [
      { id: 'at', label: msg('When'), type: 'time' }, { id: 'register', label: msg('Till'), type: 'text' }, { id: 'shift', label: msg('Shift'), type: 'text' },
      { id: 'name', label: msg('Waiter'), type: 'text', strong: true }, count('receipts', msg('Receipts')), money('card', msg('Card'), { hidden: true }),
      money('owed', msg('To hand over')), money('counted', msg('Handed over')), { id: 'difference', label: msg('Difference'), type: 'diff', sum: true, strong: true },
      { id: 'note', label: msg('Note'), type: 'text' }, { id: 'received_by', label: msg('Taken in by'), type: 'text' },
    ]
    case 'hours': return [
      { id: 'label', label: msg('Hour'), type: 'text', strong: true }, count('receipts', msg('Receipts')), { id: 'per_day', label: msg('Receipts a day'), type: 'qty' },
      money('sales', msg('Sales (with VAT)'), { strong: true }), { id: 'average', label: msg('Average receipt'), type: 'money' }, { id: 'share', label: msg('Share of sales'), type: 'bar' },
    ]
    default: return [
      { id: 'number', label: msg('Number'), type: 'text', strong: true }, { id: 'date', label: msg('Date'), type: 'date' }, { id: 'register', label: msg('Till'), type: 'text' },
      { id: 'shift', label: msg('Shift'), type: 'text' }, { id: 'closed_by', label: msg('Closed by'), type: 'text' }, count('receipts', msg('Receipts')), count('refunds_n', msg('Refunds'), { hidden: true }),
      money('sales', msg('Sales (with VAT)'), { strong: true }), money('refunds', msg('Refunded')), money('discounts', msg('Discounts'), { hidden: true }),
      money('net', msg('Without VAT')), money('vat', msg('VAT')), { id: 'difference', label: msg('Cash difference'), type: 'diff', sum: true },
    ]
  }
}

const shown = (c: Col, v: unknown): string => {
  if (v === null || v === undefined || v === '') return ''
  switch (c.type) {
    case 'date': return formatDate(String(v))
    case 'time': return formatDate(String(v), true)
    case 'money': case 'diff': return formatMoney(num(v))
    case 'qty': case 'count': return formatQty(num(v))
    case 'hours': return formatQty(Math.round(num(v) * 10) / 10)
    case 'bar': return `${formatQty(num(v))}%`
    case 'kind': return t(KIND[String(v)] ?? String(v))
    case 'status': return reviewStatusLabel(String(v))
    default: return td(String(v))
  }
}

const blank = (unit: string | null): Filters => ({ report: 'shifts', period: 'this_month', ...periodDates('this_month')!, registers: [], people: [], units: unit ? [unit] : [] })

export function PosHistoryPage() {
  const { companyId, company, can } = useCompany()
  const { unit, multi } = useActiveUnit()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const start = React.useMemo(() => blank(unit?.id ?? null), [unit?.id])
  const applied: Filters = React.useMemo(() => {
    try { const f = params.get('f'); return f ? { ...start, ...JSON.parse(f) } as Filters : start } catch { return start }
  }, [params, start])
  const [draft, setDraft] = React.useState<Filters>(applied)
  React.useEffect(() => setDraft(applied), [applied])
  const apply = (f: Filters) => setParams((p) => { const n = new URLSearchParams(p); n.set('f', JSON.stringify(f)); return n })
  const put = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied)
  const manager = can('pos.approve')

  const registers = useRegisters()
  const members = useMembers()
  const whs = useWarehouses()
  const q = useQuery({
    queryKey: ['pos-history', companyId, applied], enabled: !!companyId && !!applied.from && !!applied.to,
    queryFn: async () => unwrap(await supabase.rpc(applied.report === 'handovers' ? 'pos_handover_history' : 'pos_history', { p_company: companyId!, p: { report: applied.report, from: applied.from, to: applied.to,
      registers: applied.registers, people: applied.people, units: applied.units } as unknown as Json })) as unknown as
      { rows: Row[]; currency: string; tolerance: number; manager: boolean; blind: boolean },
  })
  const cur = q.data?.currency ?? company?.base_currency ?? ''
  const cols = React.useMemo(() => columnsOf(applied.report), [applied.report])
  const regOpts = (registers.data ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.code }))
  const peopleOpts = (members.data ?? []).map((m) => ({ value: m.id, label: m.full_name ?? m.email ?? '' }))
  const unitOpts = (whs.data ?? []).map((w) => ({ value: w.id, label: td(w.name), hint: w.code }))
  const reportLabel = t(REPORTS.find((r) => r.value === applied.report)?.label ?? '')
  const said = React.useMemo(() => {
    const names = (ids: string[], opts: { value: string; label: string }[]) => ids.map((id) => opts.find((o) => o.value === id)?.label ?? '').filter(Boolean).join(', ')
    const parts = [reportLabel, `${formatDate(applied.from)} – ${formatDate(applied.to)}`]
    if (applied.registers.length) parts.push(`${t('Tills')}: ${names(applied.registers, regOpts)}`)
    if (applied.people.length) parts.push(`${t('Cashiers')}: ${names(applied.people, peopleOpts)}`)
    if (applied.units.length) parts.push(`${t('Units|stores')}: ${names(applied.units, unitOpts)}`)
    if (!manager) parts.push(t('Your own shifts'))
    return parts.join(' · ')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, reportLabel, registers.data, members.data, whs.data, manager])

  const tol = num(q.data?.tolerance)
  // the bars of the busy hours: the busiest hour is the full bar
  const maxShare = React.useMemo(() => Math.max(1, ...(q.data?.rows ?? []).map((r) => num(r.share))), [q.data])
  const columns = React.useMemo<ColumnDef<Row>[]>(() => cols.map((c) => {
    const right = !['text', 'date', 'time', 'status', 'kind'].includes(c.type)
    return {
      id: c.id, accessorFn: (r: Row) => (right ? (r[c.id] == null ? null : num(r[c.id])) : String(r[c.id] ?? '')),
      meta: { label: t(c.label), align: right ? 'right' : undefined, exportValue: (r: Row) => (right ? (r[c.id] == null ? null : num(r[c.id])) : shown(c, r[c.id])) },
      header: ({ column }) => <ColumnHeader column={column} title={t(c.label)} />,
      cell: ({ row }) => {
        const v = row.original[c.id]
        if (c.type === 'status') return v ? <Badge variant={reviewStatusTone(String(v))}>{shown(c, v)}</Badge>
          : row.original.status === 'open' ? <Badge variant="secondary">{t('Open|shift')}</Badge> : null
        if (c.type === 'bar') return <span className="flex items-center justify-end gap-2"><span className="h-2 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min((num(v) / maxShare) * 100, 100)}%` }} /></span><span className="w-12 tabular">{shown(c, v)}</span></span>
        const text = shown(c, v)
        if (text === '') return <span className="text-muted-foreground">—</span>
        // money in and out of the drawer: in plain, out in red
        if (c.id === 'amount') return <span className={cn('tabular font-medium', num(v) < 0 && 'text-destructive')}>{text}</span>
        if (c.type === 'diff') return <span className={cn('tabular', c.strong && 'font-medium', num(v) === 0 ? 'text-muted-foreground' : num(v) < 0 ? (Math.abs(num(v)) > tol || c.id !== 'difference' ? 'text-destructive' : 'text-warning') : 'text-warning')}>{text}</span>
        return <span className={cn(c.strong && 'font-medium', right && 'tabular')}>{text}</span>
      },
    } as ColumnDef<Row>
  }), [cols, tol, maxShare])

  // a click goes one step down: a cashier or a till to its shifts, a line to its shift
  const drill = (r: Row) => {
    const go = (f: Partial<Filters>) => apply({ ...applied, ...f })
    if (applied.report === 'cashiers' && r.key) return go({ report: 'shifts', people: [String(r.key)] })
    if (applied.report === 'tills' && r.key) return go({ report: 'shifts', registers: [String(r.key)] })
    if (applied.report === 'differences' && r.key) return go({ report: 'shifts', people: [String(r.key)] })
    if (applied.report === 'handovers' && r.session_id) { navigate(`/pos/sessions/${r.session_id}`); return }
    const id = applied.report === 'shifts' ? r.id : r.session_id
    if (id) navigate(`/pos/sessions/${id}`)
  }

  return (
    <>
      <PageHeader back={{ href: '/pos', label: t('Point of sale') }} title={t('Till history')}
        description={manager ? t('Every shift, each till and each cashier over a period: sales, refunds, items taken off, cash in and out, differences, busy hours and Z-reports. Values in {currency}.', { currency: cur })
          : t('Your shifts over a period: sales, refunds, items taken off and, once reconciled, how each shift came out. Values in {currency}.', { currency: cur })}
        actions={<SavedFilters<Filters> storeKey="pos.history.filters" current={() => draft}
          prepare={(f) => (f.period === 'custom' ? f : { ...f, from: undefined, to: undefined })}
          restore={(c) => (c.period && c.period !== 'custom' ? { ...c, ...periodDates(c.period) } : c)}
          onApply={(f) => apply({ ...start, ...f })} />} />

      <Tabs value={applied.report} onValueChange={(v) => apply({ ...draft, report: v })} className="mb-3 max-w-full overflow-x-auto">
        <TabsList>{REPORTS.map((r) => <TabsTrigger key={r.value} value={r.value}>{t(r.label)}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="grid gap-1"><Label className="text-xs">{t('Period')}</Label>
          <Select value={draft.period} onValueChange={(v) => setDraft((d) => ({ ...d, period: v, ...(periodDates(v) ?? {}) }))}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1"><Label className="text-xs">{t('From|date')}</Label>
          <Input type="date" className="h-9 w-40" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, period: 'custom', from: e.target.value || d.from }))} /></div>
        <div className="grid gap-1"><Label className="text-xs">{t('To|date')}</Label>
          <Input type="date" className="h-9 w-40" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, period: 'custom', to: e.target.value || d.to }))} /></div>
        <MultiPick label={t('Tills')} value={draft.registers} onChange={(v) => put('registers', v)} options={regOpts} />
        {manager && <MultiPick label={t('Cashiers')} value={draft.people} onChange={(v) => put('people', v)} options={peopleOpts} />}
        {multi && <MultiPick label={t('Units|stores')} value={draft.units} onChange={(v) => put('units', v)} options={unitOpts} />}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" className="h-9" onClick={() => setDraft({ ...start, report: draft.report })}><RotateCcw /> {t('Clear')}</Button>
          <Button className="h-9" onClick={() => apply(draft)} disabled={!draft.from || !draft.to}><Play /> {t('Show')}</Button>
        </div>
        {dirty && <p className="basis-full text-[12.5px] text-warning">{t('The filters changed. Press Show to see the report with them.')}</p>}
      </div>
      <p className="mb-2 text-[12.5px] text-muted-foreground">{said}{q.data?.blind ? ` · ${t('Shifts not reconciled yet show no expected cash or difference')}` : ''}</p>

      <DataTable
        key={applied.report}
        tableKey={`pos.history.${applied.report}`}
        columns={columns}
        initialHidden={cols.filter((c) => c.hidden).map((c) => c.id)}
        data={q.data?.rows}
        isLoading={q.isLoading}
        error={q.error}
        searchPlaceholder={t('Search')}
        exportName={`${t('Till history')} · ${reportLabel} ${applied.from} ${applied.to}`}
        exportSubtitle={said}
        onRowClick={drill}
        empty={{ title: t('Nothing in this period'), description: t('Change the dates or the filters.') }}
        footer={(table) => {
          const rows = table.getFilteredRowModel().rows.map((r) => r.original)
          const sum = (id: string) => rows.reduce((s, r) => s + num(r[id]), 0)
          return (
            <TableFooter>
              <TableRow className="hover:bg-transparent font-semibold">
                <LeadCell />
                {table.getVisibleLeafColumns().map((c, i) => {
                  const def = cols.find((x) => x.id === c.id)
                  let v: React.ReactNode = ''
                  if (i === 0) v = t('Total')
                  else if (def?.sum) v = def.type === 'money' || def.type === 'diff' ? formatMoney(sum(c.id)) : formatQty(Math.round(sum(c.id) * 10) / 10)
                  else if (c.id === 'average' && sum('receipts')) v = formatMoney(sum('sales') / sum('receipts'))
                  else if (c.id === 'per_hour' && sum('hours')) v = formatQty(Math.round((sum('receipts') / sum('hours')) * 10) / 10)
                  return <TableCell key={c.id} className={cn(i > 0 && 'text-right tabular')}>{v}</TableCell>
                })}
              </TableRow>
            </TableFooter>
          )
        }}
      />
    </>
  )
}
