import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { msg, t, td, tServer } from '@/i18n'
import { formatDateWith } from '@/i18n/format'
import { cn, formatMonth, formatQty, num } from '@/lib/utils'
import { useAttendanceMonth, useAttendanceRecords, useDeleteAttendance, useDepartments, useSaveAttendance, type AttendanceDay, type AttendanceRow } from '../api'

/** letter: the short code shown in the grid, translatable (Albanian uses its own initials) */
const CODES: Record<string, { label: string; letter: string; cls: string }> = {
  P: { label: msg('Present'), letter: msg('P|attendance code'), cls: 'bg-primary/15 text-foreground' },
  L: { label: msg('Leave'), letter: msg('L|attendance code'), cls: 'bg-success/20 text-foreground' },
  U: { label: msg('Unpaid leave'), letter: msg('U|attendance code'), cls: 'bg-warning/25 text-foreground' },
  H: { label: msg('Public holiday'), letter: msg('H|attendance code'), cls: 'bg-muted text-muted-foreground' },
  W: { label: msg('Weekend'), letter: msg('W|attendance code'), cls: 'bg-muted/50 text-muted-foreground/60' },
  A: { label: msg('Absent, no record'), letter: msg('A|attendance code'), cls: 'bg-destructive/15 text-destructive' },
}
const pad = (n: number) => String(n).padStart(2, '0')
/** 8.5 → 8½; an open check-in (no hours yet) → • */
const hoursLabel = (h: number) => { const n = num(h); if (!n) return '•'; const w = Math.floor(n); return `${w}${n - w >= 0.5 ? '½' : ''}` }

export function AttendancePage() {
  const { can, companyId } = useCompany()
  useRealtimeInvalidate('attendance_records', companyId, [['hr', companyId, 'attendance'], ['hr', companyId, 'att-records']])
  const now = new Date()
  const [ym, setYm] = React.useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [dep, setDep] = React.useState<string | null>(null)
  const month = `${ym.y}-${pad(ym.m)}-01`
  const att = useAttendanceMonth(month, dep)
  const deps = useDepartments()
  const [edit, setEdit] = React.useState<{ row: AttendanceRow; day: AttendanceDay } | null>(null)
  const shift = (d: number) => setYm(({ y, m }) => { const x = new Date(y, m - 1 + d, 1); return { y: x.getFullYear(), m: x.getMonth() + 1 } })
  const daysIn = new Date(ym.y, ym.m, 0).getDate()
  const dow = (d: number) => formatDateWith(new Date(ym.y, ym.m - 1, d), { weekday: 'narrow' })
  const label = formatMonth(new Date(ym.y, ym.m - 1, 1))
  return (
    <>
      <PageHeader title={t('Attendance')} description={t('Each person\'s month at a glance: days at work with hours, leave, holidays and missing days.')}
        actions={<>
          <Select value={dep ?? 'all'} onValueChange={(v) => setDep(v === 'all' ? null : v)}><SelectTrigger className="w-[180px]" aria-label={t('Department')}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('All departments')}</SelectItem>{(deps.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{td(d.name)}</SelectItem>)}</SelectContent></Select>
          <div className="flex items-center rounded-md border">
            <Button variant="ghost" size="icon-sm" aria-label={t('Previous month')} onClick={() => shift(-1)}><ChevronLeft /></Button>
            <span className="min-w-[120px] text-center text-[13px] font-medium">{label}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t('Next month')} onClick={() => shift(1)}><ChevronRight /></Button>
          </div>
        </>} />
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {Object.entries(CODES).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className={cn('flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[10px] font-semibold', c.cls)}>{k === 'W' ? '' : t(c.letter)}</span>{t(c.label)}</span>)}
        {can('hr.write') && <span>· {t('Click a day to add or correct it.')}</span>}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {att.isLoading ? <Skeleton className="m-4 h-64" /> : att.isError ? <ErrorState error={att.error} onRetry={() => void att.refetch()} /> : !att.data?.length ? <EmptyState title={t('Nobody worked here this month')} description={t('Pick another month or department.')} /> : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
              <thead><tr>
                <th className="sticky left-0 z-10 w-[150px] border-b bg-card px-3 py-2 text-left text-[13px] font-medium">{t('Employee')}</th>
                {Array.from({ length: daysIn }, (_, i) => i + 1).map((d) => (
                  <th key={d} className="border-b px-0 py-1 text-center font-normal text-muted-foreground"><div className="text-[10px]">{dow(d)}</div>{d}</th>))}
                <th className="w-[58px] border-b px-1.5 text-right text-[11px] font-medium leading-tight">{t('Hours')}</th><th className="w-[58px] border-b px-1.5 text-right text-[11px] font-medium leading-tight">{t('Overtime')}</th>
                <th className="w-[58px] border-b px-1.5 text-right text-[11px] font-medium leading-tight">{t('Present')}</th><th className="w-[58px] border-b px-1.5 text-right text-[11px] font-medium leading-tight">{t('Leave')}</th><th className="w-[58px] border-b px-2 text-right text-[11px] font-medium leading-tight">{t('Absent')}</th>
              </tr></thead>
              <tbody>{att.data.map((r) => (
                <tr key={r.employee_id}>
                  <td className="sticky left-0 z-10 border-b bg-card px-3 py-1.5"><Link to={`/hr/employees/${r.employee_id}`} className="font-medium hover:underline">{r.employee}</Link>
                    <div className="text-[11px] text-muted-foreground">{r.department ? tServer(td(r.department)) : '—'}</div></td>
                  {r.days.map((d) => {
                    const c = CODES[d.c]
                    const title = c ? `${d.d} ${label}: ${t(c.label)}${d.c === 'P' ? ` · ${formatQty(d.h)} h` : ''}${d.t ? ` · ${td(d.t)}` : ''}` : undefined
                    return (
                      <td key={d.d} className="border-b p-0.5">
                        <button type="button" title={title} aria-label={title ?? `${d.d}`} disabled={!can('hr.write') || d.c === '' && !c}
                          onClick={() => setEdit({ row: r, day: d })}
                          className={cn('flex h-7 w-full items-center justify-center rounded tabular text-[11px] disabled:cursor-default', c?.cls ?? '', can('hr.write') && 'hover:ring-1 hover:ring-ring')}>
                          {d.c === 'P' ? hoursLabel(d.h) : d.c === 'W' || !c ? '' : t(c.letter)}
                        </button>
                      </td>)
                  })}
                  <td className="border-b px-2 text-right tabular">{formatQty(num(r.worked_hours).toFixed(1))}</td>
                  <td className="border-b px-2 text-right tabular">{num(r.overtime_hours) ? formatQty(r.overtime_hours) : '—'}</td>
                  <td className="border-b px-2 text-right tabular">{r.present_days}/{r.working_days}</td>
                  <td className="border-b px-2 text-right tabular">{num(r.leave_days) ? formatQty(r.leave_days) : '—'}</td>
                  <td className={cn('border-b px-3 text-right tabular', r.absent_days > 0 && 'text-destructive')}>{r.absent_days || '—'}</td>
                </tr>))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {edit && <DayDialog employeeId={edit.row.employee_id} employee={edit.row.employee} date={`${ym.y}-${pad(ym.m)}-${pad(edit.day.d)}`} onClose={() => setEdit(null)} />}
    </>
  )
}

