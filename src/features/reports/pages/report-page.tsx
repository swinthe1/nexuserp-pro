import { ChevronRight, ExternalLink } from 'lucide-react'
import * as React from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ExportMenu } from '@/components/export-menu'
import { MultiPick } from '@/components/multi-pick'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { XlsxColumn } from '@/lib/export'
import { ErrorState } from '@/components/error-state'
import { formatDateWith, msg, t, tn, tServer } from '@/i18n'
import { cn, formatCompact, formatDate, formatMoney, num, todayISO, currencyLabel } from '@/lib/utils'
import { axisTick, iso, tooltipStyle } from '@/features/finance/pages/finance-overview-page'
import { type ReportColumn, type ReportRow, type SavedReport, useReport, useSavedReports } from '../api'
import { formatMeasure, PivotTable, SaveReportButton } from '../components/pivot'
import { DIM_LABEL, canRunReport, reportDef } from '../catalog'
import { DETAIL_REPORTS, DetailPage } from './detail-page'

type Step = { dim: string; key: string; label: string }
const NO_PIVOT = '__none'
export type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_year'
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_month', label: msg('This month') }, { value: 'last_month', label: msg('Last month') }, { value: 'this_quarter', label: msg('This quarter') },
  { value: 'ytd', label: msg('Year to date') }, { value: 'last_year', label: msg('Last year') },
]
export function presetRange(p: Preset): [string, string] {
  const n = new Date()
  switch (p) {
    case 'this_month': return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), todayISO()]
    case 'last_month': return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]
    case 'this_quarter': return [iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), todayISO()]
    case 'ytd': return [iso(new Date(n.getFullYear(), 0, 1)), todayISO()]
    case 'last_year': return [iso(new Date(n.getFullYear() - 1, 0, 1)), iso(new Date(n.getFullYear() - 1, 11, 31))]
  }
}
/** the address of a saved report, its relative period worked out for today */
export function savedHref(sr: SavedReport) {
  const q = new URLSearchParams()
  const p = sr.params
  if (p.period && PRESETS.some((x) => x.value === p.period)) { const [f, to] = presetRange(p.period as Preset); q.set('from', f); q.set('to', to) }
  else { if (p.from) q.set('from', p.from); if (p.to) q.set('to', p.to) }
  if (p.group_by) q.set('group_by', p.group_by)
  if (p.pivot_by) q.set('across', p.pivot_by)
  if (p.measure) q.set('show', p.measure)
  if (p.trail?.length) q.set('trail', JSON.stringify(p.trail))
  q.set('saved', sr.id)
  return `/reports/${sr.report}?${q.toString()}`
}
const monthLabel = (m: string) => /^\d{4}-\d{2}$/.test(m) ? formatDateWith(new Date(`${m}-01T00:00:00`), { month: 'short', year: 'numeric' }) : tServer(m)

const fmt = (c: ReportColumn, v: unknown) => formatMeasure(c, v, '—')

/** Sales and purchase analysis hold two views on one page: the analysis (grouped, pivoted) and the detail (lines, documents, filters) */
const TWO_VIEWS: Record<string, { kind: 'sales' | 'purchases'; perm: string }> = {
  sales: { kind: 'sales', perm: 'sales.read' }, purchases: { kind: 'purchases', perm: 'procurement.read|invoicing.read' },
}

// what the analysis can be grouped by, in the order a shop thinks of it
const ANALYSIS_DIMS: Record<'sales' | 'purchases', string[]> = {
  sales: ['month', 'category', 'product', 'customer', 'vendor', 'warehouse', 'salesperson', 'channel', 'city', 'document'],
  purchases: ['month', 'vendor', 'category', 'product', 'account', 'document'],
}
const BY: Record<string, string> = {
  month: msg('By month|analysis'), category: msg('By category|analysis'), product: msg('By item|analysis'), customer: msg('By customer|analysis'),
  vendor: msg('By supplier|analysis'), warehouse: msg('By unit|analysis'), salesperson: msg('By salesperson|analysis'), channel: msg('By channel|analysis'),
  city: msg('By city|analysis'), document: msg('By document|analysis'), account: msg('By expense account|analysis'),
}

