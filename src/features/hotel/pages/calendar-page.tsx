import { BedDouble, ChevronLeft, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { NewReservationButton } from '../components/new-reservation-button'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateWith, t } from '@/i18n'
import { cn, todayISO } from '@/lib/utils'
import { type CalendarStay, HOUSEKEEPING, type Housekeeping, STAY_STATUS, addDays, nights, useHotelCalendar } from '../api'
import { type NewStay, ReservationDialog } from '../components/reservation-dialog'

const DAYS = 14
const CELL = 56     // px per night
const ROOM_COL = 132

export const HK_DOT: Record<Housekeeping, string> = {
  clean: 'bg-emerald-500', dirty: 'bg-amber-500', inspect: 'bg-sky-500', out_of_order: 'bg-destructive',
}
const STAY_TONE: Record<string, string> = {
  booked: 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25',
  checked_in: 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 dark:bg-emerald-600/80',
  checked_out: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
}

/** Hotel › Calendar: rooms down, nights across; a stay is a bar from its arrival to its departure */
export function HotelCalendarPage() {
  const { can } = useCompany()
  const today = todayISO()
  const [start, setStart] = React.useState(() => addDays(today, -2))
  const end = addDays(start, DAYS)
  const cal = useHotelCalendar(start, end)
  const [open, setOpen] = React.useState<{ id?: string; initial?: NewStay } | null>(null)
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i))

  const byRoom = React.useMemo(() => {
    const m = new Map<string, CalendarStay[]>()
    for (const s of cal.data?.stays ?? []) m.set(s.room_id, [...(m.get(s.room_id) ?? []), s])
    return m
  }, [cal.data])
  const freeTonight = (cal.data?.rooms ?? []).filter((r) => r.housekeeping !== 'out_of_order'
    && !(byRoom.get(r.id) ?? []).some((s) => s.status !== 'checked_out' && s.check_in <= today && s.check_out > today)).length

  return (
    <>
      <PageHeader title={t('Room calendar')} description={t('Every room and its nights. Click an empty night to book it, or a stay to open it.')}
        actions={can('sales.write') && <NewReservationButton onClick={() => setOpen({ initial: { check_in: today } })} />} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border">
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('Earlier')} onClick={() => setStart(addDays(start, -7))}><ChevronLeft className="size-4" /></Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setStart(addDays(today, -2))}>{t('Today')}</Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('Later')} onClick={() => setStart(addDays(start, 7))}><ChevronRight className="size-4" /></Button>
        </div>
        <span className="text-[13px] font-medium">{formatDateWith(new Date(`${start}T00:00:00`), { day: 'numeric', month: 'long' })} – {formatDateWith(new Date(`${addDays(end, -1)}T00:00:00`), { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        {cal.data && <span className="ml-auto text-[13px] text-muted-foreground">{t('{n} free tonight of {total}', { n: freeTonight, total: cal.data.rooms.length })}</span>}
      </div>

      {cal.isError ? <ErrorState error={cal.error} onRetry={() => void cal.refetch()} />
        : !cal.data ? <Skeleton className="h-[420px]" />
        : cal.data.rooms.length === 0 ? (
          <Card><EmptyState icon={BedDouble} title={t('No rooms yet')} description={t('Add the room types and the rooms first; then they show here night by night.')}
            action={<Button asChild><Link to="/hotel/rooms">{t('Set up the rooms')}</Link></Button>} /></Card>
        ) : (
          <Card className="overflow-x-auto">
            <div className="relative" style={{ minWidth: ROOM_COL + DAYS * CELL }}>
              {/* the nights */}
              <div className="sticky top-0 z-20 flex border-b bg-card">
                <div className="sticky left-0 z-30 shrink-0 border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground" style={{ width: ROOM_COL }}>{t('Room')}</div>
                {days.map((d) => {
                  const dt = new Date(`${d}T00:00:00`)
                  const we = dt.getDay() === 0 || dt.getDay() === 6
                  return (
                    <div key={d} className={cn('flex-1 border-r py-1.5 text-center leading-tight last:border-r-0', we && 'bg-muted/50', d === today && 'bg-primary/10')} style={{ minWidth: CELL }}>
                      <div className="text-[10px] text-muted-foreground">{formatDateWith(dt, { weekday: 'short' })}</div>
                      <div className={cn('text-[13px] tabular', d === today && 'font-semibold text-primary')}>{dt.getDate()}</div>
                    </div>
                  )
                })}
              </div>
              {cal.data.rooms.map((room, i) => {
                const prev = cal.data!.rooms[i - 1]
                return (
                  <React.Fragment key={room.id}>
                    {(!prev || prev.type_id !== room.type_id) && (
                      <div className="border-b bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground"><span className="sticky left-3">{room.type}</span></div>
                    )}
                    <div className="relative flex h-11 border-b last:border-b-0">
                      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-card px-3" style={{ width: ROOM_COL }}>
                        <span className={cn('size-2 rounded-full', HK_DOT[room.housekeeping])} title={t(HOUSEKEEPING[room.housekeeping])} aria-label={t(HOUSEKEEPING[room.housekeeping])} />
                        <span className="text-[13px] font-semibold tabular">{room.number}</span>
                        {room.floor && <span className="text-[11px] text-muted-foreground">{t('fl. {n}', { n: room.floor })}</span>}
                      </div>
                      {days.map((d) => {
                        const we = [0, 6].includes(new Date(`${d}T00:00:00`).getDay())
                        return (
                          <button key={d} type="button" disabled={!can('sales.write') || room.housekeeping === 'out_of_order' || d < today}
                            className={cn('flex-1 border-r transition-colors last:border-r-0 enabled:hover:bg-primary/5 disabled:cursor-default', we && 'bg-muted/40', d === today && 'bg-primary/5',
                              room.housekeeping === 'out_of_order' && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,hsl(var(--muted))_6px,hsl(var(--muted))_12px)]')}
                            style={{ minWidth: CELL }} aria-label={t('Book room {room} on {date}', { room: room.number, date: d })}
                            onClick={() => setOpen({ initial: { room_id: room.id, check_in: d, check_out: addDays(d, 1) } })} />
                        )
                      })}
                      {(byRoom.get(room.id) ?? []).map((s) => {
                        // a bar runs from the middle of the arrival night to the middle of the departure day, as hotels draw it
                        const a = Math.max(nights(start, s.check_in), -1)
                        const b = Math.min(nights(start, s.check_out), DAYS + 1)
                        if (b <= 0 || a >= DAYS) return null
                        // in nights from the left edge of the grid; a stay that began earlier starts at the edge
                        const x0 = Math.max(a + 0.5, 0)
                        const x1 = Math.min(b + 0.5, DAYS)
                        const span = `(100% - ${ROOM_COL}px) / ${DAYS}`
                        return (
                          <button key={s.id} type="button" onClick={() => setOpen({ id: s.id })}
                            className={cn('absolute top-1.5 z-[5] flex h-8 items-center overflow-hidden rounded-md border px-2 text-left text-[12px] font-medium shadow-sm', STAY_TONE[s.status])}
                            style={{ left: `calc(${ROOM_COL + 2}px + ${span} * ${x0})`, width: `calc(${span} * ${x1 - x0} - 4px)` }}
                            title={`${s.guest} · ${t(STAY_STATUS[s.status])} · ${s.adults + s.children}`}>
                            <span className="truncate">{s.guest}</span>
                          </button>
                        )
                      })}
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </Card>
        )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-primary/40 bg-primary/15" />{t(STAY_STATUS.booked)}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-emerald-600" />{t(STAY_STATUS.checked_in)}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border bg-muted" />{t(STAY_STATUS.checked_out)}</span>
        <span className="mx-1 text-border">|</span>
        {(Object.keys(HOUSEKEEPING) as Housekeeping[]).map((h) => <span key={h} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', HK_DOT[h])} />{t(HOUSEKEEPING[h])}</span>)}
      </div>
      <ReservationDialog open={!!open} id={open?.id} initial={open?.initial} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  )
}
