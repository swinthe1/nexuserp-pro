import { Bookmark } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/export-menu'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { XlsxColumn } from '@/lib/export'
import { t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { type ReportColumn, type ReportResult, type ReportRow, type SavedReport, useSaveReport } from '../api'

const MAX_COLS = 24

type Cell = number | null
type PivotRow = { key: string; label: string; cells: Record<string, Cell>; total: Cell }

/** a report value as the column shows it (money, percent or a quantity); `empty` for no value */
export function formatMeasure(c: ReportColumn, v: unknown, empty = '') {
  if (v === null || v === undefined) return empty
  if (c.type === 'money') return formatMoney(num(v))
  if (c.type === 'pct') return `${formatQty(num(v))}%`
  return formatQty(num(v))
}
const fmt = (c: ReportColumn, v: Cell) => formatMeasure(c, v)

/** rows by the first grouping, columns by the second, one measure in the cells */
export function PivotTable({ data, measure, rowLabel, colLabel, rowHeader, colHeader, exportName, title, subtitle }: {
  data: ReportResult; measure: ReportColumn
  rowLabel: (r: ReportRow) => string; colLabel: (key: string | null, label: string | null) => string
  rowHeader: string; colHeader: string; exportName: string; title: string; subtitle: string
}) {
  const additive = measure.type !== 'pct'
  const { cols, rows, colTotals, more } = React.useMemo(() => {
    const cells = data.pivot ?? []
    const byCol = new Map<string, { label: string; total: number }>()
    for (const c of cells) {
      const k = String(c.col ?? '')
      const e = byCol.get(k) ?? { label: colLabel(c.col, c.col_label), total: 0 }
      e.total += num(c[measure.key])
      byCol.set(k, e)
    }
    let colList = [...byCol.entries()].map(([key, v]) => ({ key, ...v }))
    // months and age buckets keep their order; anything else, the biggest first
    if (data.pivot_by === 'month') colList.sort((a, b) => a.key.localeCompare(b.key))
    else if (data.pivot_by === 'age' || data.pivot_by === 'bucket') colList.sort((a, b) => a.label.localeCompare(b.label))
    else colList.sort((a, b) => b.total - a.total)
    const more = Math.max(colList.length - MAX_COLS, 0)
    colList = colList.slice(0, MAX_COLS)
    const index = new Map<string, Record<string, Cell>>()
    for (const c of cells) {
      const rk = String(c.key ?? '')
      const m = index.get(rk) ?? {}
      m[String(c.col ?? '')] = c[measure.key] === null ? null : num(c[measure.key])
      index.set(rk, m)
    }
    const rowList: PivotRow[] = data.rows.map((r) => ({
      key: String(r.key ?? ''), label: rowLabel(r), cells: index.get(String(r.key ?? '')) ?? {},
      total: r[measure.key] === null ? null : num(r[measure.key]),
    }))
    return { cols: colList, rows: rowList, colTotals: colList.map((c) => c.total), more }
  }, [data, measure, rowLabel, colLabel])

  const exportCols: XlsxColumn<PivotRow>[] = [
    { header: rowHeader, value: (r) => r.label, format: 'text' },
    ...cols.map((c) => ({ header: c.label, value: (r: PivotRow) => r.cells[c.key] ?? null, format: measure.type === 'int' ? 'int' as const : measure.type === 'pct' ? 'qty' as const : 'money' as const })),
    { header: t('Total'), value: (r) => r.total, format: measure.type === 'int' ? 'int' as const : measure.type === 'pct' ? 'qty' as const : 'money' as const },
  ]
  const totalsRow = additive ? Object.fromEntries([[rowHeader, t('Total')], ...cols.map((c, i) => [c.label, colTotals[i]]), [t('Total'), data.totals?.[measure.key] ?? null]]) as Record<string, number | string | null> : undefined

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-[13px]">
        <span className="text-muted-foreground">{tServer(measure.label)} · {rowHeader} × {colHeader}{more > 0 && ` · ${t('the {n} biggest columns; {more} more are in the total', { n: MAX_COLS, more })}`}</span>
        <ExportMenu rows={rows} columns={exportCols} filename={exportName} title={title} subtitle={subtitle} xlsx={{ totals: totalsRow }} />
      </div>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 min-w-[180px] bg-card">{rowHeader}</TableHead>
            {cols.map((c) => <TableHead key={c.key} className="whitespace-nowrap text-right">{c.label}</TableHead>)}
            <TableHead className="text-right font-semibold">{t('Total')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">{r.label}</TableCell>
                {cols.map((c) => {
                  const v = r.cells[c.key] ?? null
                  return <TableCell key={c.key} className={cn('whitespace-nowrap text-right tabular', v !== null && v < 0 && 'text-destructive')}>{fmt(measure, v)}</TableCell>
                })}
                <TableCell className="whitespace-nowrap text-right font-medium tabular">{fmt(measure, r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow className="hover:bg-transparent">
            <TableCell className="sticky left-0 z-10 bg-muted font-semibold">{t('Total')}</TableCell>
            {cols.map((c, i) => <TableCell key={c.key} className="whitespace-nowrap text-right font-semibold tabular">{additive ? fmt(measure, colTotals[i]) : ''}</TableCell>)}
            <TableCell className="whitespace-nowrap text-right font-semibold tabular">{fmt(measure, data.totals?.[measure.key] ?? null)}</TableCell>
          </TableRow></TableFooter>
        </Table>
      </CardContent>
    </Card>
  )
}

/** keeps the report as it is set up now, under a name */
export function SaveReportButton({ report, params, current }: { report: string; params: SavedReport['params']; current?: SavedReport | null }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const save = useSaveReport()
  const start = () => { setName(current?.name ?? ''); setShared(current?.is_shared ?? false); setOpen(true) }
  const submit = async (asNew: boolean) => {
    if (!name.trim()) return
    try {
      await save.mutateAsync({ id: asNew ? undefined : current?.id, name: name.trim(), report, params, is_shared: shared })
      toast.success(t('Report saved; it is under My reports'))
      setOpen(false)
    } catch (e) { toast.error(describeError(e)) }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={start}><Bookmark className="size-3.5" />{current ? t('Save changes') : t('Save the report')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Save the report')}</DialogTitle>
            <DialogDescription>{t('It keeps the grouping, the columns, the filters and the period. A period like "this month" moves on with the calendar.')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="sr-name">{t('Name')}</Label>
              <Input id="sr-name" value={name} maxLength={80} autoFocus placeholder={t('e.g. Sales by shop and month')} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(false) }} /></div>
            <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={shared} onCheckedChange={(c) => setShared(c === true)} className="mt-0.5" />
              <span>{t('Everyone in the company can open it')}<span className="block text-xs text-muted-foreground">{t('They see only figures their role allows.')}</span></span></label>
          </div>
          <DialogFooter>
            {current && <Button variant="outline" onClick={() => void submit(true)} disabled={!name.trim()} loading={save.isPending}>{t('Save as a new one')}</Button>}
            <Button onClick={() => void submit(false)} disabled={!name.trim()} loading={save.isPending}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