/**
 * The one "Report" list of the sales and purchase analysis: the grouped analysis (chart, columns, steps down)
 * and the detailed lists (items, documents, lines, filters) side by side; the dates go along.
 * `value` is 'a:<dimension>' or 'd:<detail report>'; `onPick` handles a choice of the view it sits in.
 */
export function ReportPicker({ report, value, dates, onPick, className }: {
  report: 'sales' | 'purchases'; value: string; dates: { from: string; to: string }; onPick: (v: string) => boolean; className?: string
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { can } = useCompany()
  const def = reportDef(report)
  const analysis = !!def && canRunReport(can, def)
  const detail = can(TWO_VIEWS[report].perm)
  const pick = (v: string) => {
    if (onPick(v)) return
    const q = new URLSearchParams()
    if (v.startsWith('a:')) { q.set('group_by', v.slice(2)); q.set('from', dates.from); q.set('to', dates.to) }
    else { q.set('view', 'detail'); q.set('f', JSON.stringify({ report: v.slice(2), period: 'custom', from: dates.from, to: dates.to })) }
    navigate(`${pathname}?${q}${pathname.startsWith('/reports') ? '' : '#analiza'}`)
  }
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{t('Report')}</Label>
      <Select value={value} onValueChange={pick}>
        <SelectTrigger className={cn('h-9 w-64', className)}><SelectValue /></SelectTrigger>
        <SelectContent>
          {analysis && <SelectGroup><SelectLabel>{t('Analysis, with chart and columns')}</SelectLabel>
            {ANALYSIS_DIMS[report].map((d) => <SelectItem key={d} value={`a:${d}`}>{t(BY[d] ?? d)}</SelectItem>)}</SelectGroup>}
          {detail && <SelectGroup><SelectLabel>{t('In detail, with filters')}</SelectLabel>
            {DETAIL_REPORTS[report].map((r) => <SelectItem key={r.value} value={`d:${r.value}`}>{t(r.label)}</SelectItem>)}</SelectGroup>}
        </SelectContent>
      </Select>
    </div>
  )
}