const hhmm = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function DayDialog({ employeeId, employee, date, onClose }: { employeeId: string; employee: string; date: string; onClose: () => void }) {
  const rec = useAttendanceRecords(employeeId, date, date)
  const save = useSaveAttendance()
  const del = useDeleteAttendance()
  const existing = rec.data?.[0]
  const [v, setV] = React.useState<{ in: string; out: string; ot: string } | null>(null)
  React.useEffect(() => { if (!rec.isLoading && !v) setV({ in: hhmm(existing?.check_in ?? null) || '08:00', out: hhmm(existing?.check_out ?? null) || '16:30', ot: existing ? String(existing.overtime_hours) : '0' }) }, [rec.isLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  const at = (x: string) => x ? new Date(`${date}T${x}:00`).toISOString() : null
  const valid = v && v.in && (!v.out || v.out > v.in) && num(v.ot) >= 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{employee}</DialogTitle>
          <DialogDescription>{formatDateWith(new Date(`${date}T00:00:00`), { weekday: 'long', day: 'numeric', month: 'long' })} · {existing ? t('Correct the hours') : t('Nothing recorded yet')}</DialogDescription></DialogHeader>
        {!v ? <Skeleton className="h-24" /> : (
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="at-in">{t('In')}</Label><Input id="at-in" type="time" value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="at-out">{t('Out')}</Label><Input id="at-out" type="time" value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="at-ot">{t('Overtime (h)')}</Label><Input id="at-ot" type="number" step="0.5" min={0} value={v.ot} onChange={(e) => setV({ ...v, ot: e.target.value })} /></div>
          </div>)}
        <DialogFooter className="gap-2">
          {existing && <Button variant="ghost" className="mr-auto text-destructive" loading={del.isPending}
            onClick={async () => { await del.mutateAsync(existing.id); toast.success(t('Day cleared')); onClose() }}><Trash2 /> {t('Remove')}</Button>}
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!valid} loading={save.isPending} onClick={async () => {
            await save.mutateAsync({ id: existing?.id, employee_id: employeeId, work_date: date, check_in: at(v!.in), check_out: at(v!.out), overtime_hours: num(v!.ot),
              ...(existing ? {} : { source: 'manual' }) })
            toast.success(t('Attendance saved')); onClose()
          }}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
