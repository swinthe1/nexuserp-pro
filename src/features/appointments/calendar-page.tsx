import { CalendarPlus, Check, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Can } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, t, tn } from '@/i18n'
import { cn, formatMoney, num } from '@/lib/utils'
import { type Appt, useBoard } from './api'
import { AppointmentDialog, localDay, localTime, type NewAppt } from './appointment-dialog'

const PX = 1.4 // pixels per minute
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0) }
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d) }

/** The day by person, chair or lift: click a free place to book, an appointment to open it. */
export function AppointmentsCalendarPage() {
  const [params, setParams] = useSearchParams()
  const day = params.get('day') ?? localDay(new Date())
  const setDay = (d: string) => setParams({ day: d }, { replace: true })
  const board = useBoard(day, day)
  const [open, setOpen] = React.useState<{ appt: Appt | null; initial: NewAppt | null } | null>(null)
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => { const i = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(i) }, [])
  const dow = String(((new Date(`${day}T12:00:00`).getDay() + 6) % 7) + 1)

  const b = board.data
  const hours = (b?.resources ?? []).flatMap((r) => r.hours[dow] ?? [])
  const appts = b?.appointments ?? []
  const startMin = Math.min(8 * 60, ...hours.map((h) => toMin(h[0])), ...appts.map((a) => { const d = new Date(a.starts_at); return d.getHours() * 60 }))
  const endMin = Math.max(18 * 60, ...hours.map((h) => toMin(h[1])), ...appts.map((a) => { const d = new Date(a.ends_at); return d.getHours() * 60 + d.getMinutes() }))
  const live = appts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
  const expected = live.reduce((s, a) => s + num(a.price), 0)
  const isToday = day === localDay(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <>
      <PageHeader title={t('Appointment calendar')} description={formatDateWith(new Date(`${day}T12:00:00`), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={<>
          <Button variant="outline" asChild><Link to="/appointments/setup"><Settings2 /> {t('Services and staff')}</Link></Button>
          <Can perm="sales.write"><Button onClick={() => setOpen({ appt: null, initial: { day, time: isToday ? localTime(new Date(Math.ceil(now.getTime() / 900000) * 900000)) : '09:00' } })} disabled={!b?.resources.length}><CalendarPlus /> {t('New appointment')}</Button></Can>
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('Previous day')} onClick={() => setDay(shift(day, -1))}><ChevronLeft /></Button>
        <Button variant={isToday ? 'secondary' : 'outline'} onClick={() => setDay(localDay(new Date()))}>{t('Today')}</Button>
        <Button variant="outline" size="icon" aria-label={t('Next day')} onClick={() => setDay(shift(day, 1))}><ChevronRight /></Button>
        <Input type="date" className="w-40" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t('Day')} />
        {b && <span className="text-[13px] text-muted-foreground">{tn(live.length, '{n} appointment', '{n} appointments')} · {t('{amount} expected, with VAT', { amount: formatMoney(expected) })}</span>}
      </div>
      {board.isLoading ? <Skeleton className="h-[600px]" /> : board.isError ? <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        : !b?.resources.length ? <EmptyState icon={Settings2} title={t('Add who works first')} description={t('Add the people (or chairs, rooms, lifts) and the services with their length and price; then the calendar opens.')}
            action={<Button asChild><Link to="/appointments/setup">{t('Services and staff')}</Link></Button>} />
        : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="grid min-w-fit" style={{ gridTemplateColumns: `56px repeat(${b.resources.length}, minmax(170px, 1fr))` }}>
              <div className="sticky left-0 z-20 border-b bg-card" />
              {b.resources.map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-b border-l px-3 py-2 text-sm font-medium">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{appts.filter((a) => a.resource_id === r.id && a.status !== 'cancelled' && a.status !== 'no_show').length}</span>
                </div>
              ))}
              <div className="sticky left-0 z-10 bg-card" style={{ height: (endMin - startMin) * PX }}>
                {Array.from({ length: Math.ceil((endMin - startMin) / 60) }, (_, i) => startMin + i * 60).map((m) => (
                  <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular text-muted-foreground" style={{ top: (m - startMin) * PX + (m === startMin ? 8 : 0) }}>{`${String(Math.floor(m / 60)).padStart(2, '0')}:00`}</div>
                ))}
              </div>
              {b.resources.map((r) => {
                const open = r.hours[dow] ?? []
                return (
                  <div key={r.id} className="relative cursor-copy border-l" style={{ height: (endMin - startMin) * PX }}
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return
                      const y = e.nativeEvent.offsetY
                      const m = Math.floor((startMin + y / PX) / 15) * 15
                      setOpen({ appt: null, initial: { resource_id: r.id, day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` } })
                    }}>
                    {/* closed hours shaded, hour lines */}
                    <div className="pointer-events-none absolute inset-0 bg-muted/50" />
                    {open.map((h, i) => <div key={i} className="pointer-events-none absolute inset-x-0 bg-card" style={{ top: (toMin(h[0]) - startMin) * PX, height: (toMin(h[1]) - toMin(h[0])) * PX }} />)}
                    {Array.from({ length: Math.ceil((endMin - startMin) / 30) }, (_, i) => i).map((i) => (
                      <div key={i} className={cn('pointer-events-none absolute inset-x-0 border-t', i % 2 ? 'border-dashed border-border/50' : 'border-border')} style={{ top: i * 30 * PX }} />
                    ))}
                    {isToday && nowMin > startMin && nowMin < endMin && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive" style={{ top: (nowMin - startMin) * PX }} />}
                    {appts.filter((a) => a.resource_id === r.id).map((a) => {
                      const s = new Date(a.starts_at), e = new Date(a.ends_at)
                      const top = (s.getHours() * 60 + s.getMinutes() - startMin) * PX
                      const h = Math.max((e.getTime() - s.getTime()) / 60000 * PX - 2, 22)
                      const gone = a.status === 'cancelled' || a.status === 'no_show'
                      return (
                        <button key={a.id} type="button" onClick={() => setOpen({ appt: a, initial: null })}
                          className={cn('absolute inset-x-1 z-[5] overflow-hidden rounded-md border px-2 py-1 text-left text-[12px] leading-tight shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            gone ? 'border-dashed bg-muted text-muted-foreground line-through' : a.status === 'done' ? 'bg-success/10' : a.status === 'arrived' ? 'bg-info/10' : 'bg-card')}
                          style={{ top: top + 1, height: h, borderLeft: `4px solid ${a.color}` }}>
                          <span className="flex items-center gap-1 font-medium">{a.status === 'done' && <Check className="size-3 text-success" />}<span className="truncate">{a.client_name}</span>
                            <span className="ml-auto shrink-0 tabular text-muted-foreground">{localTime(s)}</span></span>
                          {h > 34 && <span className="block truncate text-muted-foreground">{[a.service, a.card].filter(Boolean).join(' · ')}</span>}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      {b && open && <AppointmentDialog board={b} appt={open.appt} initial={open.initial} open onOpenChange={(o) => !o && setOpen(null)} />}
    </>
  )
}