/** the heading of the analysis when it sits inside the Sales or Purchases page, in place of the page header */
export function AnalysisHead({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div id="analiza" className="mb-3 mt-8 flex scroll-mt-28 flex-col gap-2 border-t pt-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-0.5 line-clamp-2 max-w-3xl text-[12.5px] text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** the analysis (grouped or in detail) of sales or purchases: a page of its own under Reports, or a part of the Sales / Purchases page */
export function AnalysisSection({ kind, embedded }: { kind: 'sales' | 'purchases'; embedded?: boolean }) {
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const { can } = useCompany()
  const def = reportDef(kind)
  // opened plainly, the detail shows at once (as the detailed sales and purchases did); the analysis when one is chosen
  const analysisAsked = ['group_by', 'across', 'trail', 'saved', 'from', 'to'].some((k) => params.has(k)) && params.get('view') !== 'detail'
  // coming here for the analysis (a link, a saved report): straight to it
  React.useEffect(() => {
    if (!embedded || (hash !== '#analiza' && !analysisAsked && !params.has('f'))) return
    const id = window.setTimeout(() => document.getElementById('analiza')?.scrollIntoView({ block: 'start' }), 150)
    return () => window.clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded])
  if (!can(TWO_VIEWS[kind].perm)) return null
  if (!analysisAsked || (def && !canRunReport(can, def))) return <DetailPage kind={kind} merged embedded={embedded} />
  return <ReportView reportKey={kind} embedded={embedded} />
}

export function ReportPage() {
  const { key = '' } = useParams()
  const { search } = useLocation()
  const { can, pageAllowed } = useCompany()
  const two = TWO_VIEWS[key]
  // sales and purchase analysis live inside the Sales and Purchases pages
  if (two) {
    const home = two.kind === 'sales' ? '/sales' : '/procurement'
    if (can(two.kind === 'sales' ? 'sales.read' : 'procurement.read') && pageAllowed(home)) return <Navigate replace to={`${home}${search}#analiza`} />
    if (can(two.perm)) return <AnalysisSection kind={two.kind} />
  }
  return <ReportView />
}

function ReportView({ reportKey, embedded }: { reportKey?: string; embedded?: boolean }) {
  const { key: routeKey = '' } = useParams()
  const key = reportKey ?? routeKey
  const def = reportDef(key)
  const { can, company } = useCompany()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [ytdFrom, today] = presetRange('ytd')
  const from = params.get('from') ?? ytdFrom
  const to = params.get('to') ?? today
  const trail: Step[] = React.useMemo(() => { try { return JSON.parse(params.get('trail') ?? '[]') as Step[] } catch { return [] } }, [params])
  const groupBy = params.get('group_by') ?? def?.start ?? 'month'
  const filters = React.useMemo(() => Object.fromEntries(trail.map((s) => [s.dim, s.key])), [trail])
  const across = params.get('across') ?? ''
  const pivotBy = across && across !== groupBy ? across : ''
  // across one dimension, only some of its values may be wanted (e.g. two suppliers out of all)
  const only: string[] = React.useMemo(() => { try { const v = JSON.parse(params.get('only') ?? '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }, [params])
  const runFilters = React.useMemo(() => (pivotBy && only.length ? { ...filters, [pivotBy]: only } : filters), [filters, pivotBy, only])
  const report = useReport(key, { from, to, group_by: groupBy, pivot_by: pivotBy || undefined, filters: runFilters }, !!def && canRunReport(can, def))
  const choices = useReport(key, { from, to, group_by: pivotBy || groupBy, filters }, !!def && canRunReport(can, def) && !!pivotBy)
  const savedList = useSavedReports()
  const saved = savedList.data?.find((r) => r.id === params.get('saved')) ?? null

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v) }
    setParams(next)
  }
  if (!def) return <EmptyState title={t('This report does not exist')} action={<Link to="/reports" className="text-sm text-primary hover:underline">{t('All reports')}</Link>} />
  if (!canRunReport(can, def)) return <EmptyState title={t("You can't open this report")} description={t('Your role does not include these figures. Ask a company admin for access.')} />

  const data = report.data
  const cols = data?.columns ?? []
  const rows = data?.rows ?? []
  const dims = (data?.dims ?? def.path).filter((d) => !(d in filters) || d === groupBy)
  const nextDim = (() => {
    const i = def.path.indexOf(groupBy)
    const after = (i >= 0 ? def.path.slice(i + 1) : def.path).filter((d) => !(d in filters) && d !== groupBy)
    return after.find((d) => data?.dims.includes(d) ?? true) ?? null
  })()
  const drill = (r: ReportRow) => {
    if (groupBy === 'document') { if (r.href) navigate(r.href); return }
    if (!nextDim || r.key === null) return
    const step: Step = { dim: groupBy, key: String(r.key), label: groupBy === 'month' ? monthLabel(String(r.label)) : r.label === null ? '—' : tServer(String(r.label)) }
    set({ trail: JSON.stringify([...trail, step]), group_by: nextDim })
  }
  const measure = cols.find((c) => c.key === def.measure) ?? cols.find((c) => c.type === 'money')
  const shown = cols.find((c) => c.key === params.get('show')) ?? measure ?? cols[0]
  const preset = PRESETS.find((p) => { const [f, t2] = presetRange(p.value); return f === from && t2 === to })?.value
  const saveParams: SavedReport['params'] = {
    ...(def.asOf ? (params.get('to') ? { to } : { period: 'ytd' }) : preset ? { period: preset } : { from, to }),
    group_by: groupBy, ...(pivotBy ? { pivot_by: pivotBy, measure: shown?.key } : {}), ...(trail.length ? { trail } : {}),
  }
  const colLabel = (k: string | null, l: string | null) => pivotBy === 'month' ? monthLabel(String(l ?? k ?? '')) : l === null ? '—' : tServer(String(l))
  const periodText = def.asOf ? t('As of {date}', { date: formatDate(to) }) : `${formatDate(from)} – ${formatDate(to)}`
  const onlyText = pivotBy && only.length ? `${t(DIM_LABEL[pivotBy] ?? pivotBy)}: ${only.map((k) => { const r = choices.data?.rows.find((x) => String(x.key) === k); return r?.label == null ? k : tServer(String(r.label)) }).join(', ')}` : ''
  const filterText = [...trail.map((s) => `${t(DIM_LABEL[s.dim] ?? s.dim)}: ${s.label}`), onlyText].filter(Boolean).join(' · ')
  const dimLabel = t(DIM_LABEL[groupBy] ?? groupBy)
  const rowLabel = (r: ReportRow) => groupBy === 'month' ? monthLabel(String(r.label ?? '')) : r.label === null ? '—' : tServer(String(r.label))

  const exportCols: XlsxColumn<ReportRow>[] = [
    { header: dimLabel, value: rowLabel, format: 'text' },
    ...cols.map((c) => ({ header: tServer(c.label), value: (r: ReportRow) => r[c.key] as number | null, format: c.type === 'int' ? 'int' as const : c.type === 'pct' ? 'qty' as const : 'money' as const })),
  ]
  const totals = data?.totals ? Object.fromEntries([[dimLabel, t('Total')], ...cols.map((c) => [tServer(c.label), data.totals?.[c.key]])]) as Record<string, number | string | null> : undefined

  return (
    <>
      {(() => {
        const acts = <div className="flex items-center gap-2"><SaveReportButton report={def.key} params={saveParams} current={saved && saved.owner_id === user?.id ? saved : null} />{!pivotBy && <ExportMenu rows={rows} columns={exportCols} filename={`${def.key}-${groupBy}-${to}`} title={t(def.title)}
          subtitle={[company?.name, periodText, filterText].filter(Boolean).join(' · ')} xlsx={{ totals }} />}</div>
        return embedded ? <AnalysisHead title={saved ? saved.name : t(def.title)} description={saved ? t(def.title) : t(def.question)} actions={acts} />
          : <PageHeader back={{ href: '/reports', label: t('Reports') }} title={saved ? saved.name : t(def.title)} description={saved ? t(def.title) : t(def.question)} actions={acts} />
      })()}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          {TWO_VIEWS[key] && <ReportPicker report={TWO_VIEWS[key].kind} value={`a:${groupBy}`} dates={{ from, to }} className="h-8"
            onPick={(v) => { if (!v.startsWith('a:')) return false; set({ group_by: v.slice(2) }); return true }} />}
          {!def.asOf && (
            <div className="grid gap-1">
              <Label className="text-xs">{t('Period')}</Label>
              <Select value={PRESETS.find((p) => { const [f, t] = presetRange(p.value); return f === from && t === to })?.value ?? 'custom'}
                onValueChange={(v) => { if (v === 'custom') return; const [f, t] = presetRange(v as Preset); set({ from: f, to: t }) }}>
                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{t(p.label)}</SelectItem>)}<SelectItem value="custom">{t('Custom range')}</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          {!def.asOf && <div className="grid gap-1"><Label htmlFor="rep-from" className="text-xs">{t('From')}</Label>
            <Input id="rep-from" type="date" className="h-8 w-[150px]" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} /></div>}
          <div className="grid gap-1"><Label htmlFor="rep-to" className="text-xs">{def.asOf ? t('On date') : t('To')}</Label>
            <Input id="rep-to" type="date" className="h-8 w-[150px]" value={to} onChange={(e) => e.target.value && set({ to: e.target.value })} /></div>
          {TWO_VIEWS[key] ? null : (
          <div className="grid gap-1">
            <Label className="text-xs">{t('Group by')}</Label>
            <Select value={groupBy} onValueChange={(v) => set({ group_by: v })}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{dims.map((d) => <SelectItem key={d} value={d}>{t(DIM_LABEL[d] ?? d)}</SelectItem>)}</SelectContent>
            </Select>
          </div>)}
          <div className="grid gap-1">
            <Label className="text-xs">{t('Across')}</Label>
            <Select value={pivotBy || NO_PIVOT} onValueChange={(v) => set({ across: v === NO_PIVOT ? null : v, only: null })}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PIVOT}>{t('Nothing (a list)')}</SelectItem>
                {dims.filter((d) => d !== groupBy && d !== 'document').map((d) => <SelectItem key={d} value={d}>{t(DIM_LABEL[d] ?? d)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {pivotBy && (
            <div className="grid gap-1">
              <Label className="text-xs">{t('Which ones|columns')}</Label>
              <MultiPick className="h-8" label={t(DIM_LABEL[pivotBy] ?? pivotBy)} value={only}
                onChange={(v) => set({ only: v.length ? JSON.stringify(v) : null })}
                options={(choices.data?.rows ?? []).filter((r) => r.key !== null).map((r) => ({ value: String(r.key), label: pivotBy === 'month' ? monthLabel(String(r.label ?? '')) : r.label === null ? '—' : tServer(String(r.label)) }))} />
            </div>
          )}
          {pivotBy && shown && (
            <div className="grid gap-1">
              <Label className="text-xs">{t('Show')}</Label>
              <Select value={shown.key} onValueChange={(v) => set({ show: v })}>
                <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>{cols.map((c) => <SelectItem key={c.key} value={c.key}>{tServer(c.label)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <nav aria-label={t('Where you are in the report')} className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
        <button className={cn('rounded px-1.5 py-0.5', trail.length ? 'text-primary hover:underline' : 'font-medium')} onClick={() => set({ trail: null, group_by: def.start })}>{t('All')}</button>
        {trail.map((s, i) => (
          <React.Fragment key={i}>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <button className={cn('rounded px-1.5 py-0.5', i < trail.length - 1 ? 'text-primary hover:underline' : 'font-medium')}
              onClick={() => set({ trail: JSON.stringify(trail.slice(0, i + 1)), group_by: def.path[def.path.indexOf(s.dim) + 1] ?? groupBy })}>
              <span className="text-muted-foreground">{t(DIM_LABEL[s.dim] ?? s.dim)}:</span> {s.label}
            </button>
          </React.Fragment>
        ))}
        <ChevronRight className="size-3.5 text-muted-foreground" /><span className="text-muted-foreground">{t('by {dim}', { dim: dimLabel.toLowerCase() })}</span>
      </nav>

      {report.isError ? <Card><ErrorState error={report.error} title={t('The report could not run')} onRetry={() => void report.refetch()} /></Card>
        : report.isLoading || !data ? <Skeleton className="h-[420px]" />
        : !rows.length ? <Card><EmptyState title={t('Nothing in this period')} description={t('Try a longer period, or go back a step in the path above.')} /></Card>
        : pivotBy && data.pivot && shown ? (
          <PivotTable data={data} measure={shown} rowLabel={rowLabel} colLabel={colLabel} rowHeader={dimLabel} colHeader={t(DIM_LABEL[pivotBy] ?? pivotBy)}
            exportName={`${def.key}-${groupBy}-${pivotBy}-${to}`} title={saved?.name ?? t(def.title)} subtitle={[company?.name, periodText, filterText].filter(Boolean).join(' · ')} />
        ) : (
        <>
          {measure && rows.length > 1 && <ReportChart rows={rows} measure={measure} vertical={groupBy !== 'month' && groupBy !== 'age' && groupBy !== 'bucket'} label={rowLabel} onPick={drill} />}
          <Card className={cn(report.isFetching && 'opacity-70 transition-opacity')}>
            <CardContent className="overflow-x-auto p-0">
              <Table className="min-w-[640px]">
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead>{dimLabel}</TableHead>
                  {cols.map((c) => <TableHead key={c.key} className="text-right">{tServer(c.label)}{c.type === 'money' && company ? <span className="font-normal text-muted-foreground"> {currencyLabel(company.base_currency)}</span> : null}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const clickable = groupBy === 'document' ? !!r.href : !!nextDim
                    return (
                      <TableRow key={`${r._n}-${r.key}`} className={cn(clickable && 'cursor-pointer')} onClick={() => clickable && drill(r)}
                        tabIndex={clickable ? 0 : undefined} onKeyDown={(e) => { if (clickable && e.key === 'Enter') drill(r) }}>
                        <TableCell className="font-medium">
                          {groupBy === 'document' && r.href ? <Link to={r.href} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{rowLabel(r)}<ExternalLink className="size-3" /></Link>
                            : <span className={cn(clickable && 'text-primary')}>{rowLabel(r)}</span>}
                        </TableCell>
                        {cols.map((c) => <TableCell key={c.key} className={cn('text-right tabular', c.key === 'margin' && num(r[c.key]) < 0 && 'text-destructive')}>{fmt(c, r[c.key])}</TableCell>)}
                      </TableRow>
                    )
                  })}
                </TableBody>
                {data.totals && (
                  <TableFooter><TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold">{t('Total')} · {tn(rows.length, '{n} row', '{n} rows')}</TableCell>
                    {cols.map((c) => <TableCell key={c.key} className="text-right font-semibold tabular">{fmt(c, data.totals?.[c.key])}</TableCell>)}
                  </TableRow></TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>
          {nextDim && groupBy !== 'document' && <p className="mt-2 text-xs text-muted-foreground">{t('Click a row to see it by {dim}.', { dim: t(DIM_LABEL[nextDim] ?? nextDim).toLowerCase() })}</p>}
        </>
      )}
    </>
  )
}

function ReportChart({ rows, measure, vertical, label, onPick }: { rows: ReportRow[]; measure: ReportColumn; vertical: boolean; label: (r: ReportRow) => string; onPick: (r: ReportRow) => void }) {
  const data = (vertical ? [...rows].sort((a, b) => num(b[measure.key]) - num(a[measure.key])).slice(0, 12) : rows.slice(0, 36))
    .map((r) => ({ name: label(r), value: num(r[measure.key]), row: r }))
  const height = vertical ? Math.max(160, data.length * 30 + 30) : 240
  return (
    <Card className="mb-4">
      <CardContent className="p-3 pb-1">
        <div className="mb-1 text-xs text-muted-foreground">{tServer(measure.label)}{vertical && rows.length > 12 ? ` · ${t('top 12')}` : ''}</div>
        <ResponsiveContainer width="100%" height={height}>
          {vertical ? (
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" tick={axisTick} tickFormatter={(v: number) => formatCompact(v)} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={150} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [formatMoney(v), tServer(measure.label)]} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} className="cursor-pointer" onClick={(d: { row: ReportRow }) => onPick(d.row)}>
                {data.map((d, i) => <Cell key={i} fill={d.value < 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />)}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} tickFormatter={(v: number) => formatCompact(v)} axisLine={false} tickLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [formatMoney(v), tServer(measure.label)]} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(d: { row: ReportRow }) => onPick(d.row)}>
                {data.map((d, i) => <Cell key={i} fill={d.value < 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
